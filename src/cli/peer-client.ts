import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { CONFIG_DIR } from "../proxy/config.js";
import { PEER_TOKEN_PATH, type PeerEntry } from "../proxy/peers.js";

/**
 * Client side of the peer control API — used by `dev-proxy peer …` on machines
 * that do not run a proxy themselves. Connection details live in
 * `~/.dev-proxy/peer.json` (written by `peer join`). On the root machine
 * itself no join is needed: the local token and port are used directly.
 */

export const PEER_CLIENT_PATH = resolve(CONFIG_DIR, "peer.json");

export interface PeerClientConfig {
  /** Root proxy origin, e.g. `http://192.168.1.10:3000`. */
  root: string;
  token: string;
}

export function readPeerClientConfig(): PeerClientConfig | null {
  try {
    if (existsSync(PEER_CLIENT_PATH)) {
      const data = JSON.parse(
        readFileSync(PEER_CLIENT_PATH, "utf-8"),
      ) as Partial<PeerClientConfig>;
      if (typeof data.root === "string" && typeof data.token === "string") {
        return { root: data.root, token: data.token };
      }
    }
  } catch {
    // Treat an unreadable file as "not joined".
  }
  return null;
}

export function writePeerClientConfig(cfg: PeerClientConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PEER_CLIENT_PATH, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Resolve how to reach the root: an explicit join wins; otherwise, if this
 * machine has a root token (i.e. it runs the proxy), talk to it on loopback.
 */
export function resolvePeerClient(localPort: number): PeerClientConfig | null {
  const joined = readPeerClientConfig();
  if (joined) return joined;
  try {
    const token = readFileSync(PEER_TOKEN_PATH, "utf-8").trim();
    if (token) return { root: `http://127.0.0.1:${String(localPort)}`, token };
  } catch {
    // No local root either.
  }
  return null;
}

/** Normalise `host`, `host:port` or a full origin into a root origin. */
export function normalizeRoot(input: string, defaultPort: number): string | null {
  const withScheme = /^https?:\/\//.test(input) ? input : `http://${input}`;
  try {
    const url = new URL(withScheme);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    if (!url.port) url.port = String(defaultPort);
    return url.origin;
  } catch {
    return null;
  }
}

export function defaultOwner(): string {
  return hostname().replace(/\.local$/i, "");
}

export class PeerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PeerApiError";
  }
}

interface PeersResponse {
  /** The root's dev domain — the peer machine may not have one configured. */
  domain: string;
  peers: Record<string, PeerEntry>;
  replaced?: PeerEntry | null;
  error?: string;
}

async function call(
  cfg: PeerClientConfig,
  method: "GET" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<PeersResponse> {
  let res: Response;
  try {
    res = await fetch(`${cfg.root}/_dev-proxy/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new PeerApiError(
      `cannot reach root proxy at ${cfg.root}: ${(err as Error).message}`,
    );
  }
  const data = (await res.json().catch(() => ({}))) as PeersResponse;
  if (!res.ok) {
    throw new PeerApiError(
      data.error ?? `root proxy answered ${String(res.status)}`,
      res.status,
    );
  }
  return data;
}

export function fetchPeers(
  cfg: PeerClientConfig,
): Promise<{ domain: string; peers: Record<string, PeerEntry> }> {
  return call(cfg, "GET", "peers").then((r) => ({ domain: r.domain, peers: r.peers }));
}

export function claim(
  cfg: PeerClientConfig,
  subdomain: string,
  target: string,
  owner: string,
): Promise<{ domain: string; replaced: PeerEntry | null }> {
  return call(cfg, "PUT", `peers/${encodeURIComponent(subdomain)}`, {
    target,
    owner,
  }).then((r) => ({ domain: r.domain, replaced: r.replaced ?? null }));
}

export function release(cfg: PeerClientConfig, subdomain: string): Promise<void> {
  return call(cfg, "DELETE", `peers/${encodeURIComponent(subdomain)}`).then(
    () => undefined,
  );
}
