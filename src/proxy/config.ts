import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";

// ── Paths ────────────────────────────────────────────────────
export const CONFIG_DIR = resolve(homedir(), ".dev-proxy");
export const GLOBAL_CONFIG_PATH = resolve(CONFIG_DIR, "config.json");
const PROJECT_CONFIG_NAME = ".proxy.json";

// ── Types ────────────────────────────────────────────────────
interface RawConfig {
  domain?: string;
  port?: number;
  httpsPort?: number;
  defaultTarget?: string;
  certPath?: string;
  keyPath?: string;
  routes?: Record<string, string>;
  worktreeRegistry?: string;
}

export interface ResolvedConfig {
  domain: string;
  port: number;
  httpsPort: number;
  defaultTarget: string;
  certPath?: string;
  keyPath?: string;
  routes: Record<string, string>;
  worktreeRegistry?: string;
  projectConfigPath: string | null;
}

// ── Defaults (generic — no project-specific values) ──────────
const DEFAULTS: ResolvedConfig = {
  domain: "localhost",
  port: 3000,
  httpsPort: 3443,
  defaultTarget: "http://localhost:3001",
  routes: {},
  projectConfigPath: null,
};

// ── Loaders ──────────────────────────────────────────────────
function loadJsonFile(path: string): RawConfig {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8")) as RawConfig;
    }
  } catch (err) {
    console.error(`[dev-proxy] Failed to parse ${path}: ${(err as Error).message}`);
  }
  return {};
}

function findProjectConfig(fromDir: string): string | null {
  let current = fromDir;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop with returns
  while (true) {
    const candidate = resolve(current, PROJECT_CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function loadProjectConfig(): {
  config: RawConfig;
  configPath: string | null;
} {
  const starts = [process.cwd(), resolve(import.meta.dirname, "..", "..")];
  for (const start of starts) {
    const configPath = findProjectConfig(start);
    if (!configPath) continue;
    return { config: loadJsonFile(configPath), configPath };
  }
  return { config: {}, configPath: null };
}

// ── Merge & Resolve ──────────────────────────────────────────
function resolveFilePath(
  rawPath: string | undefined,
  basePath: string | null,
): string | undefined {
  if (!rawPath) return undefined;
  if (!basePath || isAbsolute(rawPath)) return rawPath;
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

/**
 * Config loading priority: defaults → ~/.dev-proxy/config.json → .proxy.json
 */
function loadConfig(): ResolvedConfig {
  const global = loadJsonFile(GLOBAL_CONFIG_PATH);
  const { config: project, configPath: projectConfigPath } = loadProjectConfig();

  const domain = project.domain ?? global.domain ?? DEFAULTS.domain;
  const port = parsePort("port", project.port ?? global.port, DEFAULTS.port);
  const httpsPort = parsePort(
    "httpsPort",
    project.httpsPort ?? global.httpsPort,
    DEFAULTS.httpsPort,
  );
  const defaultTarget =
    project.defaultTarget ?? global.defaultTarget ?? DEFAULTS.defaultTarget;

  const routes: Record<string, string> = {
    ...(global.routes ?? {}),
    ...(project.routes ?? {}),
  };

  const certPath =
    resolveFilePath(project.certPath, projectConfigPath) ??
    resolveFilePath(global.certPath, GLOBAL_CONFIG_PATH);
  const keyPath =
    resolveFilePath(project.keyPath, projectConfigPath) ??
    resolveFilePath(global.keyPath, GLOBAL_CONFIG_PATH);

  const worktreeRegistry =
    resolveFilePath(project.worktreeRegistry, projectConfigPath) ??
    resolveFilePath(global.worktreeRegistry, GLOBAL_CONFIG_PATH);

  return {
    domain,
    port,
    httpsPort,
    defaultTarget,
    certPath,
    keyPath,
    routes,
    worktreeRegistry,
    projectConfigPath,
  };
}

export const config = loadConfig();
