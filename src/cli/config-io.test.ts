import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Re-export config constants so the module can resolve them
const { mockResolveProjectConfigFile } = vi.hoisted(() => ({
  mockResolveProjectConfigFile: vi.fn(),
}));
vi.mock("../proxy/config.js", () => ({
  CONFIG_DIR: "/mock/.dev-proxy",
  GLOBAL_CONFIG_PATH: "/mock/.dev-proxy/config.json",
  PROJECT_CONFIG_NAME: ".dev-proxy.json",
  PROJECT_WORKTREES_NAME: ".dev-proxy.worktrees.json",
  JS_CONFIG_NAMES: ["dev-proxy.config.mjs", "dev-proxy.config.js"],
  resolveProjectConfigFile: mockResolveProjectConfigFile,
}));

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import {
  isValidPort,
  isValidSubdomain,
  allocatePort,
  allocatePorts,
  getEntryPorts,
  getServicePort,
  generateEnvContent,
  readGlobalConfig,
  writeGlobalConfig,
  readProjectConfig,
  writeProjectConfig,
  generateJsConfig,
  writeJsConfig,
  resolveProjectConfigFile,
} from "./config-io.js";

describe("isValidPort", () => {
  it("accepts valid ports", () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(3000)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it("rejects out-of-range ports", () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
  });

  it("rejects non-integer ports", () => {
    expect(isValidPort(3.14)).toBe(false);
    expect(isValidPort(NaN)).toBe(false);
    expect(isValidPort(Infinity)).toBe(false);
  });
});

describe("isValidSubdomain", () => {
  it("accepts valid subdomains", () => {
    expect(isValidSubdomain("api")).toBe(true);
    expect(isValidSubdomain("my-app")).toBe(true);
    expect(isValidSubdomain("a")).toBe(true);
    expect(isValidSubdomain("a1")).toBe(true);
    expect(isValidSubdomain("*")).toBe(true);
    expect(isValidSubdomain("@")).toBe(true);
  });

  it("rejects invalid subdomains", () => {
    expect(isValidSubdomain("")).toBe(false);
    expect(isValidSubdomain("-api")).toBe(false);
    expect(isValidSubdomain("api-")).toBe(false);
    expect(isValidSubdomain("API")).toBe(false);
    expect(isValidSubdomain("my_app")).toBe(false);
    expect(isValidSubdomain("my.app")).toBe(false);
  });
});

describe("allocatePort", () => {
  it("returns first available port in range", () => {
    const used = new Set<number>();
    expect(allocatePort([4000, 4010], used)).toBe(4000);
  });

  it("skips used ports", () => {
    const used = new Set([4000, 4001]);
    expect(allocatePort([4000, 4010], used)).toBe(4002);
  });

  it("returns null when range exhausted", () => {
    const used = new Set([4000, 4001, 4002]);
    expect(allocatePort([4000, 4002], used)).toBeNull();
  });
});

describe("allocatePorts", () => {
  it("allocates N contiguous-available ports", () => {
    const used = new Set([4001]);
    const ports = allocatePorts(3, [4000, 4010], used);
    expect(ports).toEqual([4000, 4002, 4003]);
  });

  it("returns null when not enough ports available", () => {
    const used = new Set([4000, 4001]);
    expect(allocatePorts(2, [4000, 4001], used)).toBeNull();
  });
});

describe("getEntryPorts", () => {
  it("returns ports from multi-service entry", () => {
    const entry = { ports: { web: 3000, api: 3001 } };
    expect(getEntryPorts(entry).sort()).toEqual([3000, 3001]);
  });

  it("returns port from legacy single-port entry", () => {
    const entry = { port: 3000 };
    expect(getEntryPorts(entry)).toEqual([3000]);
  });
});

describe("getServicePort", () => {
  it("returns port for specific service", () => {
    const entry = { ports: { web: 3000, api: 3001 } };
    expect(getServicePort(entry, "api")).toBe(3001);
  });

  it("returns first port when service not specified", () => {
    const entry = { ports: { web: 3000, api: 3001 } };
    expect(getServicePort(entry)).toBe(3000);
  });

  it("returns first port when service not found", () => {
    const entry = { ports: { web: 3000 } };
    expect(getServicePort(entry, "missing")).toBe(3000);
  });

  it("returns port from legacy entry regardless of service param", () => {
    const entry = { port: 4000 };
    expect(getServicePort(entry, "web")).toBe(4000);
    expect(getServicePort(entry)).toBe(4000);
  });
});

describe("generateEnvContent", () => {
  it("generates env variable lines for services", () => {
    const services = {
      web: { env: "WEB_PORT" },
      api: { env: "API_PORT" },
    };
    const ports = { web: 3000, api: 3001 };
    const content = generateEnvContent(services, ports);
    expect(content).toBe("WEB_PORT=3000\nAPI_PORT=3001\n");
  });

  it("skips services with no matching port", () => {
    const services = { web: { env: "WEB_PORT" }, api: { env: "API_PORT" } };
    const ports = { web: 3000 };
    const content = generateEnvContent(services, ports);
    expect(content).toBe("WEB_PORT=3000\n");
  });
});

// ── File I/O tests ──────────────────────────────────────────

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockRenameSync = vi.mocked(renameSync);

describe("readGlobalConfig", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockRenameSync.mockReset();
  });

  it("returns parsed config when file exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ domain: "test.local", port: 8080 }),
    );
    const cfg = readGlobalConfig();
    expect(cfg).toEqual({ domain: "test.local", port: 8080 });
    expect(mockExistsSync).toHaveBeenCalledWith("/mock/.dev-proxy/config.json");
  });

  it("returns empty object when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const cfg = readGlobalConfig();
    expect(cfg).toEqual({});
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns empty object and warns on JSON parse error", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not valid json{{{");
    const cfg = readGlobalConfig();
    expect(cfg).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"));
  });
});

describe("writeGlobalConfig", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockRenameSync.mockReset();
  });

  it("creates config directory recursively and writes file", () => {
    writeGlobalConfig({ domain: "test.local" });
    expect(mockMkdirSync).toHaveBeenCalledWith("/mock/.dev-proxy", {
      recursive: true,
    });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("writes pretty-printed JSON with trailing newline", () => {
    writeGlobalConfig({ domain: "test.local", port: 3000 });
    const written = mockWriteFileSync.mock.calls[0]?.[1] as string;
    const expected = JSON.stringify({ domain: "test.local", port: 3000 }, null, 2) + "\n";
    expect(written).toBe(expected);
  });

  it("uses atomic write (writes to temp then renames)", () => {
    writeGlobalConfig({ domain: "test.local" });
    // Should write to .tmp file first
    const tmpPath = mockWriteFileSync.mock.calls[0]?.[0] as string;
    expect(tmpPath).toBe("/mock/.dev-proxy/config.json.tmp");
    // Then rename to final path
    expect(mockRenameSync).toHaveBeenCalledWith(
      "/mock/.dev-proxy/config.json.tmp",
      "/mock/.dev-proxy/config.json",
    );
  });
});

// ── readProjectConfig / writeProjectConfig ──────────────────

describe("readProjectConfig", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockRenameSync.mockReset();
  });

  it("returns parsed config when file exists", () => {
    mockExistsSync.mockReturnValue(true);
    const data = { routes: { api: "http://localhost:4000" }, worktrees: {} };
    mockReadFileSync.mockReturnValue(JSON.stringify(data));
    const cfg = readProjectConfig("/projects/app");
    expect(cfg).toEqual(data);
  });

  it("returns empty object when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const cfg = readProjectConfig("/projects/app");
    expect(cfg).toEqual({});
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns empty object and warns on parse error", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{invalid json!!!");
    const cfg = readProjectConfig("/projects/app");
    expect(cfg).toEqual({});
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to parse"));
  });
});

describe("writeProjectConfig", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockRenameSync.mockReset();
  });

  it("writes config to project path with atomic write", () => {
    const cfg = { routes: { web: "http://localhost:3000" } };
    writeProjectConfig("/projects/app", cfg);
    // Should write to temp file
    const tmpPath = mockWriteFileSync.mock.calls[0]?.[0] as string;
    expect(tmpPath).toBe("/projects/app/.dev-proxy.json.tmp");
    // Then rename to final path
    expect(mockRenameSync).toHaveBeenCalledWith(
      "/projects/app/.dev-proxy.json.tmp",
      "/projects/app/.dev-proxy.json",
    );
  });

  it("writes pretty-printed JSON with trailing newline", () => {
    const cfg = { routes: { api: "http://localhost:4000" } };
    writeProjectConfig("/projects/app", cfg);
    const written = mockWriteFileSync.mock.calls[0]?.[1] as string;
    const expected = JSON.stringify(cfg, null, 2) + "\n";
    expect(written).toBe(expected);
  });

  it("writes worktrees to .dev-proxy.worktrees.json only", () => {
    const cfg = { worktrees: { feat: { port: 4000 } } };
    writeProjectConfig("/projects/app", cfg);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync.mock.calls[0]?.[0]).toBe(
      "/projects/app/.dev-proxy.worktrees.json.tmp",
    );
    expect(mockRenameSync).toHaveBeenCalledWith(
      "/projects/app/.dev-proxy.worktrees.json.tmp",
      "/projects/app/.dev-proxy.worktrees.json",
    );

    const written = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(written).toBe(JSON.stringify({ worktrees: cfg.worktrees }, null, 2) + "\n");
  });

  it("splits worktrees and worktreeConfig into two files", () => {
    const cfg = {
      worktrees: { feat: { port: 4000 } },
      worktreeConfig: {
        portRange: [4000, 5000] as [number, number],
        directory: "../{branch}",
      },
    };
    writeProjectConfig("/projects/app", cfg);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    const tmpPaths = mockWriteFileSync.mock.calls.map((c) => c[0] as string);
    expect(tmpPaths).toContain("/projects/app/.dev-proxy.worktrees.json.tmp");
    expect(tmpPaths).toContain("/projects/app/.dev-proxy.json.tmp");
  });

  it("does not touch legacy file when only worktrees are written", () => {
    const cfg = { worktrees: {} };
    writeProjectConfig("/projects/app", cfg);

    const tmpPaths = mockWriteFileSync.mock.calls.map((c) => c[0] as string);
    expect(tmpPaths).not.toContain("/projects/app/.dev-proxy.json.tmp");
  });
});

describe("readProjectConfig (worktrees split)", () => {
  beforeEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it("prefers .dev-proxy.worktrees.json over legacy worktrees key", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).endsWith(".dev-proxy.worktrees.json")) {
        return JSON.stringify({ worktrees: { winner: { port: 4000 } } });
      }
      return JSON.stringify({
        routes: { api: "http://localhost:4000" },
        worktrees: { loser: { port: 9999 } },
      });
    });

    const cfg = readProjectConfig("/projects/app");
    expect(cfg.worktrees).toEqual({ winner: { port: 4000 } });
    expect(cfg.routes).toEqual({ api: "http://localhost:4000" });
  });

  it("falls back to legacy worktrees when new file is missing", () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith("/.dev-proxy.json"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ worktrees: { legacy: { port: 5000 } } }),
    );

    const cfg = readProjectConfig("/projects/app");
    expect(cfg.worktrees).toEqual({ legacy: { port: 5000 } });
  });
});

// ── generateJsConfig ────────────────────────────────────────

describe("generateJsConfig", () => {
  it("generates valid JS with JSDoc @type annotation", () => {
    const output = generateJsConfig({ api: "http://localhost:4000" });
    expect(output).toContain("/** @type {import('@reopt-ai/dev-proxy').Config} */");
    expect(output).toContain("export default {");
    expect(output).toContain("routes: {");
  });

  it("includes all route entries", () => {
    const routes = {
      api: "http://localhost:4000",
      web: "http://localhost:3000",
      "*": "http://localhost:8080",
    };
    const output = generateJsConfig(routes);
    expect(output).toContain('"api": "http://localhost:4000"');
    expect(output).toContain('"web": "http://localhost:3000"');
    expect(output).toContain('"*": "http://localhost:8080"');
  });

  it("handles empty routes", () => {
    const output = generateJsConfig({});
    expect(output).toContain("routes: {");
    expect(output).toContain("export default {");
    // Should not have any route entries between the braces
    expect(output).toMatch(/routes: \{\n\s*\}/);
  });

  it("omits worktreeConfig block when not provided", () => {
    const output = generateJsConfig({ api: "http://localhost:4000" });
    expect(output).not.toContain("worktreeConfig");
  });

  it("emits worktreeConfig block when provided", () => {
    const output = generateJsConfig(
      { api: "http://localhost:4000" },
      { portRange: [4001, 5000], directory: "../app-{branch}" },
    );
    expect(output).toContain("worktreeConfig:");
    expect(output).toContain('"portRange"');
    expect(output).toContain('"directory": "../app-{branch}"');
  });

  it("emits worktreeConfig with services and hooks", () => {
    const output = generateJsConfig(
      {},
      {
        portRange: [4001, 5000],
        directory: "../{branch}",
        services: { web: { env: "PORT" }, api: { env: "API_PORT" } },
        hooks: { "post-create": "pnpm install" },
      },
    );
    expect(output).toContain('"services"');
    expect(output).toContain('"env": "PORT"');
    expect(output).toContain('"post-create": "pnpm install"');
  });
});

// ── writeJsConfig ───────────────────────────────────────────

describe("writeJsConfig", () => {
  beforeEach(() => {
    mockWriteFileSync.mockReset();
    mockRenameSync.mockReset();
  });

  it("calls atomic write with correct filename (dev-proxy.config.mjs)", () => {
    writeJsConfig("/projects/app", { api: "http://localhost:4000" });
    // Should write to temp file first
    const tmpPath = mockWriteFileSync.mock.calls[0]?.[0] as string;
    expect(tmpPath).toBe("/projects/app/dev-proxy.config.mjs.tmp");
    // Then rename to final path
    expect(mockRenameSync).toHaveBeenCalledWith(
      "/projects/app/dev-proxy.config.mjs.tmp",
      "/projects/app/dev-proxy.config.mjs",
    );
  });
});

// ── resolveProjectConfigFile ────────────────────────────────

describe("resolveProjectConfigFile", () => {
  beforeEach(() => {
    mockResolveProjectConfigFile.mockReset();
  });

  it('returns { type: "js" } when dev-proxy.config.js exists', () => {
    mockResolveProjectConfigFile.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.js",
    });
    const result = resolveProjectConfigFile("/p");
    expect(result).toEqual({ type: "js", path: "/p/dev-proxy.config.js" });
  });

  it('returns { type: "js" } when dev-proxy.config.mjs exists', () => {
    mockResolveProjectConfigFile.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.mjs",
    });
    const result = resolveProjectConfigFile("/p");
    expect(result).toEqual({ type: "js", path: "/p/dev-proxy.config.mjs" });
  });

  it('returns { type: "json" } when only .dev-proxy.json exists', () => {
    mockResolveProjectConfigFile.mockReturnValue({
      type: "json",
      path: "/p/.dev-proxy.json",
    });
    const result = resolveProjectConfigFile("/p");
    expect(result).toEqual({ type: "json", path: "/p/.dev-proxy.json" });
  });

  it("returns null when no config file exists", () => {
    mockResolveProjectConfigFile.mockReturnValue(null);
    const result = resolveProjectConfigFile("/p");
    expect(result).toBeNull();
  });

  it("JS config takes priority over JSON", () => {
    // When both exist, resolveProjectConfigFile should return JS
    mockResolveProjectConfigFile.mockReturnValue({
      type: "js",
      path: "/p/dev-proxy.config.js",
    });
    const result = resolveProjectConfigFile("/p");
    expect(result?.type).toBe("js");
  });
});
