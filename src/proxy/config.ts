import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";

// ── Paths ────────────────────────────────────────────────────
export const CONFIG_DIR = resolve(homedir(), ".dev-proxy");
export const GLOBAL_CONFIG_PATH = resolve(CONFIG_DIR, "config.json");
export const PROJECT_CONFIG_NAME = ".dev-proxy.json";

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

export interface ProjectConfig {
  path: string;
  configPath: string;
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

function loadProjectConfig(projectDir: string): ProjectConfig | null {
  const configPath = resolve(projectDir, PROJECT_CONFIG_NAME);
  if (!existsSync(configPath)) return null;
  const raw = loadJson(configPath) as RawProjectConfig | null;
  if (!raw) return null;
  return {
    path: projectDir,
    configPath,
    routes: raw.routes ?? {},
    worktrees: raw.worktrees ?? {},
  };
}

// ── Main loader ──────────────────────────────────────────────

function loadConfig(): ResolvedConfig {
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
      const project = loadProjectConfig(resolved);
      if (project) {
        projects.push(project);
      } else {
        console.error(`[dev-proxy] Project ${resolved}: no ${PROJECT_CONFIG_NAME} found`);
      }
    }
  }

  return { domain, port, httpsPort, certPath, keyPath, projects };
}

export const config = loadConfig();

export const __testing = {
  parsePort,
  resolveFilePath,
  loadJson,
  loadProjectConfig,
  loadConfig,
};
