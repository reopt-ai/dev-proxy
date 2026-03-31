import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "./config.js";

// ── Mocks ───────────────────────────────────────────────────
// Must be set up before importing the module under test because
// routes.ts builds its route map at module load time.

const mockWorktreeTarget = vi.fn<(branch: string, service?: string) => URL | null>();

vi.mock("./worktrees.js", () => ({
  getWorktreeTarget: (...args: unknown[]) =>
    mockWorktreeTarget(args[0] as string, args[1] as string | undefined),
}));

const mockConfig: ResolvedConfig = {
  domain: "test.dev",
  port: 3000,
  httpsPort: 3443,
  projects: [
    {
      path: "/projects/alpha",
      configPath: "/projects/alpha/.dev-proxy.json",
      routes: {
        studio: "http://localhost:4000",
        api: "http://localhost:4001",
        "*": "http://localhost:5000",
      },
      worktrees: {},
    },
    {
      path: "/projects/beta",
      configPath: "/projects/beta/.dev-proxy.json",
      routes: {
        blog: "http://localhost:6000",
        api: "http://localhost:6001", // duplicate — should be ignored
        "*": "http://localhost:7000", // second wildcard — should be ignored
      },
      worktrees: {},
    },
  ],
};

vi.mock("./config.js", () => ({
  config: mockConfig,
}));

// Now import after mocks are in place
const {
  parseHost,
  getTarget,
  getDomain,
  getRoutes,
  getDefaultTarget,
  getRoutesByProject,
  rebuildRoutes,
  __testing: routesTesting,
} = await import("./routes.js");

// ── Test setup ─────────────────────────────────────────────

beforeEach(() => {
  mockWorktreeTarget.mockReset();
});

// ── parseHost ──────────────────────────────────────────────

describe("parseHost", () => {
  it("extracts subdomain from standard host", () => {
    expect(parseHost("studio.reopt.de:3000")).toEqual({
      app: "studio",
      worktree: null,
    });
  });

  it("extracts subdomain without port", () => {
    expect(parseHost("api.reopt.de")).toEqual({
      app: "api",
      worktree: null,
    });
  });

  it("parses worktree syntax (branch--app)", () => {
    expect(parseHost("feature-xyz--studio.reopt.de:3000")).toEqual({
      app: "studio",
      worktree: "feature-xyz",
    });
  });

  it("handles host with no dots (bare hostname)", () => {
    expect(parseHost("localhost")).toEqual({
      app: "localhost",
      worktree: null,
    });
  });

  it("strips port before parsing", () => {
    expect(parseHost("localhost:3000")).toEqual({
      app: "localhost",
      worktree: null,
    });
  });

  it("normalizes to lowercase", () => {
    expect(parseHost("Studio.Reopt.De:3000")).toEqual({
      app: "studio",
      worktree: null,
    });
  });

  it("handles empty host", () => {
    expect(parseHost("")).toEqual({
      app: "",
      worktree: null,
    });
  });

  it("handles worktree with multiple dashes in branch name", () => {
    expect(parseHost("fix-auth-bug--api.reopt.de")).toEqual({
      app: "api",
      worktree: "fix-auth-bug",
    });
  });

  it("handles double-dash at start (empty worktree)", () => {
    expect(parseHost("--api.reopt.de")).toEqual({
      app: "api",
      worktree: "",
    });
  });
});

// ── Route parsing (module-level config → parsedRoutes) ─────

describe("route parsing", () => {
  it("exposes domain via getDomain()", () => {
    expect(getDomain()).toBe("test.dev");
  });

  it("parses routes from a single project correctly", () => {
    // "studio" and "api" come from the first project
    expect(getRoutes().studio).toBe("http://localhost:4000");
    expect(getRoutes().api).toBe("http://localhost:4001");
  });

  it("first project wins for duplicate subdomain registrations", () => {
    // "api" is in both projects; alpha's port 4001 should win over beta's 6001
    expect(getRoutes().api).toBe("http://localhost:4001");
  });

  it("logs warning for duplicate subdomains", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

    vi.doMock("./config.js", () => ({
      config: {
        domain: "test.dev",
        port: 3000,
        httpsPort: 3443,
        projects: [
          {
            path: "/projects/alpha",
            configPath: "/projects/alpha/.dev-proxy.json",
            routes: { api: "http://localhost:4001" },
            worktrees: {},
          },
          {
            path: "/projects/beta",
            configPath: "/projects/beta/.dev-proxy.json",
            routes: { api: "http://localhost:6001" },
            worktrees: {},
          },
        ],
      },
    }));

    vi.resetModules();
    await import("./routes.js");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring duplicate subdomain "api" from /projects/beta'),
    );

    vi.doUnmock("./config.js");
  });

  it("stores wildcard route as fallback", () => {
    expect(getDefaultTarget()).toBe("http://localhost:5000");
  });

  it("first wildcard wins across multiple projects", () => {
    // Alpha's wildcard (port 5000) wins over beta's (port 7000)
    expect(getDefaultTarget()).toBe("http://localhost:5000");
  });

  it("registers routes from second project that are not duplicates", () => {
    // "blog" only appears in beta, so it should be registered
    expect(getRoutes().blog).toBe("http://localhost:6000");
  });

  it("does not include wildcard in getRoutes() map", () => {
    expect(getRoutes()["*"]).toBeUndefined();
  });

  it("only registers expected subdomains from all projects", () => {
    // Exactly three routes from both projects (alpha: studio, api; beta: blog)
    // No extras from empty or invalid entries
    const expectedKeys = ["studio", "api", "blog"];
    expect(Object.keys(getRoutes()).sort()).toEqual(expectedKeys.sort());
  });
});

// ── Route parsing: protocol and URL validation ─────────────

describe("route parsing — invalid targets", () => {
  // These tests verify behavior that happened at module load time.
  // To test rejection of unsupported protocols and malformed URLs,
  // we use separate dynamic imports with different mock configs.

  it("rejects unsupported protocols (e.g., ftp:)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    vi.doMock("./config.js", () => ({
      config: {
        domain: "test.dev",
        port: 3000,
        httpsPort: 3443,
        projects: [
          {
            path: "/projects/ftp-project",
            configPath: "/projects/ftp-project/.dev-proxy.json",
            routes: { files: "ftp://fileserver:21" },
            worktrees: {},
          },
        ],
      },
    }));

    vi.resetModules();
    const mod = await import("./routes.js");
    expect(mod.getRoutes().files).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unsupported protocol "ftp:"'),
    );

    vi.doUnmock("./config.js");
  });

  it("handles malformed target URLs gracefully", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(vi.fn());

    vi.doMock("./config.js", () => ({
      config: {
        domain: "test.dev",
        port: 3000,
        httpsPort: 3443,
        projects: [
          {
            path: "/projects/bad-urls",
            configPath: "/projects/bad-urls/.dev-proxy.json",
            routes: { broken: "not a valid url" },
            worktrees: {},
          },
        ],
      },
    }));

    vi.resetModules();
    const mod = await import("./routes.js");
    expect(mod.getRoutes().broken).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring /projects/bad-urls routes.broken"),
    );

    vi.doUnmock("./config.js");
  });

  it("empty routes object results in no registered routes", async () => {
    vi.doMock("./config.js", () => ({
      config: {
        domain: "test.dev",
        port: 3000,
        httpsPort: 3443,
        projects: [
          {
            path: "/projects/empty",
            configPath: "/projects/empty/.dev-proxy.json",
            routes: {},
            worktrees: {},
          },
        ],
      },
    }));

    vi.resetModules();
    const mod = await import("./routes.js");
    expect(Object.keys(mod.getRoutes())).toHaveLength(0);
    expect(mod.getDefaultTarget()).toBeNull();

    vi.doUnmock("./config.js");
  });
});

// ── getTarget edge cases ───────────────────────────────────

describe("getTarget", () => {
  it("resolves known subdomain to correct target URL", () => {
    const result = getTarget("studio.test.dev:3000");
    expect(result.url).not.toBeNull();
    expect(result.url?.origin).toBe("http://localhost:4000");
    expect(result.worktree).toBeNull();
  });

  it("falls back to wildcard for unmatched subdomain", () => {
    const result = getTarget("unknown-xyz.test.dev:3000");
    expect(result.url).not.toBeNull();
    expect(result.url?.origin).toBe("http://localhost:5000");
    expect(result.worktree).toBeNull();
  });

  it("returns null when no wildcard and no match", async () => {
    // Use a config without wildcard
    vi.doMock("./config.js", () => ({
      config: {
        domain: "test.dev",
        port: 3000,
        httpsPort: 3443,
        projects: [
          {
            path: "/projects/no-wildcard",
            configPath: "/projects/no-wildcard/.dev-proxy.json",
            routes: { app: "http://localhost:9000" },
            worktrees: {},
          },
        ],
      },
    }));

    vi.resetModules();
    const mod = await import("./routes.js");
    const result = mod.getTarget("missing.test.dev:3000");
    expect(result.url).toBeNull();
    expect(result.worktree).toBeNull();

    vi.doUnmock("./config.js");
  });

  it("delegates worktree resolution (branch--service pattern) to getWorktreeTarget", () => {
    const fakeUrl = new URL("http://localhost:9999");
    mockWorktreeTarget.mockReturnValue(fakeUrl);

    const result = getTarget("feature-x--studio.test.dev:3000");
    expect(mockWorktreeTarget).toHaveBeenCalledWith("feature-x", "studio");
    expect(result.url).toBe(fakeUrl);
    expect(result.worktree).toBe("feature-x");
  });

  it("returns null url when worktree target is not found", () => {
    mockWorktreeTarget.mockReturnValue(null);

    const result = getTarget("nonexistent--studio.test.dev:3000");
    expect(mockWorktreeTarget).toHaveBeenCalledWith("nonexistent", "studio");
    expect(result.url).toBeNull();
    expect(result.worktree).toBe("nonexistent");
  });

  it("returns null for empty host string", () => {
    const result = getTarget("");
    // Empty host parses to app="" worktree=null, no route for ""
    // Falls back to wildcard (http://localhost:5000)
    expect(result.url).not.toBeNull();
    expect(result.url?.origin).toBe("http://localhost:5000");
    expect(result.worktree).toBeNull();
  });

  it("empty worktree prefix falls through to normal routing", () => {
    // "--api.reopt.de" parses as worktree="" which is falsy
    const result = getTarget("--api.test.dev:3000");
    // Should not crash, should fall through to route lookup for "api"
    expect(result.worktree).toBeNull();
    expect(result.url).not.toBeNull();
    expect(result.url?.origin).toBe("http://localhost:4001");
  });
});

// ── getRoutesByProject ───────────────────────────────────────

describe("getRoutesByProject", () => {
  it("groups routes by project with label from basename", () => {
    const groups = getRoutesByProject();
    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBe("alpha");
    expect(groups[1]?.label).toBe("beta");
  });

  it("includes only non-wildcard routes in each group", () => {
    const groups = getRoutesByProject();
    const alpha = groups.find((g) => g.label === "alpha");
    expect(alpha?.routes).toHaveProperty("studio");
    expect(alpha?.routes).toHaveProperty("api");
    expect(alpha?.routes).not.toHaveProperty("*");
  });

  it("excludes projects with no valid routes", async () => {
    vi.doMock("./config.js", () => ({
      config: {
        domain: "test.dev",
        port: 3000,
        httpsPort: 3443,
        projects: [
          {
            path: "/projects/empty",
            configPath: "/projects/empty/.dev-proxy.json",
            routes: { "*": "http://localhost:5000" },
            worktrees: {},
          },
        ],
      },
    }));

    vi.resetModules();
    const mod = await import("./routes.js");
    expect(mod.getRoutesByProject()).toHaveLength(0);

    vi.doUnmock("./config.js");
  });
});

// ── rebuildRoutes ────────────────────────────────────────────

describe("rebuildRoutes", () => {
  it("rebuilds routes from current config state", () => {
    // Mutate the mock config to simulate a reload
    mockConfig.projects = [
      {
        path: "/projects/alpha",
        configPath: "/projects/alpha/.dev-proxy.json",
        routes: { newapp: "http://localhost:9000" },
        worktrees: {},
      },
    ];

    rebuildRoutes();

    expect(getRoutes()).toEqual({ newapp: "http://localhost:9000" });
    expect(getDefaultTarget()).toBeNull();
    expect(getRoutesByProject()).toHaveLength(1);
    expect(getRoutesByProject()[0]?.routes).toHaveProperty("newapp");

    // Restore original config for other tests
    mockConfig.projects = [
      {
        path: "/projects/alpha",
        configPath: "/projects/alpha/.dev-proxy.json",
        routes: {
          studio: "http://localhost:4000",
          api: "http://localhost:4001",
          "*": "http://localhost:5000",
        },
        worktrees: {},
      },
      {
        path: "/projects/beta",
        configPath: "/projects/beta/.dev-proxy.json",
        routes: {
          blog: "http://localhost:6000",
          api: "http://localhost:6001",
          "*": "http://localhost:7000",
        },
        worktrees: {},
      },
    ];
    rebuildRoutes();
  });

  it("updates getTarget() to use new routes after rebuild", () => {
    mockConfig.projects = [
      {
        path: "/projects/rebuilt",
        configPath: "/projects/rebuilt/.dev-proxy.json",
        routes: { fresh: "http://localhost:7777" },
        worktrees: {},
      },
    ];

    rebuildRoutes();

    const result = getTarget("fresh.test.dev:3000");
    expect(result.url?.origin).toBe("http://localhost:7777");

    // Old route should no longer resolve (no wildcard)
    const old = getTarget("studio.test.dev:3000");
    expect(old.url).toBeNull();

    // Restore
    mockConfig.projects = [
      {
        path: "/projects/alpha",
        configPath: "/projects/alpha/.dev-proxy.json",
        routes: {
          studio: "http://localhost:4000",
          api: "http://localhost:4001",
          "*": "http://localhost:5000",
        },
        worktrees: {},
      },
      {
        path: "/projects/beta",
        configPath: "/projects/beta/.dev-proxy.json",
        routes: {
          blog: "http://localhost:6000",
          api: "http://localhost:6001",
          "*": "http://localhost:7000",
        },
        worktrees: {},
      },
    ];
    rebuildRoutes();
  });
});

// ── subscribe / getSnapshot ──────────────────────────────────

describe("subscribe and getSnapshot", () => {
  it("getSnapshot returns current route snapshot", () => {
    const snap = routesTesting.getSnapshot();
    expect(snap.domain).toBe("test.dev");
    expect(snap.routes).toHaveProperty("studio");
    expect(snap.defaultTarget).toBe("http://localhost:5000");
    expect(snap.byProject.length).toBeGreaterThan(0);
  });

  it("subscribe notifies listener on rebuildRoutes", () => {
    const listener = vi.fn();
    const unsubscribe = routesTesting.subscribe(listener);

    rebuildRoutes();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsubscribe = routesTesting.subscribe(listener);
    unsubscribe();

    rebuildRoutes();
    expect(listener).not.toHaveBeenCalled();
  });
});
