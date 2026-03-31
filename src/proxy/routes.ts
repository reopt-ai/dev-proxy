import { basename } from "node:path";
import { useSyncExternalStore } from "react";
import { config } from "./config.js";
import { getWorktreeTarget } from "./worktrees.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

// ── Helpers ──────────────────────────────────────────────────

function formatTarget(url: URL): string {
  return url.pathname === "/" && !url.search && !url.hash ? url.origin : url.toString();
}

function parseTarget(label: string, raw: string): URL | null {
  try {
    const target = new URL(raw);
    if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
      console.error(
        `[dev-proxy] Ignoring ${label}: unsupported protocol "${target.protocol}"`,
      );
      return null;
    }
    return target;
  } catch (err) {
    console.error(`[dev-proxy] Ignoring ${label}: ${(err as Error).message}`);
    return null;
  }
}

// ── Types ───────────────────────────────────────────────────

export interface ProjectRouteGroup {
  project: string;
  label: string;
  routes: Record<string, string>;
}

export interface RouteSnapshot {
  domain: string;
  routes: Record<string, string>;
  defaultTarget: string | null;
  byProject: ProjectRouteGroup[];
}

// ── Mutable route state ─────────────────────────────────────

const parsedRoutes = new Map<string, URL>();
let wildcardTarget: URL | null = null;
let snapshot: RouteSnapshot = {
  domain: "",
  routes: {},
  defaultTarget: null,
  byProject: [],
};

function buildSnapshot(): RouteSnapshot {
  return {
    domain: config.domain,
    routes: Object.fromEntries(
      [...parsedRoutes.entries()].map(([sub, url]) => [sub, formatTarget(url)]),
    ),
    defaultTarget: wildcardTarget ? formatTarget(wildcardTarget) : null,
    byProject: config.projects
      .map((project) => {
        const routes: Record<string, string> = {};
        for (const [sub] of Object.entries(project.routes)) {
          if (sub === "*") continue;
          const parsed = parsedRoutes.get(sub);
          if (parsed) routes[sub] = formatTarget(parsed);
        }
        return { project: project.path, label: basename(project.path), routes };
      })
      .filter((g) => Object.keys(g.routes).length > 0),
  };
}

function buildRoutes(): void {
  parsedRoutes.clear();
  wildcardTarget = null;

  for (const project of config.projects) {
    for (const [subdomain, target] of Object.entries(project.routes)) {
      if (subdomain === "*") {
        wildcardTarget ??= parseTarget(`${project.path} routes.*`, target);
        continue;
      }
      if (!parsedRoutes.has(subdomain)) {
        const parsed = parseTarget(`${project.path} routes.${subdomain}`, target);
        if (parsed) parsedRoutes.set(subdomain, parsed);
      } else {
        console.warn(
          `[dev-proxy] Ignoring duplicate subdomain "${subdomain}" from ${project.path} (already registered)`,
        );
      }
    }
  }

  snapshot = buildSnapshot();
}

// Initial build
buildRoutes();

/** Rebuild route table from current config. Call after reloadConfig(). */
export function rebuildRoutes(): void {
  buildRoutes();
  notify();
}

// ── Static exports (server-level, require restart) ──────────

export const PROXY_PORT = config.port;
export const HTTPS_PORT = config.httpsPort;
export const CERT_PATH = config.certPath;
export const KEY_PATH = config.keyPath;

// ── Dynamic exports (reflect latest routes) ─────────────────

export function getDomain(): string {
  return snapshot.domain;
}
export function getRoutes(): Record<string, string> {
  return snapshot.routes;
}
export function getDefaultTarget(): string | null {
  return snapshot.defaultTarget;
}
export function getRoutesByProject(): ProjectRouteGroup[] {
  return snapshot.byProject;
}

// Keep backward-compatible const exports for non-reactive consumers
export const DOMAIN = config.domain;

// ── Route resolution ────────────────────────────────────────

export interface TargetResult {
  url: URL | null;
  worktree: string | null;
}

export function parseHost(host: string): {
  app: string;
  worktree: string | null;
} {
  // Strip port number before parsing (HTTP Host header may include :port)
  const hostOnly = host.replace(/:\d+$/, "").toLowerCase();
  const subdomain = hostOnly.split(".")[0] ?? hostOnly;
  const delimIdx = subdomain.indexOf("--");
  if (delimIdx !== -1) {
    return {
      worktree: subdomain.slice(0, delimIdx),
      app: subdomain.slice(delimIdx + 2),
    };
  }
  return { app: subdomain, worktree: null };
}

export function getTarget(host: string): TargetResult {
  const { app, worktree } = parseHost(host);
  if (worktree) {
    const target = getWorktreeTarget(worktree, app);
    return { url: target, worktree };
  }
  return { url: parsedRoutes.get(app) ?? wildcardTarget, worktree: null };
}

// ── React subscription (useSyncExternalStore) ───────────────

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): RouteSnapshot {
  return snapshot;
}

export function useRouteSnapshot(): RouteSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const __testing = { subscribe, getSnapshot };
