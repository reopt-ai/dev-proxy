import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
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
  /**
   * Hostname to verify the certificate against when `root` is loopback HTTPS
   * (the root machine with its HTTP listener off): the certificate is issued
   * for the dev domain, not for 127.0.0.1.
   */
  servername?: string;
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
 * machine has a root token (i.e. it runs the proxy), talk to it on loopback —
 * over HTTPS when the HTTP listener is off (`port: false`).
 */
export function resolvePeerClient(
  localPort: number | null,
  localHttpsPort = 3443,
  domain = "localhost",
): PeerClientConfig | null {
  const joined = readPeerClientConfig();
  if (joined) return joined;
  try {
    const token = readFileSync(PEER_TOKEN_PATH, "utf-8").trim();
    if (token) {
      if (localPort === null) {
        return {
          root: `https://127.0.0.1:${String(localHttpsPort)}`,
          token,
          servername: domain,
        };
      }
      return { root: `http://127.0.0.1:${String(localPort)}`, token };
    }
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
 * The root's HTTP port is unknown here, so 80 and this machine's own port
 * are guessed next. Anything more specific (scheme, port or IP) is used
 * exactly as given.
 */
export function rootCandidates(input: string, defaultPort: number | null): string[] {
  const guessPort = defaultPort ?? 3000;
  const exact = normalizeRoot(input, guessPort);
  if (!exact) return [];
  if (/^https?:\/\//.test(input)) return [exact];
  const url = new URL(`http://${input}`);
  const host = url.hostname;
  if (url.port || net.isIP(host.replace(/^\[|\]$/g, "")) !== 0) return [exact];
  const rootHost = host.startsWith("root.") ? host : `root.${host}`;
  const candidates = [
    `https://${rootHost}`,
    `http://${rootHost}`,
    `http://${rootHost}:${String(guessPort)}`,
    exact,
  ];
  return [...new Set(candidates)];
}

export function defaultOwner(): string {
  return hostname().replace(/\.local$/i, "");
}

export class PeerApiError extends Error {
  constructor(
    message: string,
    /** HTTP status when the root answered. */
    readonly status?: number,
    /** Socket/TLS error code (`ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`, `CERT_*`…) when it did not. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "PeerApiError";
  }
}

/**
 * fetch hides the useful part of a network failure in `cause` (and a dual-stack
 * connect failure inside an AggregateError below that). Dig it out so callers
 * can tell DNS, connection and certificate problems apart.
 */
function networkFailure(err: unknown): { code?: string; message: string } {
  if ((err as Error).name === "TimeoutError") {
    return { code: "ETIMEDOUT", message: "timed out" };
  }
  const cause = ((err as { cause?: unknown }).cause ?? err) as {
    code?: unknown;
    message?: unknown;
    errors?: { code?: unknown; message?: unknown }[];
  };
  const first = cause.errors?.[0];
  const code = cause.code ?? first?.code;
  const message = cause.message ?? first?.message ?? (err as Error).message;
  return {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : String(err),
  };
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

const CALL_TIMEOUT_MS = 5000;

interface Reply {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * fetch cannot be told which name to check a certificate against, so the
 * loopback HTTPS path goes through `https.request` with `servername` set to
 * the dev domain. The certificate is still fully verified — just against the
 * name it was issued for instead of 127.0.0.1.
 */
function namedRequest(
  url: string,
  servername: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method, headers, servername, timeout: CALL_TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(JSON.parse(text) as unknown),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function call<T = PeersResponse>(
  cfg: { root: string; token?: string; servername?: string },
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${cfg.root}/_dev-proxy/${path}`;
  const headers = {
    ...(cfg.token !== undefined ? { Authorization: `Bearer ${cfg.token}` } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  };
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  let res: Reply;
  try {
    res =
      cfg.servername !== undefined && cfg.root.startsWith("https://")
        ? await namedRequest(url, cfg.servername, method, headers, payload)
        : await fetch(url, {
            method,
            headers,
            body: payload,
            signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
          });
  } catch (err) {
    const failure = networkFailure(err);
    throw new PeerApiError(
      `cannot reach root proxy at ${cfg.root}: ${failure.message}`,
      undefined,
      failure.code,
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
