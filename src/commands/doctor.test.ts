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

vi.mock("../cli/net.js", () => ({
  getLanAddresses: () => [],
}));

vi.mock("node:crypto", () => ({
  X509Certificate: vi.fn(),
}));

const fetchPeersMock = vi.fn();
const readPeerClientConfigMock = vi.fn();
class PeerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
vi.mock("../cli/peer-client.js", () => ({
  fetchPeers: (...args: unknown[]) => fetchPeersMock(...args) as unknown,
  readPeerClientConfig: () => readPeerClientConfigMock() as unknown,
  PeerApiError,
}));

vi.mock("../proxy/pairing.js", () => ({
  loadDevices: vi.fn(),
  listDevices: () => new Map(),
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
const {
  collectSubdomains,
  withTimeout,
  checkWorktreeConfig,
  classifyAddress,
  describeDnsResult,
  describeCert,
  describePeerReadiness,
  checkJoinedRoot,
} = __testing;

// ── Lifecycle ──────────────────────────────────────────────

beforeEach(() => {
  readProjectConfigMock.mockReset();
  fetchPeersMock.mockReset();
  readPeerClientConfigMock.mockReset();
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
        configType: "json",
        routes: { app: "http://localhost:3000", api: "http://localhost:4000" },
        worktrees: {},
      },
      {
        path: "/p2",
        configPath: "/p2/.dev-proxy.json",
        configType: "json",
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
        configType: "json",
        routes: { app: "http://localhost:3000", "*": "http://localhost:9999" },
        worktrees: {},
      },
    ];

    const result = collectSubdomains(projects);
    expect(result).toEqual(["app"]);
    expect(result).not.toContain("*");
  });

  it("excludes apex '@' entries (no <sub>.<domain> host to look up)", () => {
    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        configType: "json",
        routes: {
          "@": "http://localhost:3500",
          app: "http://localhost:3000",
          "*": "http://localhost:9999",
        },
        worktrees: {},
      },
    ];

    const result = collectSubdomains(projects);
    expect(result).toEqual(["app"]);
    expect(result).not.toContain("@");
    expect(result).not.toContain("*");
  });

  it("deduplicates across projects", () => {
    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        configType: "json",
        routes: { app: "http://localhost:3000" },
        worktrees: {},
      },
      {
        path: "/p2",
        configPath: "/p2/.dev-proxy.json",
        configType: "json",
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
        configType: "json",
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
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        configType: "json",
        routes: {},
        worktrees: {},
      },
    ];

    const results = checkWorktreeConfig(projects);
    const conflict = results.find((r) => !r.ok && r.label.includes("port 4001"));
    expect(conflict).toBeDefined();
    expect(conflict?.label).toContain("feat1");
    expect(conflict?.label).toContain("feat2");
  });

  it("reports valid when no port conflicts exist", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: {
        feat1: { port: 4001 },
        feat2: { port: 4002 },
      },
    });

    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        configType: "json",
        routes: {},
        worktrees: {},
      },
    ];

    const results = checkWorktreeConfig(projects);
    const ok = results.find((r) => r.ok && r.label.includes("no port conflicts"));
    expect(ok).toBeDefined();
  });

  it("validates portRange (min < max)", () => {
    // worktrees come from the instance file (readProjectConfig); worktreeConfig
    // and routes are resolved from dev-proxy.config.mjs into the ProjectConfig.
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { port: 4001 } },
    });

    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/dev-proxy.config.mjs",
        configType: "js",
        routes: {},
        worktrees: {},
        worktreeConfig: {
          portRange: [4000, 5000],
          directory: "../{branch}",
        },
      },
    ];

    const results = checkWorktreeConfig(projects);
    const valid = results.find((r) => r.ok && r.label.includes("portRange"));
    expect(valid).toBeDefined();
    expect(valid?.label).toContain("[4000, 5000]");
  });

  it("reports invalid portRange when min >= max", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { port: 4001 } },
    });

    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/dev-proxy.config.mjs",
        configType: "js",
        routes: {},
        worktrees: {},
        worktreeConfig: {
          portRange: [5000, 4000],
          directory: "../{branch}",
        },
      },
    ];

    const results = checkWorktreeConfig(projects);
    const invalid = results.find((r) => !r.ok && r.label.includes("invalid portRange"));
    expect(invalid).toBeDefined();
  });

  it("reports invalid portRange when min === max", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { port: 4001 } },
    });

    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/dev-proxy.config.mjs",
        configType: "js",
        routes: {},
        worktrees: {},
        worktreeConfig: {
          portRange: [5000, 5000],
          directory: "../{branch}",
        },
      },
    ];

    const results = checkWorktreeConfig(projects);
    const invalid = results.find((r) => !r.ok && r.label.includes("invalid portRange"));
    expect(invalid).toBeDefined();
  });

  it("cross-checks services against routes — warns for service not in routes", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { ports: { app: 4001, api: 4002 } } },
    });

    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/dev-proxy.config.mjs",
        configType: "js",
        routes: { app: "http://localhost:3000" },
        worktrees: {},
        worktreeConfig: {
          portRange: [4000, 5000],
          directory: "../{branch}",
          services: {
            app: { env: "PORT_APP" },
            api: { env: "PORT_API" },
          },
        },
      },
    ];

    const results = checkWorktreeConfig(projects);
    const warn = results.find(
      (r) => !r.ok && r.warn && r.label.includes('service "api" not found in routes'),
    );
    expect(warn).toBeDefined();
  });

  it("reports valid when all services are in routes", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { ports: { app: 4001, api: 4002 } } },
    });

    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/dev-proxy.config.mjs",
        configType: "js",
        routes: { app: "http://localhost:3000", api: "http://localhost:4000" },
        worktrees: {},
        worktreeConfig: {
          portRange: [4000, 5000],
          directory: "../{branch}",
          services: {
            app: { env: "PORT_APP" },
            api: { env: "PORT_API" },
          },
        },
      },
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
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        configType: "json",
        routes: {},
        worktrees: {},
      },
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
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        configType: "json",
        routes: {},
        worktrees: {},
      },
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
      {
        path: "/p1",
        configPath: "/p1/.dev-proxy.json",
        configType: "json",
        routes: {},
        worktrees: {},
      },
    ];

    const results = checkWorktreeConfig(projects);
    const conflict = results.find((r) => !r.ok && r.label.includes("port 4002"));
    expect(conflict).toBeDefined();
    expect(conflict?.label).toContain("feat1");
    expect(conflict?.label).toContain("feat2");
  });

  it("handles wildcard service in cross-check (does not warn for '*')", () => {
    readProjectConfigMock.mockReturnValue({
      worktrees: { feat1: { ports: { app: 4001 } } },
    });

    const projects: ProjectConfig[] = [
      {
        path: "/p1",
        configPath: "/p1/dev-proxy.config.mjs",
        configType: "js",
        routes: { app: "http://localhost:3000" },
        worktrees: {},
        worktreeConfig: {
          portRange: [4000, 5000],
          directory: "../{branch}",
          services: {
            app: { env: "PORT_APP" },
            "*": { env: "PORT_DEFAULT" },
          },
        },
      },
    ];

    const results = checkWorktreeConfig(projects);
    const wildcardWarn = results.filter((r) => !r.ok && r.label.includes('service "*"'));
    expect(wildcardWarn).toHaveLength(0);
  });
});

// ── classifyAddress / describeDnsResult ────────────────────

describe("classifyAddress", () => {
  const lan = ["192.168.1.10", "10.0.0.5"];

  it("treats any 127.x address as loopback", () => {
    expect(classifyAddress("127.0.0.1", lan)).toBe("loopback");
    expect(classifyAddress("127.0.1.1", lan)).toBe("loopback");
  });

  it("recognises this machine's LAN addresses", () => {
    expect(classifyAddress("192.168.1.10", lan)).toBe("lan");
    expect(classifyAddress("10.0.0.5", lan)).toBe("lan");
  });

  it("flags anything else as other", () => {
    expect(classifyAddress("192.168.1.11", lan)).toBe("other");
    expect(classifyAddress("203.0.113.7", [])).toBe("other");
  });
});

describe("describeDnsResult", () => {
  const lan = ["192.168.1.10"];

  it("passes for loopback and says it is local only", () => {
    const r = describeDnsResult("app.test.dev", "127.0.0.1", lan);
    expect(r.ok).toBe(true);
    expect(r.label).toContain("this machine only");
  });

  it("passes for a LAN address and says it is reachable from the network", () => {
    const r = describeDnsResult("app.test.dev", "192.168.1.10", lan);
    expect(r.ok).toBe(true);
    expect(r.label).toContain("reachable from your network");
  });

  it("warns when the name resolves elsewhere", () => {
    const r = describeDnsResult("app.test.dev", "203.0.113.7", lan);
    expect(r.ok).toBe(false);
    expect(r.warn).toBe(true);
    expect(r.label).toContain("203.0.113.7");
  });
});

// ── describeCert ───────────────────────────────────────────

describe("describeCert", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const days = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000).toUTCString();

  function cert(overrides: Partial<Parameters<typeof describeCert>[0]> = {}) {
    return {
      issuer: "C=US\nO=Example CA\nCN=Example Root",
      validTo: days(90),
      checkHost: vi.fn(() => "ok"),
      ...overrides,
    };
  }

  it("reports the issuer CN, host coverage and validity", () => {
    const results = describeCert(cert(), "test.dev", now);
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(results[0]?.label).toBe("issued by Example Root");
    expect(results[1]?.label).toBe("covers *.test.dev and test.dev");
    expect(results[2]?.label).toBe("valid until 2026-04-01");
  });

  it("notes that mkcert certs are trusted on this machine only", () => {
    const results = describeCert(
      cert({ issuer: "O=mkcert development CA\nCN=mkcert dev@host" }),
      "test.dev",
      now,
    );
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.label).toContain("install its root CA on other devices");
  });

  it("fails coverage when the wildcard does not match", () => {
    const checkHost = vi.fn((name: string) =>
      name === "test.dev" ? "test.dev" : undefined,
    );
    const results = describeCert(cert({ checkHost }), "test.dev", now);
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.label).toContain("does not cover");
  });

  it("warns when the cert expires within 14 days", () => {
    const results = describeCert(cert({ validTo: days(5) }), "test.dev", now);
    expect(results[2]?.ok).toBe(false);
    expect(results[2]?.warn).toBe(true);
    expect(results[2]?.label).toContain("renew soon");
  });

  it("fails when the cert has expired", () => {
    const results = describeCert(cert({ validTo: days(-1) }), "test.dev", now);
    expect(results[2]?.ok).toBe(false);
    expect(results[2]?.warn).toBeUndefined();
    expect(results[2]?.label).toContain("expired");
  });
});

// ── describePeerReadiness ──────────────────────────────────

describe("describePeerReadiness", () => {
  const base = {
    domain: "test.dev",
    httpPort: 3000 as number | null,
    httpsPort: 443,
    cert: "public" as const,
    rootAddress: "192.168.1.5" as string | null,
    lanAddresses: ["192.168.1.5"],
    pairedDevices: 2,
  };
  const labels = (r: ReturnType<typeof describePeerReadiness>) => r.map((c) => c.label);

  it("is all green with public DNS, a public certificate and 443", () => {
    const results = describePeerReadiness(base);
    expect(results.every((c) => c.ok)).toBe(true);
    expect(labels(results)).toEqual([
      "root.test.dev → 192.168.1.5 (peers can find this machine by name)",
      "peers can join over https://root.test.dev",
      "2 paired machine(s)",
    ]);
  });

  it("warns when root.<domain> does not point at this machine", () => {
    expect(describePeerReadiness({ ...base, rootAddress: null })[0]).toMatchObject({
      ok: false,
      warn: true,
      label: expect.stringContaining("does not resolve") as string,
    });
    expect(describePeerReadiness({ ...base, rootAddress: "10.0.0.9" })[0]).toMatchObject({
      ok: false,
      warn: true,
      label: expect.stringContaining("not this machine's LAN address") as string,
    });
  });

  it("warns about a non-443 https port and names the fallback", () => {
    expect(describePeerReadiness({ ...base, httpsPort: 3443 })[1]).toMatchObject({
      warn: true,
      label:
        "httpsPort is 3443 — `peer join` falls back to plain HTTP on :3000; set httpsPort 443",
    });
    expect(
      describePeerReadiness({ ...base, httpsPort: 3443, httpPort: null })[1],
    ).toMatchObject({
      label: expect.stringContaining("has nothing to fall back to") as string,
    });
  });

  it("explains mkcert and missing certificates", () => {
    expect(describePeerReadiness({ ...base, cert: "mkcert" })[1]).toMatchObject({
      ok: false,
      warn: true,
      label:
        "mkcert certificate is not trusted on other machines — peers join over plain HTTP on :3000",
    });
    expect(describePeerReadiness({ ...base, cert: "none", httpPort: null })[1]).toEqual({
      ok: false,
      label: "no certificate and the HTTP listener is off — peers cannot join",
    });
  });
});

// ── checkJoinedRoot ────────────────────────────────────────

describe("checkJoinedRoot", () => {
  it("is silent when this machine has not joined a root", async () => {
    readPeerClientConfigMock.mockReturnValue(null);
    await expect(checkJoinedRoot()).resolves.toBeNull();
  });

  it("reports the root and its claims when the token still works", async () => {
    readPeerClientConfigMock.mockReturnValue({ root: "https://root.d", token: "t" });
    fetchPeersMock.mockResolvedValue({ domain: "d", peers: { a: {}, b: {} } });
    await expect(checkJoinedRoot()).resolves.toEqual({
      ok: true,
      label: "joined https://root.d (2 claim(s) on the root)",
    });
  });

  it("tells the user to re-join when the root revoked the token", async () => {
    readPeerClientConfigMock.mockReturnValue({ root: "https://root.d", token: "t" });
    fetchPeersMock.mockRejectedValue(
      new PeerApiError("invalid or missing bearer token", 401),
    );
    await expect(checkJoinedRoot()).resolves.toMatchObject({
      ok: false,
      label: expect.stringContaining("run `peer join` again") as string,
    });

    fetchPeersMock.mockRejectedValue(
      new PeerApiError("cannot reach root proxy at https://root.d: timed out"),
    );
    await expect(checkJoinedRoot()).resolves.toEqual({
      ok: false,
      label: "cannot reach root proxy at https://root.d: timed out",
    });
  });
});
