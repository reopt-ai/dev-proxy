import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real fs for creating temp test files (separate from mocked fs)
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

// ── Mocks ───────────────────────────────────────────────────
// Must be set up before importing the module under test.

const fsMock = {
  existsSync: vi.fn<(p: string) => boolean>(),
  readFileSync: vi.fn<(p: string, enc: string) => string>(),
};

vi.mock("node:fs", () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock("node:url", () => ({
  pathToFileURL: (p: string) => new URL(`file://${p}`),
}));

// Now import after mocks are in place
const mod = await import("./config.js");
const { __testing, CONFIG_DIR, GLOBAL_CONFIG_PATH, PROJECT_CONFIG_NAME, reloadConfig } =
  mod;

const {
  parsePort,
  resolveFilePath,
  loadJson,
  loadProjectConfig,
  loadConfig,
  resolveProjectConfigFile,
  loadJsConfig,
} = __testing;

// ── Lifecycle ──────────────────────────────────────────────

beforeEach(() => {
  fsMock.existsSync.mockReset();
  fsMock.readFileSync.mockReset();
});

// ── Tests ──────────────────────────────────────────────────

describe("parsePort", () => {
  it("returns fallback for undefined", () => {
    expect(parsePort("test", undefined, 3000)).toBe(3000);
  });

  it("accepts valid port", () => {
    expect(parsePort("test", 8080, 3000)).toBe(8080);
  });

  it("accepts port 1 (minimum)", () => {
    expect(parsePort("test", 1, 3000)).toBe(1);
  });

  it("accepts port 65535 (maximum)", () => {
    expect(parsePort("test", 65535, 3000)).toBe(65535);
  });

  it("rejects port 0 and returns fallback", () => {
    expect(parsePort("test", 0, 3000)).toBe(3000);
  });

  it("rejects negative port", () => {
    expect(parsePort("test", -1, 3000)).toBe(3000);
  });

  it("rejects port > 65535", () => {
    expect(parsePort("test", 70000, 3000)).toBe(3000);
  });

  it("rejects non-integer", () => {
    expect(parsePort("test", 3.14, 3000)).toBe(3000);
  });

  it("rejects NaN", () => {
    expect(parsePort("test", NaN, 3000)).toBe(3000);
  });

  it("rejects Infinity", () => {
    expect(parsePort("test", Infinity, 3000)).toBe(3000);
  });

  it("logs error with label when rejecting", () => {
    parsePort("httpsPort", 99999, 3443);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("httpsPort"));
  });
});

describe("resolveFilePath", () => {
  it("returns undefined for undefined input", () => {
    expect(resolveFilePath(undefined, "/base/config.json")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(resolveFilePath("", "/base/config.json")).toBeUndefined();
  });

  it("returns absolute path as-is", () => {
    expect(resolveFilePath("/etc/certs/cert.pem", "/base/config.json")).toBe(
      "/etc/certs/cert.pem",
    );
  });

  it("resolves relative path against base directory", () => {
    const result = resolveFilePath("certs/cert.pem", "/home/user/.dev-proxy/config.json");
    expect(result).toBe("/home/user/.dev-proxy/certs/cert.pem");
  });
});

// ── loadJson ───────────────────────────────────────────────

describe("loadJson", () => {
  it("returns parsed JSON object for valid file", () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue('{"domain":"example.dev","port":8080}');

    const result = loadJson("/some/config.json");

    expect(result).toEqual({ domain: "example.dev", port: 8080 });
    expect(fsMock.existsSync).toHaveBeenCalledWith("/some/config.json");
    expect(fsMock.readFileSync).toHaveBeenCalledWith("/some/config.json", "utf-8");
  });

  it("returns null when file does not exist", () => {
    fsMock.existsSync.mockReturnValue(false);

    const result = loadJson("/missing/config.json");

    expect(result).toBeNull();
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
  });

  it("returns null and logs error for invalid JSON", () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue("{not valid json}");

    const result = loadJson("/bad/config.json");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse /bad/config.json"),
    );
  });

  it("returns null for empty file", () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue("");

    const result = loadJson("/empty/config.json");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse /empty/config.json"),
    );
  });
});

// ── loadProjectConfig ──────────────────────────────────────

describe("loadProjectConfig", () => {
  it("returns routes and worktrees from valid .dev-proxy.json", async () => {
    const projectDir = "/projects/my-app";
    const configPath = `${projectDir}/${PROJECT_CONFIG_NAME}`;
    const rawConfig = {
      routes: { app: "http://localhost:3000", api: "http://localhost:4000" },
      worktrees: { feature: { ports: { app: 3001, api: 4001 } } },
    };

    fsMock.existsSync.mockImplementation((p: string) => p === configPath);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(rawConfig));

    const result = await loadProjectConfig(projectDir);

    expect(result).toEqual({
      path: projectDir,
      configPath,
      configType: "json",
      routes: rawConfig.routes,
      worktrees: rawConfig.worktrees,
    });
  });

  it("returns null when config file does not exist", async () => {
    fsMock.existsSync.mockReturnValue(false);

    const result = await loadProjectConfig("/projects/missing");

    expect(result).toBeNull();
  });

  it("defaults missing routes to empty object", async () => {
    const projectDir = "/projects/no-routes";
    const configPath = `${projectDir}/${PROJECT_CONFIG_NAME}`;

    fsMock.existsSync.mockImplementation((p: string) => p === configPath);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ worktrees: { feat: { port: 5000 } } }),
    );

    const result = await loadProjectConfig(projectDir);

    expect(result).not.toBeNull();
    expect(result?.routes).toEqual({});
    expect(result?.worktrees).toEqual({ feat: { port: 5000 } });
  });

  it("defaults missing worktrees to empty object", async () => {
    const projectDir = "/projects/no-worktrees";
    const configPath = `${projectDir}/${PROJECT_CONFIG_NAME}`;

    fsMock.existsSync.mockImplementation((p: string) => p === configPath);
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ routes: { web: "http://localhost:3000" } }),
    );

    const result = await loadProjectConfig(projectDir);

    expect(result).not.toBeNull();
    expect(result?.routes).toEqual({ web: "http://localhost:3000" });
    expect(result?.worktrees).toEqual({});
  });
});

// ── resolveProjectConfigFile ─────────────────────────────────

describe("resolveProjectConfigFile", () => {
  it("returns js type when dev-proxy.config.js exists", () => {
    fsMock.existsSync.mockImplementation((p: string) => p === "/app/dev-proxy.config.js");
    const result = resolveProjectConfigFile("/app");
    expect(result).toEqual({ type: "js", path: "/app/dev-proxy.config.js" });
  });

  it("returns js type when dev-proxy.config.mjs exists", () => {
    fsMock.existsSync.mockImplementation(
      (p: string) => p === "/app/dev-proxy.config.mjs",
    );
    const result = resolveProjectConfigFile("/app");
    expect(result).toEqual({ type: "js", path: "/app/dev-proxy.config.mjs" });
  });

  it("returns json type when only .dev-proxy.json exists", () => {
    fsMock.existsSync.mockImplementation((p: string) => p === "/app/.dev-proxy.json");
    const result = resolveProjectConfigFile("/app");
    expect(result).toEqual({ type: "json", path: "/app/.dev-proxy.json" });
  });

  it("returns null when no config file exists", () => {
    fsMock.existsSync.mockReturnValue(false);
    expect(resolveProjectConfigFile("/app")).toBeNull();
  });

  it("prefers JS config over JSON", () => {
    fsMock.existsSync.mockReturnValue(true);
    const result = resolveProjectConfigFile("/app");
    expect(result?.type).toBe("js");
  });
});

// ── loadJsConfig ─────────────────────────────────────────────

describe("loadJsConfig", () => {
  it("returns null and logs error for non-existent file", async () => {
    const result = await loadJsConfig("/nonexistent/dev-proxy.config.js");
    expect(result).toBeNull();
  });

  it("loads routes from a real JS config file", async () => {
    const tmpDir = realFs.mkdtempSync(join(tmpdir(), "dev-proxy-test-"));
    const configPath = join(tmpDir, "dev-proxy.config.js");
    realFs.writeFileSync(
      configPath,
      'export default { routes: { api: "http://localhost:4000" } };\n',
    );

    try {
      const result = await loadJsConfig(configPath);
      expect(result).toEqual({ routes: { api: "http://localhost:4000" } });
    } finally {
      realFs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── loadProjectConfig with JS config ─────────────────────────

describe("loadProjectConfig (JS config path)", () => {
  it("loads routes from JS config and worktrees from JSON", async () => {
    const tmpDir = realFs.mkdtempSync(join(tmpdir(), "dev-proxy-test-"));
    const jsPath = join(tmpDir, "dev-proxy.config.js");
    const jsonPath = join(tmpDir, ".dev-proxy.json");
    realFs.writeFileSync(
      jsPath,
      'export default { routes: { web: "http://localhost:3000" } };\n',
    );
    realFs.writeFileSync(
      jsonPath,
      JSON.stringify({ worktrees: { feat: { port: 5000 } } }),
    );

    // Mock existsSync to return true for both config files in tmpDir
    fsMock.existsSync.mockImplementation((p: string) => p === jsPath || p === jsonPath);
    fsMock.readFileSync.mockImplementation((p: string) => {
      if (p === jsonPath) return JSON.stringify({ worktrees: { feat: { port: 5000 } } });
      return "";
    });

    try {
      const result = await loadProjectConfig(tmpDir);
      expect(result).not.toBeNull();
      expect(result?.configType).toBe("js");
      expect(result?.routes).toEqual({ web: "http://localhost:3000" });
      expect(result?.worktrees).toEqual({ feat: { port: 5000 } });
    } finally {
      realFs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("returns null when JS config fails to load", async () => {
    const tmpDir = realFs.mkdtempSync(join(tmpdir(), "dev-proxy-test-"));
    const jsPath = join(tmpDir, "dev-proxy.config.js");
    realFs.writeFileSync(jsPath, "this is not valid javascript }{{{");

    fsMock.existsSync.mockImplementation((p: string) => p === jsPath);

    try {
      const result = await loadProjectConfig(tmpDir);
      expect(result).toBeNull();
    } finally {
      realFs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ── loadConfig ─────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns default values when no global config exists", async () => {
    fsMock.existsSync.mockReturnValue(false);

    const result = await loadConfig();

    expect(result).toEqual({
      domain: "localhost",
      port: 3000,
      httpsPort: 3443,
      certPath: undefined,
      keyPath: undefined,
      projects: [],
    });
  });

  it("reads domain, port, httpsPort from global config", async () => {
    const globalConfig = { domain: "myapp.test", port: 9000, httpsPort: 9443 };

    fsMock.existsSync.mockImplementation((p: string) => p === GLOBAL_CONFIG_PATH);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(globalConfig));

    const result = await loadConfig();

    expect(result.domain).toBe("myapp.test");
    expect(result.port).toBe(9000);
    expect(result.httpsPort).toBe(9443);
    expect(result.projects).toEqual([]);
  });

  it("resolves relative cert/key paths against config dir", async () => {
    const globalConfig = {
      certPath: "certs/dev.pem",
      keyPath: "certs/dev-key.pem",
    };

    fsMock.existsSync.mockImplementation((p: string) => p === GLOBAL_CONFIG_PATH);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(globalConfig));

    const result = await loadConfig();

    expect(result.certPath).toBe(`${CONFIG_DIR}/certs/dev.pem`);
    expect(result.keyPath).toBe(`${CONFIG_DIR}/certs/dev-key.pem`);
  });

  it("loads project configs for all registered projects", async () => {
    const projectDir = "/projects/my-app";
    const projectConfigPath = `${projectDir}/${PROJECT_CONFIG_NAME}`;
    const projectConfig = {
      routes: { app: "http://localhost:3000" },
      worktrees: {},
    };
    const globalConfig = { projects: [projectDir] };

    fsMock.existsSync.mockImplementation(
      (p: string) => p === GLOBAL_CONFIG_PATH || p === projectConfigPath,
    );
    fsMock.readFileSync.mockImplementation((p: string) => {
      if (p === GLOBAL_CONFIG_PATH) return JSON.stringify(globalConfig);
      if (p === projectConfigPath) return JSON.stringify(projectConfig);
      return "";
    });

    const result = await loadConfig();

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toEqual({
      path: projectDir,
      configPath: projectConfigPath,
      configType: "json",
      routes: projectConfig.routes,
      worktrees: {},
    });
  });
});

// ── reloadConfig ──────────────────────────────────────────────

describe("reloadConfig", () => {
  it("updates the live config singleton", async () => {
    const globalConfig = { domain: "reloaded.test", port: 7777, httpsPort: 7443 };

    fsMock.existsSync.mockImplementation((p: string) => p === GLOBAL_CONFIG_PATH);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(globalConfig));

    const result = await reloadConfig();

    expect(result.domain).toBe("reloaded.test");
    expect(result.port).toBe(7777);
    // Verify the live singleton is updated
    expect(mod.config.domain).toBe("reloaded.test");
    expect(mod.config.port).toBe(7777);
  });

  it("returns default values after reload with missing config", async () => {
    fsMock.existsSync.mockReturnValue(false);

    const result = await reloadConfig();

    expect(result.domain).toBe("localhost");
    expect(result.port).toBe(3000);
    expect(mod.config).toBe(result);
  });
});
