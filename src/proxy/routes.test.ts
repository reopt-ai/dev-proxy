import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseHost, getTarget, ROUTES, DEFAULT_TARGET } from "./routes.js";

const CONFIG_MODULE_URL = new URL("./config.ts", import.meta.url).href;
const ORIGINAL_CWD = process.cwd();

describe("dev-proxy config", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "dev-proxy-config-"));
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves cert paths relative to the .proxy.json location", async () => {
    const nestedCwd = join(tempDir, "apps", "dev-proxy");
    mkdirSync(nestedCwd, { recursive: true });

    writeFileSync(
      join(tempDir, ".proxy.json"),
      JSON.stringify({
        certPath: "certs/dev.example+1.pem",
        keyPath: "certs/dev.example+1-key.pem",
      }),
    );

    process.chdir(nestedCwd);

    const mod = await import(`${CONFIG_MODULE_URL}?t=${Date.now()}`);

    const normalizedTempDir = realpathSync(tempDir);

    expect(mod.config.certPath).toBe(
      resolve(normalizedTempDir, "certs/dev.example+1.pem"),
    );
    expect(mod.config.keyPath).toBe(
      resolve(normalizedTempDir, "certs/dev.example+1-key.pem"),
    );
  });
});

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

  it("handles host with port only", () => {
    expect(parseHost("localhost:3000")).toEqual({
      app: "localhost:3000",
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

describe("getTarget", () => {
  it("resolves a configured subdomain to its target", () => {
    // Only test if routes are actually loaded (config-dependent)
    const configuredApps = Object.keys(ROUTES);
    if (configuredApps.length === 0) return;

    const app = configuredApps[0]!;
    const result = getTarget(`${app}.reopt.de:3000`);
    expect(result.url.origin).toBe(ROUTES[app]);
    expect(result.worktree).toBeNull();
  });

  it("falls back to default target for unknown subdomain", () => {
    const result = getTarget("unknown-xyz.reopt.de:3000");
    expect(result.url.origin).toBe(new URL(DEFAULT_TARGET).origin);
    expect(result.worktree).toBeNull();
  });

  it("falls back to default target for empty host", () => {
    const result = getTarget("");
    expect(result.url.origin).toBe(new URL(DEFAULT_TARGET).origin);
  });

  it("empty worktree prefix falls through to normal routing", () => {
    // "--api.reopt.de" parses as worktree="" which is falsy
    const result = getTarget("--www.reopt.de:3000");
    // Should not crash, should fall through to route lookup for "www"
    expect(result.worktree).toBeNull();
  });
});
