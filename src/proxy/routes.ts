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

// ── Build from project configs ──────────────────────────────

const parsedRoutes = new Map<string, URL>();
let wildcardTarget: URL | null = null;

for (const project of config.projects) {
  for (const [subdomain, target] of Object.entries(project.routes)) {
    if (subdomain === "*") {
      // First wildcard wins
      wildcardTarget ??= parseTarget(`${project.path} routes.*`, target);
      continue;
    }
    // First registration wins — later projects don't override
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

export const DOMAIN = config.domain;
export const ROUTES: Record<string, string> = Object.fromEntries(
  [...parsedRoutes.entries()].map(([sub, url]) => [sub, formatTarget(url)]),
);
export const DEFAULT_TARGET = wildcardTarget ? formatTarget(wildcardTarget) : null;
export const PROXY_PORT = config.port;
export const HTTPS_PORT = config.httpsPort;
export const CERT_PATH = config.certPath;
export const KEY_PATH = config.keyPath;

export interface TargetResult {
  url: URL | null;
  worktree: string | null;
}

export function parseHost(host: string): {
  app: string;
  worktree: string | null;
} {
  const subdomain = host.split(".")[0] ?? host;
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
