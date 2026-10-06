import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { CONFIG_DIR } from "../proxy/config.js";
import { PEER_TOKEN_PATH, type PeerEntry } from "../proxy/peers.js";
import type { PairStatus } from "../proxy/pairing.js";

/**
 * Client side of the peer control API — used by `dev-proxy peer …` on machines
 * that do not run a proxy themselves. Connection details live in
 * `~/.dev-proxy/peer.json` (written by `peer join`, which pairs with the root
 * so nobody has to copy a token by hand). On the root machine
 * itself no join is needed: the local token and port are used directly.
 */

export const PEER_CLIENT_PATH = resolve(CONFIG_DIR, "peer.json");

export interface PeerClientConfig {
  /** Root proxy origin, e.g. `https://root.example.dev` or `http://192.168.1.10:3000`. */
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

/**
 * Normalise `host`, `host:port` or a full origin into a root origin. The
 * default port is the proxy's plain-HTTP port, so it never applies to https.
 */
export function normalizeRoot(input: string, defaultPort: number): string | null {
  const withScheme = /^https?:\/\//.test(input) ? input : `http://${input}`;
  try {
    const url = new URL(withScheme);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    if (!url.port && url.protocol === "http:") url.port = String(defaultPort);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Origins to try for a `peer join` argument, most preferred first.
 *
 * A bare hostname is taken as the root's dev domain: with wildcard DNS
 * `root.<domain>` reaches the root over TLS without anyone knowing its IP.
 * Anything more specific (scheme, port or IP) is used exactly as given.
 */
export function rootCandidates(input: string, defaultPort: number): string[] {
  const exact = normalizeRoot(input, defaultPort);
  if (!exact) return [];
  if (/^https?:\/\//.test(input)) return [exact];
  const url = new URL(`http://${input}`);
  const host = url.hostname;
  if (url.port || net.isIP(host.replace(/^\[|\]$/g, "")) !== 0) return [exact];
  if (host.startsWith("root.")) return [`https://${host}`, exact];
  return [`https://root.${host}`, `http://root.${host}:${String(defaultPort)}`, exact];
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
}

interface PairResponse {
  id: string;
  /** Short code the root shows next to the request. */
  code: string;
  domain: string;
}

async function call<T = PeersResponse>(
  cfg: { root: string; token?: string },
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.root}/_dev-proxy/${path}`, {
      method,
      headers: {
        ...(cfg.token !== undefined ? { Authorization: `Bearer ${cfg.token}` } : {}),
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
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
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

/** Ask the root to pair this machine. Only the token's hash leaves the machine. */
export function requestPair(
  root: string,
  name: string,
  tokenHash: string,
): Promise<PairResponse> {
  return call<Partial<PairResponse>>({ root }, "POST", "pair", { name, tokenHash }).then(
    ({ id, code, domain }) => {
      // Something else may be listening where we guessed the root to be.
      if (
        typeof id !== "string" ||
        typeof code !== "string" ||
        typeof domain !== "string"
      ) {
        throw new PeerApiError(`${root} did not answer like a dev-proxy root`);
      }
      return { id, code, domain };
    },
  );
}

export function fetchPairStatus(
  root: string,
  id: string,
  token: string,
): Promise<PairStatus> {
  return call<{ status: PairStatus }>(
    { root, token },
    "GET",
    `pair/${encodeURIComponent(id)}`,
  ).then((r) => r.status);
}
