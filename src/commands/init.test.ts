import { describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────

vi.mock("../cli/config-io.js", () => ({
  CONFIG_DIR: "/mock/.dev-proxy",
  GLOBAL_CONFIG_PATH: "/mock/.dev-proxy/config.json",
  PROJECT_CONFIG_NAME: ".dev-proxy.json",
  isValidPort: (v: number) => Number.isInteger(v) && v > 0 && v <= 65535,
  isValidSubdomain: (v: string) => v === "*" || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v),
  readGlobalConfig: vi.fn(() => ({})),
  writeGlobalConfig: vi.fn(),
  writeProjectConfig: vi.fn(),
}));

vi.mock("../cli/output.js", () => ({
  ExitOnRender: () => null,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("ink", () => ({
  render: vi.fn(),
  Box: () => null,
  Text: () => null,
  useInput: vi.fn(),
}));

vi.mock("ink-text-input", () => ({ default: () => null }));

vi.mock("react", () => ({
  useState: vi.fn((init: unknown) => [init, vi.fn()]),
  useMemo: vi.fn((fn: () => unknown) => fn()),
  useEffect: vi.fn(),
}));

const { __testing } = await import("./init.js");
const {
  validatePort,
  validateProjectPath,
  parseRouteInput,
  buildGlobalConfig,
  buildRouteMap,
} = __testing;

const { existsSync } = await import("node:fs");
const existsSyncMock = vi.mocked(existsSync);

// ── validatePort ────────────────────────────────────────────

describe("validatePort", () => {
  it("accepts valid ports", () => {
    expect(validatePort("1")).toBeNull();
    expect(validatePort("3000")).toBeNull();
    expect(validatePort("65535")).toBeNull();
  });

  it("rejects port 0", () => {
    expect(validatePort("0")).toContain("Invalid port");
  });

  it("rejects port above 65535", () => {
    expect(validatePort("65536")).toContain("Invalid port");
  });

  it("rejects non-numeric input", () => {
    expect(validatePort("abc")).toContain("Invalid port");
  });

  it("rejects empty string", () => {
    expect(validatePort("")).toContain("Invalid port");
  });
});

// ── validateProjectPath ─────────────────────────────────────

describe("validateProjectPath", () => {
  it("returns null for existing path", () => {
    existsSyncMock.mockReturnValueOnce(true);
    expect(validateProjectPath("/existing/path")).toBeNull();
  });

  it("returns error for non-existent path", () => {
    existsSyncMock.mockReturnValueOnce(false);
    expect(validateProjectPath("/no/such/path")).toContain("Path does not exist");
  });
});

// ── parseRouteInput ─────────────────────────────────────────

describe("parseRouteInput", () => {
  it("parses valid subdomain=port", () => {
    const result = parseRouteInput("api=4000", []);
    expect(result).toEqual({ ok: true, sub: "api", port: "4000" });
  });

  it("trims whitespace", () => {
    const result = parseRouteInput("  web = 3000  ", []);
    expect(result).toEqual({ ok: true, sub: "web", port: "3000" });
  });

  it("returns done for empty input", () => {
    const result = parseRouteInput("", []);
    expect(result).toEqual({ ok: false, done: true });
  });

  it("returns done for whitespace-only input", () => {
    const result = parseRouteInput("   ", []);
    expect(result).toEqual({ ok: false, done: true });
  });

  it("rejects input without =", () => {
    const result = parseRouteInput("api4000", []);
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Expected format"),
    });
  });

  it("rejects invalid subdomain", () => {
    const result = parseRouteInput("API=4000", []);
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid subdomain"),
    });
  });

  it("rejects duplicate subdomain", () => {
    const existing = [{ subdomain: "api", port: "4000" }];
    const result = parseRouteInput("api=5000", existing);
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("already added"),
    });
  });

  it("rejects invalid port", () => {
    const result = parseRouteInput("api=99999", []);
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid port"),
    });
  });

  it("rejects non-numeric port", () => {
    const result = parseRouteInput("api=abc", []);
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid port"),
    });
  });
});

// ── buildGlobalConfig ───────────────────────────────────────

describe("buildGlobalConfig", () => {
  const input = {
    domain: "localhost",
    httpPort: "3000",
    httpsPort: "3443",
    absPath: "/projects/my-app",
  };

  it("creates new config when no existing", () => {
    const result = buildGlobalConfig(input, null);
    expect(result.config).toEqual({
      domain: "localhost",
      port: 3000,
      httpsPort: 3443,
      projects: ["/projects/my-app"],
    });
    expect(result.message).toBe("created");
  });

  it("adds project to existing config", () => {
    const existing = {
      domain: "test.dev",
      port: 8080,
      httpsPort: 8443,
      projects: ["/projects/other"],
    };
    const result = buildGlobalConfig(input, existing);
    expect(result.config.projects).toEqual(["/projects/other", "/projects/my-app"]);
    expect(result.message).toBe("added");
  });

  it("reports already-registered for duplicate project", () => {
    const existing = {
      domain: "test.dev",
      port: 8080,
      httpsPort: 8443,
      projects: ["/projects/my-app"],
    };
    const result = buildGlobalConfig(input, existing);
    expect(result.config.projects).toEqual(["/projects/my-app"]);
    expect(result.message).toBe("already-registered");
  });

  it("preserves existing domain/port over input values", () => {
    const existing = {
      domain: "test.dev",
      port: 8080,
      httpsPort: 8443,
      projects: [],
    };
    const result = buildGlobalConfig(input, existing);
    expect(result.config.domain).toBe("test.dev");
    expect(result.config.port).toBe(8080);
    expect(result.config.httpsPort).toBe(8443);
  });

  it("falls back to input values when existing has no domain/port", () => {
    const existing = { projects: [] };
    const result = buildGlobalConfig(input, existing);
    expect(result.config.domain).toBe("localhost");
    expect(result.config.port).toBe(3000);
    expect(result.config.httpsPort).toBe(3443);
  });

  it("does not mutate existing projects array", () => {
    const projects = ["/projects/other"];
    const existing = { domain: "test.dev", port: 8080, httpsPort: 8443, projects };
    buildGlobalConfig(input, existing);
    expect(projects).toEqual(["/projects/other"]);
  });
});

// ── buildRouteMap ───────────────────────────────────────────

describe("buildRouteMap", () => {
  it("builds route map from routes array", () => {
    const routes = [
      { subdomain: "api", port: "4000" },
      { subdomain: "web", port: "3000" },
    ];
    expect(buildRouteMap(routes, "")).toEqual({
      api: "http://localhost:4000",
      web: "http://localhost:3000",
    });
  });

  it("includes wildcard when provided", () => {
    const routes = [{ subdomain: "api", port: "4000" }];
    expect(buildRouteMap(routes, "5000")).toEqual({
      api: "http://localhost:4000",
      "*": "http://localhost:5000",
    });
  });

  it("omits wildcard when empty string", () => {
    expect(buildRouteMap([], "")).toEqual({});
  });

  it("returns empty map for no routes and no wildcard", () => {
    expect(buildRouteMap([], "")).toEqual({});
  });
});
