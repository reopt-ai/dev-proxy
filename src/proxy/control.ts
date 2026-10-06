import type http from "node:http";
import { timingSafeEqual } from "node:crypto";
import net from "node:net";
import { config } from "./config.js";
import {
  claimPeer,
  listPeers,
  probePeers,
  releasePeer,
  type PeerEntry,
} from "./peers.js";
import { deviceIdForToken, pairCode, pairingStatus, requestPairing } from "./pairing.js";

/**
 * Control API served by the root proxy under `/_dev-proxy/`.
 *
 * Peers on the LAN use it to claim and release subdomains (see `peer` CLI).
 * Every request must come from a loopback or private address — this is a dev
 * tool, not an internet-facing API — and, apart from pairing, needs a bearer
 * token: the root's own, or one a paired machine had approved (see pairing.ts).
 *
 *   POST   /_dev-proxy/pair           ← { name, tokenHash } → { id, code, domain }
 *   GET    /_dev-proxy/pair/:id       → { status, domain }
 *   GET    /_dev-proxy/peers          → { domain, peers: { [sub]: PeerEntry } }
 *   PUT    /_dev-proxy/peers/:sub     ← { target, owner }
 *   DELETE /_dev-proxy/peers/:sub
 */

export const CONTROL_PREFIX = "/_dev-proxy/";
const MAX_BODY_BYTES = 4096;

export function isControlPath(url: string | undefined): boolean {
  return url?.startsWith(CONTROL_PREFIX) === true;
}

/** Drop the IPv4-mapped IPv6 prefix so addresses read and compare as IPv4. */
function plainAddress(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/** Loopback, RFC 1918, link-local and CGNAT ranges — the only callers we accept. */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const ip = plainAddress(address);
  if (ip === "::1") return true;
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10)
  const lower = ip.toLowerCase();
  return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function tokenMatches(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown;
        resolve(
          typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : {},
        );
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function serializePeers(): { domain: string; peers: Record<string, PeerEntry> } {
  return { domain: config.domain, peers: Object.fromEntries(listPeers()) };
}

function handlePair(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string | undefined,
  bearer: string | null,
): void {
  if (req.method === "POST" && !id) {
    void readJsonBody(req)
      .then((body) => {
        const result = requestPairing(
          typeof body.name === "string" ? body.name : "",
          plainAddress(req.socket.remoteAddress ?? ""),
          typeof body.tokenHash === "string" ? body.tokenHash : "",
        );
        if (!result.ok) {
          send(res, result.status, { error: result.error });
          return;
        }
        send(res, 200, {
          id: result.request.id,
          code: pairCode(result.request.tokenHash),
          domain: config.domain,
        });
      })
      .catch((err: unknown) => {
        send(res, 400, { error: (err as Error).message });
      });
    return;
  }

  if (req.method === "GET" && id) {
    if (!bearer) {
      send(res, 401, { error: "invalid or missing bearer token" });
      return;
    }
    send(res, 200, { status: pairingStatus(id, bearer), domain: config.domain });
    return;
  }

  send(res, 405, { error: "method not allowed" });
}

/**
 * Returns a handler that fully answers control requests. The proxy's request
 * handler calls it first and skips normal routing when it returns true.
 */
export function createControlHandler(
  token: string,
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  return (req, res) => {
    if (!isControlPath(req.url)) return false;

    if (!isPrivateAddress(req.socket.remoteAddress)) {
      send(res, 403, { error: "control API is only available from the local network" });
      return true;
    }
    // Node clients never send Origin; a browser attaches it to every request
    // that could change state, and a web page has no business driving this API.
    if (req.headers.origin !== undefined) {
      send(res, 403, { error: "control API does not accept browser requests" });
      return true;
    }

    const path = (req.url ?? "").slice(CONTROL_PREFIX.length).replace(/\?.*$/, "");
    const [resource, sub, ...rest] = path.split("/");
    const bearer = bearerToken(req.headers.authorization);

    // Pairing is how a machine gets a token, so it cannot require one.
    if (resource === "pair" && rest.length === 0) {
      handlePair(req, res, sub, bearer);
      return true;
    }

    const deviceId = bearer ? deviceIdForToken(bearer) : null;
    if (!bearer || !(tokenMatches(bearer, token) || deviceId !== null)) {
      send(res, 401, { error: "invalid or missing bearer token" });
      return true;
    }

    if (resource !== "peers" || rest.length > 0) {
      send(res, 404, { error: "not found" });
      return true;
    }

    if (req.method === "GET" && !sub) {
      send(res, 200, serializePeers());
      return true;
    }

    if (req.method === "PUT" && sub) {
      void readJsonBody(req)
        .then((body) => {
          const target = typeof body.target === "string" ? body.target : "";
          const owner = typeof body.owner === "string" ? body.owner : "";
          // Remember which machine claimed it so revoking the machine frees the subdomain.
          const result = claimPeer(sub, target, owner, deviceId ?? undefined);
          if (!result.ok) {
            send(res, 400, { error: result.error });
            return;
          }
          // Probe right away so `peer list` does not show "unknown" for 30s.
          void probePeers();
          send(res, 200, { ...serializePeers(), replaced: result.replaced });
        })
        .catch((err: unknown) => {
          send(res, 400, { error: (err as Error).message });
        });
      return true;
    }

    if (req.method === "DELETE" && sub) {
      const removed = releasePeer(sub);
      send(
        res,
        removed ? 200 : 404,
        removed ? { peers: serializePeers() } : { error: "no such claim" },
      );
      return true;
    }

    send(res, 405, { error: "method not allowed" });
    return true;
  };
}
