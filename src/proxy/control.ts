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

/**
 * Control API served by the root proxy under `/_dev-proxy/`.
 *
 * Peers on the LAN use it to claim and release subdomains (see `peer` CLI).
 * Every request needs the root's bearer token and must come from a loopback
 * or private address — this is a dev tool, not an internet-facing API.
 *
 *   GET    /_dev-proxy/peers          → { domain, peers: { [sub]: PeerEntry } }
 *   PUT    /_dev-proxy/peers/:sub     ← { target, owner }
 *   DELETE /_dev-proxy/peers/:sub
 */

export const CONTROL_PREFIX = "/_dev-proxy/";
const MAX_BODY_BYTES = 4096;

export function isControlPath(url: string | undefined): boolean {
  return url?.startsWith(CONTROL_PREFIX) === true;
}

/** Loopback, RFC 1918, link-local and CGNAT ranges — the only callers we accept. */
export function isPrivateAddress(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith("::ffff:") ? address.slice(7) : address;
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

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
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
    if (!tokenMatches(req.headers.authorization, token)) {
      send(res, 401, { error: "invalid or missing bearer token" });
      return true;
    }

    const path = (req.url ?? "").slice(CONTROL_PREFIX.length).replace(/\?.*$/, "");
    const [resource, sub, ...rest] = path.split("/");

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
          const result = claimPeer(sub, target, owner);
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
