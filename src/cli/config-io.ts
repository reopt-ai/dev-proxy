/**
 * Shared config file I/O for CLI commands.
 * Re-exports constants from proxy/config.ts and provides read/write helpers.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  CONFIG_DIR,
  GLOBAL_CONFIG_PATH,
  PROJECT_CONFIG_NAME,
  PROJECT_WORKTREES_NAME,
  JS_CONFIG_NAMES,
  resolveProjectConfigFile,
} from "../proxy/config.js";

export {
  CONFIG_DIR,
  GLOBAL_CONFIG_PATH,
  PROJECT_CONFIG_NAME,
  PROJECT_WORKTREES_NAME,
  JS_CONFIG_NAMES,
  resolveProjectConfigFile,
};

/** Write to a temp file then atomically rename — prevents corruption on crash. */
function atomicWriteFileSync(filePath: string, data: string): void {
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, data, "utf-8");
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}

// ── Global config I/O ────────────────────────────────────────

export interface RawGlobalConfig {
  domain?: string;
  port?: number;
  httpsPort?: number;
  certPath?: string;
  keyPath?: string;
  projects?: string[];
}

export function readGlobalConfig(): RawGlobalConfig {
  try {
    if (existsSync(GLOBAL_CONFIG_PATH)) {
      return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, "utf-8")) as RawGlobalConfig;
    }
  } catch (err) {
    console.warn(
      `[dev-proxy] Failed to parse ${GLOBAL_CONFIG_PATH}: ${(err as Error).message}`,
    );
  }
  return {};
}

export function writeGlobalConfig(cfg: RawGlobalConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  atomicWriteFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

// ── Worktree entry types ─────────────────────────────────────

/** Multi-service worktree: subdomain → port */
export interface WorktreeMultiEntry {
  ports: Record<string, number>;
}

/** Legacy single-port worktree */
export interface WorktreeSingleEntry {
  port: number;
}

export type WorktreeEntry = WorktreeMultiEntry | WorktreeSingleEntry;

/** Extract all ports from a worktree entry */
export function getEntryPorts(entry: WorktreeEntry): number[] {
  if ("ports" in entry) return Object.values(entry.ports);
  return [entry.port];
}

/** Get port for a specific service, with legacy fallback */
export function getServicePort(entry: WorktreeEntry, service?: string): number | null {
  if ("ports" in entry) {
    // A named service that isn't registered returns null rather than
    // silently misrouting to another service's port. Only fall back to the
    // first port when no service is requested.
    if (service) return entry.ports[service] ?? null;
    const values = Object.values(entry.ports);
    return values[0] ?? null;
  }
  // Legacy single port
  return entry.port;
}

// ── Project config I/O ───────────────────────────────────────

export interface WorktreeHooks {
  "post-create"?: string;
  "post-remove"?: string;
}

export type WorktreeServices = Record<string, { env: string }>;

export interface WorktreeConfig {
  portRange: [number, number];
  directory: string;
  services?: WorktreeServices;
  envFile?: string;
  hooks?: WorktreeHooks;
}

export interface RawProjectConfig {
  routes?: Record<string, string>;
  worktrees?: Record<string, WorktreeEntry>;
  worktreeConfig?: WorktreeConfig;
}

function readJsonFile(filePath: string): unknown {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    console.warn(`[dev-proxy] Failed to parse ${filePath}: ${(err as Error).message}`);
  }
  return null;
}

/**
 * Returns a merged view of legacy `.dev-proxy.json` and the new
 * `.dev-proxy.worktrees.json`. Worktrees in the new file take precedence.
 */
export function readProjectConfig(projectPath: string): RawProjectConfig {
  const legacyPath = resolve(projectPath, PROJECT_CONFIG_NAME);
  const worktreesPath = resolve(projectPath, PROJECT_WORKTREES_NAME);

  const legacy = (readJsonFile(legacyPath) as RawProjectConfig | null) ?? {};
  const worktreesFile = readJsonFile(worktreesPath) as RawProjectConfig | null;

  if (worktreesFile?.worktrees) {
    return { ...legacy, worktrees: worktreesFile.worktrees };
  }
  return legacy;
}

/**
 * Splits cfg into two files: `worktrees` → `.dev-proxy.worktrees.json`,
 * everything else (`routes`, `worktreeConfig`) → `.dev-proxy.json`. Either
 * file is skipped when it would have nothing to write.
 */
export function writeProjectConfig(projectPath: string, cfg: RawProjectConfig): void {
  const { worktrees, ...rest } = cfg;

  if (worktrees !== undefined) {
    const worktreesPath = resolve(projectPath, PROJECT_WORKTREES_NAME);
    atomicWriteFileSync(worktreesPath, JSON.stringify({ worktrees }, null, 2) + "\n");
  }

  if (Object.keys(rest).length > 0) {
    const legacyPath = resolve(projectPath, PROJECT_CONFIG_NAME);
    atomicWriteFileSync(legacyPath, JSON.stringify(rest, null, 2) + "\n");
  }
}

// ── JS config generation ────────────────────────────────────

function indentJson(value: unknown, indent: string): string {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : indent + line))
    .join("\n");
}

export function generateJsConfig(
  routes: Record<string, string>,
  worktreeConfig?: WorktreeConfig,
): string {
  const entries = Object.entries(routes)
    .map(([sub, target]) => `    ${JSON.stringify(sub)}: ${JSON.stringify(target)},`)
    .join("\n");

  const worktreeBlock = worktreeConfig
    ? `\n  worktreeConfig: ${indentJson(worktreeConfig, "  ")},`
    : "";

  return `/** @type {import('@reopt-ai/dev-proxy').Config} */
export default {
  routes: {
${entries}
  },${worktreeBlock}
};
`;
}

export function writeJsConfig(
  projectPath: string,
  routes: Record<string, string>,
  worktreeConfig?: WorktreeConfig,
): void {
  const configPath = resolve(projectPath, JS_CONFIG_NAMES[0] as string);
  atomicWriteFileSync(configPath, generateJsConfig(routes, worktreeConfig));
}

// ── Validation ───────────────────────────────────────────────

export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Validate a route key. Accepts:
 *   - `"*"` — wildcard for unmatched subdomains
 *   - `"@"` — apex (bare domain — e.g. `reopt.de` itself)
 *   - lowercase alphanumeric + hyphens, no leading/trailing hyphen
 */
export function isValidSubdomain(value: string): boolean {
  return value === "*" || value === "@" || SUBDOMAIN_RE.test(value);
}

// ── Port allocation ──────────────────────────────────────────

export function allocatePort(
  portRange: [number, number],
  usedPorts: Set<number>,
): number | null {
  for (let p = portRange[0]; p <= portRange[1]; p++) {
    if (!usedPorts.has(p)) return p;
  }
  return null;
}

export function allocatePorts(
  count: number,
  portRange: [number, number],
  usedPorts: Set<number>,
): number[] | null {
  const result: number[] = [];
  for (let p = portRange[0]; p <= portRange[1] && result.length < count; p++) {
    if (!usedPorts.has(p)) result.push(p);
  }
  return result.length === count ? result : null;
}

// ── Env file generation ──────────────────────────────────────

export function generateEnvContent(
  services: WorktreeServices,
  ports: Record<string, number>,
): string {
  const lines: string[] = [];
  for (const [subdomain, { env }] of Object.entries(services)) {
    const port = ports[subdomain];
    if (port !== undefined) {
      lines.push(`${env}=${port}`);
    }
  }
  return lines.join("\n") + "\n";
}
