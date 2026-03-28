import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { useSyncExternalStore } from "react";
import { config, type ProjectConfig } from "./config.js";

// ── Types ────────────────────────────────────────────────────

/** Multi-service: subdomain → port */
interface WorktreeMultiEntry {
  ports: Record<string, number>;
}

/** Legacy single-port */
interface WorktreeSingleEntry {
  port: number;
}

type WorktreeEntry = WorktreeMultiEntry | WorktreeSingleEntry;

export type { WorktreeEntry };

// ── State ────────────────────────────────────────────────────
let worktreeMap = new Map<string, WorktreeEntry>();
const watchers: FSWatcher[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

// ── Core API ─────────────────────────────────────────────────

function isValidEntry(entry: WorktreeEntry): boolean {
  if ("ports" in entry) {
    return Object.keys(entry.ports).length > 0;
  }
  return typeof entry.port === "number";
}

function readRegistry(): void {
  const next = new Map<string, WorktreeEntry>();

  for (const project of config.projects) {
    const worktrees = readProjectWorktrees(project);
    for (const [branch, entry] of Object.entries(worktrees)) {
      if (isValidEntry(entry) && !next.has(branch)) {
        next.set(branch, entry);
      }
    }
  }

  worktreeMap = next;
  notify();
}

function readProjectWorktrees(project: ProjectConfig): Record<string, WorktreeEntry> {
  try {
    if (!existsSync(project.configPath)) return project.worktrees;
    const raw = readFileSync(project.configPath, "utf-8");
    const data = JSON.parse(raw) as { worktrees?: Record<string, WorktreeEntry> };
    return data.worktrees ?? {};
  } catch {
    // Config read/parse failed — fall back to cached worktrees
    return project.worktrees;
  }
}

export function loadRegistry(): void {
  readRegistry();

  for (const project of config.projects) {
    if (!existsSync(project.configPath)) continue;
    try {
      const dir = dirname(project.configPath);
      const base = basename(project.configPath);
      const watcher = watch(dir, (_event, filename) => {
        if (filename !== base) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(readRegistry, 100);
      });
      watcher.on("error", () => {
        /* intentional no-op: watcher errors are non-fatal */
      });
      watchers.push(watcher);
    } catch {
      // Directory doesn't exist — no watcher needed
    }
  }
}

/**
 * Resolve worktree target URL.
 * For multi-service entries, `service` selects the subdomain port.
 * For legacy single-port entries, `service` is ignored.
 */
export function getWorktreeTarget(branch: string, service?: string): URL | null {
  const entry = worktreeMap.get(branch);
  if (!entry) return null;

  if ("ports" in entry) {
    const port =
      service && service in entry.ports
        ? entry.ports[service]
        : Object.values(entry.ports)[0];
    if (port === undefined) return null;
    return new URL(`http://localhost:${port}`);
  }

  return new URL(`http://localhost:${entry.port}`);
}

export function getActiveWorktrees(): Map<string, WorktreeEntry> {
  return new Map(worktreeMap);
}

// ── React hook ──────────────────────────────────────────────
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Map<string, WorktreeEntry> {
  return worktreeMap;
}

export function useWorktrees(): Map<string, WorktreeEntry> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const __testing = { isValidEntry };

export function stopRegistry(): void {
  for (const w of watchers) w.close();
  watchers.length = 0;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
