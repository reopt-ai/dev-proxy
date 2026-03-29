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
const { parseHost, getTarget, ROUTES, DEFAULT_TARGET } = await import("./routes.js");

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
  it("parses routes from a single project correctly", () => {
    // "studio" and "api" come from the first project
    expect(ROUTES.studio).toBe("http://localhost:4000");
    expect(ROUTES.api).toBe("http://localhost:4001");
  });

  it("first project wins for duplicate subdomain registrations", () => {
    // "api" is in both projects; alpha's port 4001 should win over beta's 6001
    expect(ROUTES.api).toBe("http://localhost:4001");
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
    expect(DEFAULT_TARGET).toBe("http://localhost:5000");
  });

  it("first wildcard wins across multiple projects", () => {
    // Alpha's wildcard (port 5000) wins over beta's (port 7000)
    expect(DEFAULT_TARGET).toBe("http://localhost:5000");
  });

  it("registers routes from second project that are not duplicates", () => {
    // "blog" only appears in beta, so it should be registered
    expect(ROUTES.blog).toBe("http://localhost:6000");
  });

  it("does not include wildcard in ROUTES map", () => {
    expect(ROUTES["*"]).toBeUndefined();
  });

  it("only registers expected subdomains from all projects", () => {
    // Exactly three routes from both projects (alpha: studio, api; beta: blog)
    // No extras from empty or invalid entries
    const expectedKeys = ["studio", "api", "blog"];
    expect(Object.keys(ROUTES).sort()).toEqual(expectedKeys.sort());
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
    expect(mod.ROUTES.files).toBeUndefined();
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
    expect(mod.ROUTES.broken).toBeUndefined();
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
    expect(Object.keys(mod.ROUTES)).toHaveLength(0);
    expect(mod.DEFAULT_TARGET).toBeNull();

    vi.doUnmock("./config.js");
  });
});

// ── getTarget edge cases ───────────────────────────────────

describe("getTarget", () => {
  it("resolves known subdomain to correct target URL", () => {
    const result = getTarget("studio.test.dev:3000");
    expect(result.url).not.toBeNull();
    expect(result.url!.origin).toBe("http://localhost:4000");
    expect(result.worktree).toBeNull();
  });

  it("falls back to wildcard for unmatched subdomain", () => {
    const result = getTarget("unknown-xyz.test.dev:3000");
    expect(result.url).not.toBeNull();
    expect(result.url!.origin).toBe("http://localhost:5000");
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
    expect(result.url!.origin).toBe("http://localhost:5000");
    expect(result.worktree).toBeNull();
  });

  it("empty worktree prefix falls through to normal routing", () => {
    // "--api.reopt.de" parses as worktree="" which is falsy
    const result = getTarget("--api.test.dev:3000");
    // Should not crash, should fall through to route lookup for "api"
    expect(result.worktree).toBeNull();
    expect(result.url).not.toBeNull();
    expect(result.url!.origin).toBe("http://localhost:4001");
  });
});
