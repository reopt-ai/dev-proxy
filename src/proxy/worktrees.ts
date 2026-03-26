import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { useSyncExternalStore } from "react";
import { config } from "./config.js";

// ── Types ────────────────────────────────────────────────────
interface WorktreeEntry {
  port: number;
}
interface WorktreeRegistry {
  worktrees: Record<string, WorktreeEntry>;
  nextPort: number;
}

export type { WorktreeEntry };

// ── State ────────────────────────────────────────────────────
let worktreeMap = new Map<string, WorktreeEntry>();
let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

// ── Registry path resolution ─────────────────────────────────
const REGISTRY_NAME = ".worktrees.json";

function findRegistryPath(): string | null {
  // 1. Explicit config
  if (config.worktreeRegistry) {
    return existsSync(config.worktreeRegistry) ? config.worktreeRegistry : null;
  }
  // 2. Search upward from cwd
  let current = process.cwd();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional upward traversal
  while (true) {
    const candidate = resolve(current, REGISTRY_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const REGISTRY_PATH = findRegistryPath();

// ── Core API ─────────────────────────────────────────────────

function readRegistry(): void {
  const next = new Map<string, WorktreeEntry>();
  if (!REGISTRY_PATH) {
    worktreeMap = next;
    notify();
    return;
  }
  try {
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    const data = JSON.parse(raw) as WorktreeRegistry;
    for (const [branch, entry] of Object.entries(data.worktrees)) {
      if (typeof entry.port === "number") {
        next.set(branch, entry);
      }
    }
  } catch {
    // File missing or invalid — start with empty map (not an error)
  }
  worktreeMap = next;
  notify();
}

export function loadRegistry(): void {
  readRegistry();

  if (!REGISTRY_PATH) return;

  // Watch the parent directory for changes to .worktrees.json.
  // fs.watch on a file can miss events on macOS when the file is
  // overwritten in place (e.g. writeFileSync or atomic mv).
  // Watching the directory reliably catches all modifications.
  try {
    const dir = dirname(REGISTRY_PATH);
    const base = basename(REGISTRY_PATH);
    watcher = watch(dir, (_event, filename) => {
      if (filename !== base) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(readRegistry, 100);
    });
    watcher.on("error", () => {
      /* intentional no-op: watcher errors are non-fatal */
    });
  } catch {
    // Directory doesn't exist — no watcher needed
  }
}

export function getWorktreeTarget(branch: string): URL | null {
  const entry = worktreeMap.get(branch);
  if (!entry) return null;
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

export function stopRegistry(): void {
  watcher?.close();
  watcher = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
