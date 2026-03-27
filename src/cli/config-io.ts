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

// ── Project config I/O ───────────────────────────────────────

export interface RawProjectConfig {
  routes?: Record<string, string>;
  worktrees?: Record<string, { port: number }>;
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
