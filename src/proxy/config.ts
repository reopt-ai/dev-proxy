import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

// ── Paths ────────────────────────────────────────────────────
export const CONFIG_DIR = resolve(homedir(), ".dev-proxy");
export const GLOBAL_CONFIG_PATH = resolve(CONFIG_DIR, "config.json");
export const PROJECT_CONFIG_NAME = ".dev-proxy.json";
export const JS_CONFIG_NAMES = ["dev-proxy.config.mjs", "dev-proxy.config.js"];

// ── Types ────────────────────────────────────────────────────

/** Raw shape of ~/.dev-proxy/config.json */
interface RawGlobalConfig {
  domain?: string;
  port?: number;
  httpsPort?: number;
  certPath?: string;
  keyPath?: string;
  projects?: string[];
}

/** Worktree entry: multi-service or legacy single-port */
type WorktreeEntry = { ports: Record<string, number> } | { port: number };

/** Raw shape of <project>/.dev-proxy.json */
interface RawProjectConfig {
  routes?: Record<string, string>;
  worktrees?: Record<string, WorktreeEntry>;
}

/** Raw shape of dev-proxy.config.mjs default export */
interface RawJsConfig {
  routes?: Record<string, string>;
  worktreeConfig?: unknown;
}

export interface ProjectConfig {
  path: string;
  configPath: string;
  configType: "js" | "json";
  routes: Record<string, string>;
  worktrees: Record<string, WorktreeEntry>;
}

export interface ResolvedConfig {
  domain: string;
  port: number;
  httpsPort: number;
  certPath?: string;
  keyPath?: string;
  projects: ProjectConfig[];
}

// ── Loaders ──────────────────────────────────────────────────

function loadJson(path: string): unknown {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as unknown;
    }
  } catch (err) {
    console.error(`[dev-proxy] Failed to parse ${path}: ${(err as Error).message}`);
  }
  return null;
}

function resolveFilePath(
  rawPath: string | undefined,
  basePath: string,
): string | undefined {
  if (!rawPath) return undefined;
  if (isAbsolute(rawPath)) return rawPath;
  return resolve(dirname(basePath), rawPath);
}

function parsePort(label: string, raw: number | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  if (Number.isInteger(raw) && raw > 0 && raw <= 65535) return raw;
  console.error(
    `[dev-proxy] Ignoring ${label}: expected integer port, received "${raw}"`,
  );
  return fallback;
}

// ── Config file resolution ──────────────────────────────────

interface ConfigResolution {
  type: "js" | "json";
  path: string;
}

export function resolveProjectConfigFile(projectDir: string): ConfigResolution | null {
  for (const name of JS_CONFIG_NAMES) {
    const p = resolve(projectDir, name);
    if (existsSync(p)) return { type: "js", path: p };
  }
  const jsonPath = resolve(projectDir, PROJECT_CONFIG_NAME);
  if (existsSync(jsonPath)) return { type: "json", path: jsonPath };
  return null;
}

async function loadJsConfig(filePath: string): Promise<RawJsConfig | null> {
  try {
    const url = pathToFileURL(filePath).href + "?t=" + String(Date.now());
    const mod = (await import(url)) as { default?: RawJsConfig };
    return (mod.default ?? mod) as RawJsConfig;
  } catch (err) {
    console.error(`[dev-proxy] Failed to load ${filePath}: ${(err as Error).message}`);
    return null;
  }
}

// ── Project loader ──────────────────────────────────────────

async function loadProjectConfig(projectDir: string): Promise<ProjectConfig | null> {
  const resolution = resolveProjectConfigFile(projectDir);
  if (!resolution) return null;

  if (resolution.type === "js") {
    const jsConfig = await loadJsConfig(resolution.path);
    if (!jsConfig) return null;

    // Worktrees always come from .dev-proxy.json
    const jsonPath = resolve(projectDir, PROJECT_CONFIG_NAME);
    const jsonRaw = loadJson(jsonPath) as RawProjectConfig | null;

    return {
      path: projectDir,
      configPath: resolution.path,
      configType: "js",
      routes: jsConfig.routes ?? {},
      worktrees: jsonRaw?.worktrees ?? {},
    };
  }

  // Legacy JSON-only config
  const raw = loadJson(resolution.path) as RawProjectConfig | null;
  if (!raw) return null;
  return {
    path: projectDir,
    configPath: resolution.path,
    configType: "json",
    routes: raw.routes ?? {},
    worktrees: raw.worktrees ?? {},
  };
}

// ── Main loader ──────────────────────────────────────────────

async function loadConfig(): Promise<ResolvedConfig> {
  const global = (loadJson(GLOBAL_CONFIG_PATH) as RawGlobalConfig | null) ?? {};

  const domain = global.domain ?? "localhost";
  const port = parsePort("port", global.port, 3000);
  const httpsPort = parsePort("httpsPort", global.httpsPort, 3443);
  const certPath = resolveFilePath(global.certPath, GLOBAL_CONFIG_PATH);
  const keyPath = resolveFilePath(global.keyPath, GLOBAL_CONFIG_PATH);

  const projects: ProjectConfig[] = [];
  if (global.projects) {
    for (const projectDir of global.projects) {
      const resolved = isAbsolute(projectDir)
        ? projectDir
        : resolve(CONFIG_DIR, projectDir);
      const project = await loadProjectConfig(resolved);
      if (project) {
        projects.push(project);
      } else {
        console.error(
          `[dev-proxy] Project ${resolved}: no config found (tried ${JS_CONFIG_NAMES.join(", ")}, ${PROJECT_CONFIG_NAME})`,
        );
      }
    }
  }

  return { domain, port, httpsPort, certPath, keyPath, projects };
}

export let config = await loadConfig();

/** Re-read all config files and replace the live config singleton. */
export async function reloadConfig(): Promise<ResolvedConfig> {
  config = await loadConfig();
  return config;
}

export const __testing = {
  parsePort,
  resolveFilePath,
  loadJson,
  loadProjectConfig,
  loadConfig,
  resolveProjectConfigFile,
  loadJsConfig,
};
