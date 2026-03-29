import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "./config.js";

// ── Mocks ───────────────────────────────────────────────────
// Must be set up before importing the module under test.

const fsMock = {
  existsSync: vi.fn<(p: string) => boolean>(),
  readFileSync: vi.fn<(p: string, enc: string) => string>(),
  watch: vi.fn(),
};

vi.mock("node:fs", () => ({
  default: fsMock,
  ...fsMock,
}));

const configMock = {
  config: {
    projects: [] as ProjectConfig[],
  },
};

vi.mock("./config.js", () => configMock);

// Capture subscribe/getSnapshot args passed to useSyncExternalStore
let capturedSubscribe: ((cb: () => void) => () => void) | null = null;
let capturedGetSnapshot: (() => unknown) | null = null;

vi.mock("react", () => ({
  useSyncExternalStore: (
    subscribe: (cb: () => void) => () => void,
    getSnapshot: () => unknown,
    _getServerSnapshot?: () => unknown,
  ) => {
    capturedSubscribe = subscribe;
    capturedGetSnapshot = getSnapshot;
    return getSnapshot();
  },
}));

// Now import after mocks are in place
const {
  __testing,
  getWorktreeTarget,
  loadRegistry,
  stopRegistry,
  getActiveWorktrees,
  useWorktrees,
} = await import("./worktrees.js");

const { isValidEntry, readRegistry, readProjectWorktrees } = __testing;

// ── Helpers ─────────────────────────────────────────────────

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    path: "/projects/app",
    configPath: "/projects/app/.dev-proxy.json",
    routes: {},
    worktrees: {},
    ...overrides,
  };
}

beforeEach(() => {
  // Reset worktreeMap to empty between tests
  __testing.worktreeMap = new Map();
  // Reset projects
  configMock.config.projects = [];
});

afterEach(() => {
  stopRegistry();
});

// ── Existing tests ──────────────────────────────────────────

describe("isValidEntry", () => {
  it("accepts multi-service entry with ports", () => {
    expect(isValidEntry({ ports: { web: 3000, api: 3001 } })).toBe(true);
  });

  it("rejects multi-service entry with empty ports", () => {
    expect(isValidEntry({ ports: {} })).toBe(false);
  });

  it("accepts legacy single-port entry", () => {
    expect(isValidEntry({ port: 4000 })).toBe(true);
  });

  it("rejects legacy entry with non-number port", () => {
    // @ts-expect-error — testing runtime validation
    expect(isValidEntry({ port: "4000" })).toBe(false);
  });
});

describe("getWorktreeTarget", () => {
  it("returns null for unregistered branch", () => {
    expect(getWorktreeTarget("nonexistent-branch")).toBeNull();
  });

  it("returns null for unregistered branch with service", () => {
    expect(getWorktreeTarget("nonexistent", "web")).toBeNull();
  });
});

// ── New tests ───────────────────────────────────────────────

describe("readProjectWorktrees", () => {
  it("reads worktrees from config file on disk", () => {
    const project = makeProject();
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ worktrees: { feat: { port: 4000 } } }),
    );

    const result = readProjectWorktrees(project);
    expect(result).toEqual({ feat: { port: 4000 } });
  });

  it("returns project.worktrees when config file does not exist", () => {
    const project = makeProject({
      worktrees: { main: { port: 5000 } },
    });
    fsMock.existsSync.mockReturnValue(false);

    const result = readProjectWorktrees(project);
    expect(result).toEqual({ main: { port: 5000 } });
  });

  it("returns empty object when config file has no worktrees key", () => {
    const project = makeProject();
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ routes: {} }));

    const result = readProjectWorktrees(project);
    expect(result).toEqual({});
  });

  it("falls back to project.worktrees when readFileSync throws", () => {
    const project = makeProject({
      worktrees: { fallback: { port: 6000 } },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const result = readProjectWorktrees(project);
    expect(result).toEqual({ fallback: { port: 6000 } });
  });

  it("falls back to project.worktrees when JSON parse fails", () => {
    const project = makeProject({
      worktrees: { cached: { ports: { web: 7000 } } },
    });
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue("{ invalid json !!!");

    const result = readProjectWorktrees(project);
    expect(result).toEqual({ cached: { ports: { web: 7000 } } });
  });
});

describe("readRegistry", () => {
  it("builds worktreeMap from project worktree configs", () => {
    const project = makeProject();
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        worktrees: {
          feat: { port: 4000 },
          dev: { ports: { web: 5000, api: 5001 } },
        },
      }),
    );

    readRegistry();

    expect(__testing.worktreeMap.size).toBe(2);
    expect(__testing.worktreeMap.get("feat")).toEqual({ port: 4000 });
    expect(__testing.worktreeMap.get("dev")).toEqual({ ports: { web: 5000, api: 5001 } });
  });

  it("first project wins for duplicate branch names", () => {
    const projectA = makeProject({
      configPath: "/projects/a/.dev-proxy.json",
    });
    const projectB = makeProject({
      configPath: "/projects/b/.dev-proxy.json",
    });
    configMock.config.projects = [projectA, projectB];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockImplementation((p: string) => {
      if (p.includes("/a/")) {
        return JSON.stringify({ worktrees: { feat: { port: 4000 } } });
      }
      return JSON.stringify({ worktrees: { feat: { port: 9999 } } });
    });

    readRegistry();

    expect(__testing.worktreeMap.get("feat")).toEqual({ port: 4000 });
  });

  it("skips entries that fail isValidEntry (empty ports)", () => {
    const project = makeProject();
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        worktrees: {
          bad: { ports: {} },
          good: { port: 3000 },
        },
      }),
    );

    readRegistry();

    expect(__testing.worktreeMap.has("bad")).toBe(false);
    expect(__testing.worktreeMap.has("good")).toBe(true);
  });

  it("produces an empty map when no projects are configured", () => {
    configMock.config.projects = [];
    readRegistry();
    expect(__testing.worktreeMap.size).toBe(0);
  });

  it("reflects in getActiveWorktrees after readRegistry", () => {
    const project = makeProject();
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ worktrees: { main: { port: 8080 } } }),
    );

    readRegistry();

    const active = getActiveWorktrees();
    expect(active.get("main")).toEqual({ port: 8080 });
  });
});

describe("getWorktreeTarget — multi-service", () => {
  it("returns URL for registered branch with single port (legacy)", () => {
    __testing.worktreeMap = new Map([["feat", { port: 4000 }]]);

    const url = getWorktreeTarget("feat");
    expect(url).toBeInstanceOf(URL);
    expect(url?.href).toBe("http://localhost:4000/");
  });

  it("returns URL for registered branch with multi-port and default service", () => {
    __testing.worktreeMap = new Map([["feat", { ports: { web: 5000, api: 5001 } }]]);

    // No service specified — should return first port (web: 5000)
    const url = getWorktreeTarget("feat");
    expect(url).toBeInstanceOf(URL);
    expect(url?.href).toBe("http://localhost:5000/");
  });

  it("returns URL for specific service in multi-port entry", () => {
    __testing.worktreeMap = new Map([["feat", { ports: { web: 5000, api: 5001 } }]]);

    const url = getWorktreeTarget("feat", "api");
    expect(url).toBeInstanceOf(URL);
    expect(url?.href).toBe("http://localhost:5001/");
  });

  it("falls back to first port for unknown service name", () => {
    __testing.worktreeMap = new Map([["feat", { ports: { web: 5000, api: 5001 } }]]);

    const url = getWorktreeTarget("feat", "nonexistent");
    expect(url).toBeInstanceOf(URL);
    expect(url?.href).toBe("http://localhost:5000/");
  });

  it("returns null for empty ports object", () => {
    // Bypass isValidEntry by directly setting the map
    __testing.worktreeMap = new Map([["feat", { ports: {} }]]);

    const url = getWorktreeTarget("feat");
    expect(url).toBeNull();
  });

  it("ignores service parameter for legacy single-port entry", () => {
    __testing.worktreeMap = new Map([["feat", { port: 4000 }]]);

    const url = getWorktreeTarget("feat", "api");
    expect(url).toBeInstanceOf(URL);
    expect(url?.href).toBe("http://localhost:4000/");
  });
});

describe("loadRegistry / stopRegistry", () => {
  it("calls readRegistry on load (populates worktreeMap)", () => {
    const project = makeProject();
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ worktrees: { feat: { port: 4000 } } }),
    );
    fsMock.watch.mockReturnValue({
      on: vi.fn(),
      close: vi.fn(),
    });

    loadRegistry();

    expect(__testing.worktreeMap.get("feat")).toEqual({ port: 4000 });
  });

  it("sets up file watchers for project config paths", () => {
    const project = makeProject({
      configPath: "/projects/app/.dev-proxy.json",
    });
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ worktrees: {} }));
    fsMock.watch.mockReturnValue({
      on: vi.fn(),
      close: vi.fn(),
    });

    loadRegistry();

    expect(fsMock.watch).toHaveBeenCalledWith("/projects/app", expect.any(Function));
  });

  it("stopRegistry closes all watchers", () => {
    const closeFn = vi.fn();
    const project = makeProject();
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ worktrees: {} }));
    fsMock.watch.mockReturnValue({
      on: vi.fn(),
      close: closeFn,
    });

    loadRegistry();
    expect(__testing.watchers.length).toBe(1);

    stopRegistry();
    expect(closeFn).toHaveBeenCalled();
    expect(__testing.watchers.length).toBe(0);
  });

  it("stopRegistry clears pending debounce timers", () => {
    const project = makeProject();
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ worktrees: {} }));

    // Create a fake watcher that captures the callback
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    let watchCallback: (event: string, filename: string) => void = () => {};
    fsMock.watch.mockImplementation(
      (_dir: string, cb: (event: string, filename: string) => void) => {
        watchCallback = cb;
        return { on: vi.fn(), close: vi.fn() };
      },
    );

    loadRegistry();

    // Trigger a file change to start the debounce timer
    watchCallback("change", ".dev-proxy.json");
    expect(__testing.debounceTimer).not.toBeNull();

    // Stop should clear the timer
    stopRegistry();
    expect(__testing.debounceTimer).toBeNull();
  });

  it("skips watcher setup when configPath does not exist", () => {
    const project = makeProject();
    configMock.config.projects = [project];
    // existsSync returns true for readRegistry's readProjectWorktrees call,
    // but we need it to return false during watcher setup.
    // readRegistry calls readProjectWorktrees which calls existsSync(project.configPath)
    // loadRegistry calls existsSync(project.configPath) for watcher setup
    let callCount = 0;
    fsMock.existsSync.mockImplementation(() => {
      callCount++;
      // First call is from readProjectWorktrees, second is from loadRegistry watcher setup
      return callCount <= 1;
    });
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ worktrees: {} }));

    loadRegistry();

    expect(fsMock.watch).not.toHaveBeenCalled();
  });

  it("catches when watch() throws (directory doesn't exist)", () => {
    const project = makeProject();
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ worktrees: {} }));
    fsMock.watch.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    // Should not throw — the catch block silently ignores the error
    expect(() => {
      loadRegistry();
    }).not.toThrow();
    // No watcher was pushed since watch() threw before returning
    expect(__testing.watchers.length).toBe(0);
  });
});

// ── useWorktrees / subscribe / getSnapshot ─────────────────

describe("useWorktrees", () => {
  it("returns current worktreeMap via useSyncExternalStore", () => {
    __testing.worktreeMap = new Map([["feat", { port: 3000 }]]);

    const result = useWorktrees();
    expect(result).toBe(__testing.worktreeMap);
  });

  it("subscribe returns an unsubscribe function that removes the listener", () => {
    // Call useWorktrees to capture the subscribe function
    useWorktrees();

    expect(capturedSubscribe).not.toBeNull();

    const listener = vi.fn();
    const unsubscribe = (capturedSubscribe as (cb: () => void) => () => void)(listener);

    // Trigger notify via readRegistry
    const project = makeProject();
    configMock.config.projects = [project];
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ worktrees: { feat: { port: 4000 } } }),
    );

    readRegistry();
    expect(listener).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsubscribe();

    readRegistry();
    // Should not have been called again after unsubscribe
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("getSnapshot returns current worktreeMap reference", () => {
    useWorktrees();
    expect(capturedGetSnapshot).not.toBeNull();

    __testing.worktreeMap = new Map([["main", { port: 8080 }]]);
    const snapshot = (capturedGetSnapshot as () => Map<string, unknown>)();
    expect(snapshot).toBe(__testing.worktreeMap);
  });
});
