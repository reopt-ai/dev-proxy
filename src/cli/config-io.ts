/**
 * Shared config file I/O for CLI commands.
 * Re-exports constants from proxy/config.ts and provides read/write helpers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_DIR, GLOBAL_CONFIG_PATH, PROJECT_CONFIG_NAME } from "../proxy/config.js";

export { CONFIG_DIR, GLOBAL_CONFIG_PATH, PROJECT_CONFIG_NAME };

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
  } catch {
    // corrupt file — treat as empty
  }
  return {};
}

export function writeGlobalConfig(cfg: RawGlobalConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
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
    if (service && service in entry.ports) return entry.ports[service]!;
    // Fallback: first port
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

export function readProjectConfig(projectPath: string): RawProjectConfig {
  const configPath = resolve(projectPath, PROJECT_CONFIG_NAME);
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf-8")) as RawProjectConfig;
    }
  } catch {
    // corrupt file — treat as empty
  }
  return {};
}

export function writeProjectConfig(projectPath: string, cfg: RawProjectConfig): void {
  const configPath = resolve(projectPath, PROJECT_CONFIG_NAME);
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

// ── Validation ───────────────────────────────────────────────

export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535;
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
