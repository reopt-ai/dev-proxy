import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { Worker } from "node:worker_threads";

// ── Paths ────────────────────────────────────────────────────
export const CONFIG_DIR = resolve(homedir(), ".dev-proxy");
export const GLOBAL_CONFIG_PATH = resolve(CONFIG_DIR, "config.json");
export const PROJECT_CONFIG_NAME = ".dev-proxy.json";
export const PROJECT_WORKTREES_NAME = ".dev-proxy.worktrees.json";
export const JS_CONFIG_NAMES = ["dev-proxy.config.mjs", "dev-proxy.config.js"];

// ── Types ────────────────────────────────────────────────────

/** Raw shape of ~/.dev-proxy/config.json */
interface RawGlobalConfig {
  domain?: string;
  /** Plain-HTTP port; `false` turns the HTTP listener off (HTTPS only). */
  port?: number | false;
  httpsPort?: number;
  certPath?: string;
  keyPath?: string;
  /** Upstream deadlines in seconds; `false` disables one. */
  timeouts?: { connect?: number | false; responseHeaders?: number | false };
  projects?: string[];
}

/** Worktree entry: multi-service or legacy single-port */
type WorktreeEntry = { ports: Record<string, number> } | { port: number };

/** Raw shape of <project>/.dev-proxy.json */
interface RawProjectConfig {
  routes?: Record<string, string>;
  worktrees?: Record<string, WorktreeEntry>;
  worktreeConfig?: unknown;
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
  worktreeConfig?: unknown;
}

export interface UpstreamTimeouts {
  /** Agent queue, TCP connect and TLS handshake; `null` waits forever. */
  connectMs: number | null;
  /** From the end of the request upload to response headers; `null` waits forever. */
  responseHeadersMs: number | null;
}

export interface ResolvedConfig {
  domain: string;
  /** `null` when the HTTP listener is turned off. */
  port: number | null;
  httpsPort: number;
  certPath?: string;
  keyPath?: string;
  timeouts: UpstreamTimeouts;
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

function parsePort(label: string, raw: unknown, fallback: number): number {
  if (raw === undefined) return fallback;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= 65535) {
    return raw;
  }
  console.error(
    `[dev-proxy] Ignoring ${label}: expected integer port, received ${JSON.stringify(raw)}`,
  );
  return fallback;
}

/** Like parsePort, but `false` means "no listener". */
function parseOptionalPort(label: string, raw: unknown, fallback: number): number | null {
  if (raw === false) return null;
  return parsePort(label, raw, fallback);
}

/** Seconds in the file, milliseconds in memory; `false` means "no deadline". */
function parseTimeout(
  label: string,
  raw: unknown,
  fallbackSeconds: number,
): number | null {
  if (raw === false) return null;
  if (raw === undefined) return fallbackSeconds * 1000;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw * 1000);
  }
  console.error(
    `[dev-proxy] Ignoring ${label}: expected seconds or false, received ${JSON.stringify(raw)}`,
  );
  return fallbackSeconds * 1000;
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

// A worker owns the entire imported module graph. Terminating it reclaims the
// ESM cache; cache-busting URLs in the proxy process can never be evicted.
const CONFIG_WORKER = new URL(
  `data:text/javascript,${encodeURIComponent(`
  import { parentPort, workerData } from "node:worker_threads";
  try {
    const mod = await import(workerData);
    const config = mod.default ?? mod;
    // Structured clone rejects URLs and functions that an in-process import
    // accepted; JSON turns a URL into its href and drops what cannot cross.
    parentPort.postMessage({ ok: true, config: JSON.parse(JSON.stringify({
      routes: config.routes,
      worktreeConfig: config.worktreeConfig,
    })) });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
`)}`,
);

type ConfigWorkerResult =
  { ok: true; config: RawJsConfig } | { ok: false; error: string };

async function loadJsConfig(
  filePath: string,
  timeoutMs = 10_000,
): Promise<RawJsConfig | null> {
  let worker: Worker | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(CONFIG_WORKER, {
      workerData: pathToFileURL(filePath).href,
      // Configs are plain JS; do not copy the CLI's TS loader or test-runner flags.
      execArgv: [],
    });
    const activeWorker = worker;
    return await new Promise<RawJsConfig>((resolve, reject) => {
      deadline = setTimeout(() => {
        reject(new Error("config evaluation timed out"));
      }, timeoutMs);
      activeWorker.once("message", (result: ConfigWorkerResult) => {
        if (result.ok) resolve(result.config);
        else reject(new Error(result.error));
      });
      activeWorker.once("error", reject);
      activeWorker.once("exit", (code) => {
        reject(
          new Error(`config worker exited before returning a config (code ${code})`),
        );
      });
    });
  } catch (err) {
    console.error(`[dev-proxy] Failed to load ${filePath}: ${(err as Error).message}`);
    return null;
  } finally {
    if (deadline) clearTimeout(deadline);
    // Await termination even when a config creates timers or fails to load.
    await worker?.terminate();
  }
}

// ── Project loader ──────────────────────────────────────────

function loadWorktrees(projectDir: string): Record<string, WorktreeEntry> {
  // Prefer .dev-proxy.worktrees.json; fall back to legacy `worktrees` key in .dev-proxy.json
  const worktreesPath = resolve(projectDir, PROJECT_WORKTREES_NAME);
  const worktreesRaw = loadJson(worktreesPath) as RawProjectConfig | null;
  if (worktreesRaw?.worktrees) return worktreesRaw.worktrees;

  const legacyPath = resolve(projectDir, PROJECT_CONFIG_NAME);
  const legacyRaw = loadJson(legacyPath) as RawProjectConfig | null;
  return legacyRaw?.worktrees ?? {};
}

function loadLegacyWorktreeConfig(projectDir: string): unknown {
  const legacyPath = resolve(projectDir, PROJECT_CONFIG_NAME);
  const legacyRaw = loadJson(legacyPath) as RawProjectConfig | null;
  return legacyRaw?.worktreeConfig;
}

async function loadProjectConfig(projectDir: string): Promise<ProjectConfig | null> {
  const resolution = resolveProjectConfigFile(projectDir);
  if (!resolution) return null;

  if (resolution.type === "js") {
    const jsConfig = await loadJsConfig(resolution.path);
    if (!jsConfig) return null;

    return {
      path: projectDir,
      configPath: resolution.path,
      configType: "js",
      routes: jsConfig.routes ?? {},
      worktrees: loadWorktrees(projectDir),
      worktreeConfig: jsConfig.worktreeConfig ?? loadLegacyWorktreeConfig(projectDir),
    };
  }

  // Legacy JSON-only config — routes still come from .dev-proxy.json
  const raw = loadJson(resolution.path) as RawProjectConfig | null;
  if (!raw) return null;
  return {
    path: projectDir,
    configPath: resolution.path,
    configType: "json",
    routes: raw.routes ?? {},
    worktrees: loadWorktrees(projectDir),
    worktreeConfig: raw.worktreeConfig,
  };
}

// ── Main loader ──────────────────────────────────────────────

async function loadConfig(): Promise<ResolvedConfig> {
  const global = (loadJson(GLOBAL_CONFIG_PATH) as RawGlobalConfig | null) ?? {};

  const domain = global.domain ?? "localhost";
  const port = parseOptionalPort("port", global.port, 3000);
  const httpsPort = parsePort("httpsPort", global.httpsPort, 3443);
  const certPath = resolveFilePath(global.certPath, GLOBAL_CONFIG_PATH);
  const keyPath = resolveFilePath(global.keyPath, GLOBAL_CONFIG_PATH);
  const timeouts: UpstreamTimeouts = {
    connectMs: parseTimeout("timeouts.connect", global.timeouts?.connect, 10),
    responseHeadersMs: parseTimeout(
      "timeouts.responseHeaders",
      global.timeouts?.responseHeaders,
      60,
    ),
  };

  const dirs = (global.projects ?? []).map((projectDir) =>
    isAbsolute(projectDir) ? projectDir : resolve(CONFIG_DIR, projectDir),
  );
  // Each JS config pays for a Worker; evaluate them concurrently. Order is kept
  // because the first project to register a subdomain wins.
  const loaded = await Promise.all(dirs.map((dir) => loadProjectConfig(dir)));
  const projects: ProjectConfig[] = [];
  dirs.forEach((dir, i) => {
    const project = loaded[i];
    if (project) {
      projects.push(project);
    } else {
      console.error(
        `[dev-proxy] Project ${dir}: no config found (tried ${JS_CONFIG_NAMES.join(", ")}, ${PROJECT_CONFIG_NAME}, ${PROJECT_WORKTREES_NAME})`,
      );
    }
  });

  return { domain, port, httpsPort, certPath, keyPath, timeouts, projects };
}

export let config = await loadConfig();

let reloadGeneration = 0;

/**
 * Re-read all config files and replace the live config singleton. A save
 * during a slow evaluation starts another reload; only the newest one may
 * apply, or a stale result (e.g. a timed-out config) would win last.
 */
export async function reloadConfig(): Promise<ResolvedConfig> {
  const generation = ++reloadGeneration;
  const next = await loadConfig();
  if (generation === reloadGeneration) config = next;
  return config;
}

export const __testing = {
  parsePort,
  parseOptionalPort,
  parseTimeout,
  resolveFilePath,
  loadJson,
  loadWorktrees,
  loadLegacyWorktreeConfig,
  loadProjectConfig,
  loadConfig,
  resolveProjectConfigFile,
  loadJsConfig,
};
