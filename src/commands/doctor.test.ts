import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "../proxy/config.js";

// ── Mocks ───────────────────────────────────────────────────
// Must be set up before importing the module under test.

// Mock config module — prevent file-system reads at import time
vi.mock("../proxy/config.js", () => ({
  config: { domain: "test.dev", port: 3000, httpsPort: 3443, projects: [] },
  CONFIG_DIR: "/mock/.dev-proxy",
  GLOBAL_CONFIG_PATH: "/mock/.dev-proxy/config.json",
}));

const readProjectConfigMock = vi.fn();

vi.mock("../cli/config-io.js", () => ({
  readProjectConfig: readProjectConfigMock,
  getEntryPorts: (entry: { ports?: Record<string, number>; port?: number }) => {
    if ("ports" in entry && entry.ports) return Object.values(entry.ports);
    return [entry.port];
  },
}));

vi.mock("../cli/output.js", () => ({
  Header: () => null,
  Check: () => null,
  Section: () => null,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn() },
}));

vi.mock("node:net", () => ({
  createServer: vi.fn(),
  createConnection: vi.fn(),
}));

// Mock ink to prevent rendering side effects
vi.mock("ink", () => ({
  render: vi.fn(),
  Box: () => null,
  Text: () => null,
  useApp: () => ({ exit: vi.fn() }),
}));

vi.mock("react", () => ({
  useState: vi.fn((init: unknown) => [init, vi.fn()]),
  useEffect: vi.fn(),
}));

const { __testing } = await import("./doctor.js");
const { collectSubdomains, withTimeout, checkWorktreeConfig } = __testing;

// ── Lifecycle ──────────────────────────────────────────────

beforeEach(() => {
  readProjectConfigMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── collectSubdomains ──────────────────────────────────────

describe("collectSubdomains", () => {
  it("collects unique subdomains from multiple projects", () => {
    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        routes: { app: "http://localhost:3000", api: "http://localhost:4000" },
        worktrees: {},
      },
      {
        path: "/p2",
        configPath: "/p2/.dev-proxy.json",
        routes: { web: "http://localhost:5000" },
        worktrees: {},
      },
    ];

    const result = collectSubdomains(projects);
    expect(result).toEqual(expect.arrayContaining(["app", "api", "web"]));
    expect(result).toHaveLength(3);
  });

  it("excludes wildcard '*' entries", () => {
    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        routes: { app: "http://localhost:3000", "*": "http://localhost:9999" },
        worktrees: {},
      },
    ];

    const result = collectSubdomains(projects);
    expect(result).toEqual(["app"]);
    expect(result).not.toContain("*");
  });

  it("deduplicates across projects", () => {
    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        routes: { app: "http://localhost:3000" },
        worktrees: {},
      },
      {
        path: "/p2",
        configPath: "/p2/.dev-proxy.json",
        routes: { app: "http://localhost:4000" },
        worktrees: {},
      },
    ];

    const result = collectSubdomains(projects);
    expect(result).toEqual(["app"]);
  });

  it("returns empty array when no projects or no routes", () => {
    expect(collectSubdomains([])).toEqual([]);

    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        routes: {},
        worktrees: {},
      },
    ];
    expect(collectSubdomains(projects)).toEqual([]);
  });
});

// ── withTimeout ────────────────────────────────────────────

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves when promise completes before timeout", async () => {
    const promise = Promise.resolve("ok");
    const result = await withTimeout(promise, 5000);
    expect(result).toBe("ok");
  });

  it("rejects with 'timeout' when promise takes too long", async () => {
    const neverResolves = new Promise<string>(() => {
      /* never resolves */
    });

    const racePromise = withTimeout(neverResolves, 1000);
    vi.advanceTimersByTime(1001);

    await expect(racePromise).rejects.toThrow("timeout");
  });

  it("propagates original promise rejection", async () => {
    const failing = Promise.reject(new Error("original error"));

    await expect(withTimeout(failing, 5000)).rejects.toThrow("original error");
  });
});

// ── checkWorktreeConfig ────────────────────────────────────

describe("checkWorktreeConfig", () => {
  it("detects port conflicts across worktrees in same project", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: {
        feat1: { port: 4001 },
        feat2: { port: 4001 },
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    const conflict = results.find((r) => !r.ok && r.label.includes("port 4001"));
    expect(conflict).toBeDefined();
    expect(conflict!.label).toContain("feat1");
    expect(conflict!.label).toContain("feat2");
  });

  it("reports valid when no port conflicts exist", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: {
        feat1: { port: 4001 },
        feat2: { port: 4002 },
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    const ok = results.find((r) => r.ok && r.label.includes("no port conflicts"));
    expect(ok).toBeDefined();
  });

  it("validates portRange (min < max)", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { port: 4001 } },
      worktreeConfig: {
        portRange: [4000, 5000],
        directory: "../{branch}",
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    const valid = results.find((r) => r.ok && r.label.includes("portRange"));
    expect(valid).toBeDefined();
    expect(valid!.label).toContain("[4000, 5000]");
  });

  it("reports invalid portRange when min >= max", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { port: 4001 } },
      worktreeConfig: {
        portRange: [5000, 4000],
        directory: "../{branch}",
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    const invalid = results.find((r) => !r.ok && r.label.includes("invalid portRange"));
    expect(invalid).toBeDefined();
  });

  it("reports invalid portRange when min === max", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { port: 4001 } },
      worktreeConfig: {
        portRange: [5000, 5000],
        directory: "../{branch}",
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    const invalid = results.find((r) => !r.ok && r.label.includes("invalid portRange"));
    expect(invalid).toBeDefined();
  });

  it("cross-checks services against routes — warns for service not in routes", () => {
    readProjectConfigMock.mockReturnValue({
      routes: { app: "http://localhost:3000" },
      worktrees: { feat1: { ports: { app: 4001, api: 4002 } } },
      worktreeConfig: {
        portRange: [4000, 5000],
        directory: "../{branch}",
        services: {
          app: { env: "PORT_APP" },
          api: { env: "PORT_API" },
        },
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    const warn = results.find(
      (r) => !r.ok && r.warn && r.label.includes('service "api" not found in routes'),
    );
    expect(warn).toBeDefined();
  });

  it("reports valid when all services are in routes", () => {
    readProjectConfigMock.mockReturnValue({
      routes: { app: "http://localhost:3000", api: "http://localhost:4000" },
      worktrees: { feat1: { ports: { app: 4001, api: 4002 } } },
      worktreeConfig: {
        portRange: [4000, 5000],
        directory: "../{branch}",
        services: {
          app: { env: "PORT_APP" },
          api: { env: "PORT_API" },
        },
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    // No warning about services not found in routes
    const serviceWarnings = results.filter(
      (r) => !r.ok && r.label.includes("not found in routes"),
    );
    expect(serviceWarnings).toHaveLength(0);
  });

  it("handles project with no worktrees (returns no results for that project)", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: {},
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    expect(results).toEqual([]);
  });

  it("handles project with no worktreeConfig (skips portRange/services validation)", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: {
        feat1: { port: 4001 },
        feat2: { port: 4002 },
      },
      // No worktreeConfig
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    // Should still check port conflicts but not portRange or services
    const portRangeResults = results.filter((r) => r.label.includes("portRange"));
    expect(portRangeResults).toHaveLength(0);
    const serviceResults = results.filter((r) => r.label.includes("service"));
    expect(serviceResults).toHaveLength(0);
  });

  it("detects port conflicts in multi-service worktrees", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: {
        feat1: { ports: { app: 4001, api: 4002 } },
        feat2: { ports: { app: 4002, api: 4003 } },
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    const conflict = results.find((r) => !r.ok && r.label.includes("port 4002"));
    expect(conflict).toBeDefined();
    expect(conflict!.label).toContain("feat1");
    expect(conflict!.label).toContain("feat2");
  });

  it("handles wildcard service in cross-check (does not warn for '*')", () => {
    readProjectConfigMock.mockReturnValue({
      routes: { app: "http://localhost:3000" },
      worktrees: { feat1: { ports: { app: 4001 } } },
      worktreeConfig: {
        portRange: [4000, 5000],
        directory: "../{branch}",
        services: {
          app: { env: "PORT_APP" },
          "*": { env: "PORT_DEFAULT" },
        },
      },
    });

    const projects: ProjectConfig[] = [
      { path: "/p1", configPath: "/p1/.dev-proxy.json", routes: {}, worktrees: {} },
    ];

    const results = checkWorktreeConfig(projects);
    const wildcardWarn = results.filter((r) => !r.ok && r.label.includes('service "*"'));
    expect(wildcardWarn).toHaveLength(0);
  });
});
