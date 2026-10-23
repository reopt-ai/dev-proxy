import { basename } from "node:path";
import { useSyncExternalStore } from "react";
import { config } from "./config.js";
import { getWorktreeTarget } from "./worktrees.js";
import { getPeer, getPeerTarget } from "./peers.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

/** Sentinel route key for the apex (bare) domain — e.g. `example.dev` itself. */
export const APEX_KEY = "@";

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
/** `config.domain` as Host headers are compared: lower case, no DNS trailing dot. */
let trustedDomain = "";
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
  trustedDomain = config.domain.replace(/\.$/, "").toLowerCase();

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

/** Plain-HTTP port, or `null` when the HTTP listener is turned off. */
export const PROXY_PORT = config.port;
export const HTTPS_PORT = config.httpsPort;
export const CERT_PATH = config.certPath;
export const KEY_PATH = config.keyPath;
export const UPSTREAM_TIMEOUTS = config.timeouts;

/** `http://*.<domain>:<port>` to show people — https without a port suffix when HTTP is off. */
export function exampleOrigin(): string {
  if (PROXY_PORT !== null) return `http://*.${DOMAIN}:${String(PROXY_PORT)}`;
  return `https://*.${DOMAIN}${HTTPS_PORT === 443 ? "" : `:${String(HTTPS_PORT)}`}`;
}

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
  /** Owner label when the subdomain is served by a peer machine. */
  peer: string | null;
}

/** Lower-case hostname of a Host header without port or DNS trailing dot; null if malformed. */
function hostnameOf(host: string): string | null {
  const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(host);
  if (!match?.[1]) return null;
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return match[1].replace(/\.$/, "").toLowerCase();
}

function splitHostname(hostname: string): { app: string; worktree: string | null } {
  const subdomain = hostname.split(".")[0] ?? hostname;
  const delimIdx = subdomain.indexOf("--");
  if (delimIdx !== -1) {
    return {
      worktree: subdomain.slice(0, delimIdx),
      app: subdomain.slice(delimIdx + 2),
    };
  }
  // Bare/apex domain (host equals the configured domain) gets its own key.
  if (hostname === trustedDomain) {
    return { app: APEX_KEY, worktree: null };
  }
  return { app: subdomain, worktree: null };
}

export function parseHost(host: string): {
  app: string;
  worktree: string | null;
} {
  return splitHostname(hostnameOf(host) ?? "");
}

export function getTarget(host: string): TargetResult {
  // A matching first label alone is not authority to reach a local service:
  // an attacker controls the DNS for e.g. `api.attacker.example`.
  const hostname = hostnameOf(host);
  if (
    !hostname ||
    (hostname !== trustedDomain && !hostname.endsWith(`.${trustedDomain}`))
  ) {
    return { url: null, worktree: null, peer: null };
  }
  const { app, worktree } = splitHostname(hostname);
  if (worktree) {
    const target = getWorktreeTarget(worktree, app);
    return { url: target, worktree, peer: null };
  }
  // A peer claim takes precedence over the local route for the same subdomain.
  const peerTarget = getPeerTarget(app);
  if (peerTarget) {
    return { url: peerTarget, worktree: null, peer: getPeer(app)?.owner ?? null };
  }
  return { url: parsedRoutes.get(app) ?? wildcardTarget, worktree: null, peer: null };
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
