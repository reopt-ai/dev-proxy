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

// ── Build from config ────────────────────────────────────────

const parsedRoutes = new Map<string, URL>();
for (const [subdomain, target] of Object.entries(config.routes)) {
  const parsed = parseTarget(`routes.${subdomain}`, target);
  if (parsed) parsedRoutes.set(subdomain, parsed);
}

const defaultTarget =
  parseTarget("defaultTarget", config.defaultTarget) ?? new URL("http://localhost:3001");

export const DOMAIN = config.domain;
export const ROUTES: Record<string, string> = Object.fromEntries(
  [...parsedRoutes.entries()].map(([sub, url]) => [sub, formatTarget(url)]),
);
export const DEFAULT_TARGET = formatTarget(defaultTarget);
export const PROXY_PORT = config.port;
export const HTTPS_PORT = config.httpsPort;
export const CERT_PATH = config.certPath;
export const KEY_PATH = config.keyPath;

const DEFAULT_PARSED = defaultTarget;

export interface TargetResult {
  url: URL;
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
    const target = getWorktreeTarget(worktree);
    if (target) return { url: target, worktree };
  }
  return { url: parsedRoutes.get(app) ?? DEFAULT_PARSED, worktree: null };
}
