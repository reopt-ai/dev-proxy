import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { resolve } from "node:path";
import { useSyncExternalStore } from "react";
import { CONFIG_DIR } from "./config.js";

/**
 * Peer registry — subdomains served by other machines on the LAN.
 *
 * The root proxy (the machine the dev domain's DNS points at) owns this
 * file. Peers never run a proxy; they call the control API (see
 * `createControlHandler`) to claim a subdomain for `http://<their-ip>:<port>`
 * and the root routes it there. A claim beats the local route for the same
 * subdomain so a developer can take over e.g. `studio` without anyone editing
 * config or hosts files.
 */

export const PEERS_PATH = resolve(CONFIG_DIR, "peers.json");
export const PEER_TOKEN_PATH = resolve(CONFIG_DIR, "peer-token");

/** How often the root probes claim targets. */
export const PEER_PROBE_INTERVAL_MS = 30_000;
/** A claim whose target has been unreachable this long is dropped. */
export const PEER_STALE_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 2_000;

export interface PeerClaim {
  /** Origin the subdomain is forwarded to, e.g. `http://192.168.1.20:3001`. */
  target: string;
  /** Free-form owner label (hostname of the claiming machine by default). */
  owner: string;
  /** Epoch ms when the claim was made (or last re-asserted). */
  since: number;
  /** Id of the paired machine that made the claim; absent for the root's own token. */
  device?: string;
}

export type PeerStatus = "unknown" | "ok" | "unreachable";

export interface PeerEntry extends PeerClaim {
  status: PeerStatus;
  /** Epoch ms of the first failed probe in the current outage, if any. */
  unreachableSince?: number;
}

// ── State ────────────────────────────────────────────────────

let peers = new Map<string, PeerEntry>();
let probeTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, PeerEntry> = peers;

function notify(): void {
  snapshot = new Map(peers);
  for (const l of listeners) l();
}

// ── Validation ───────────────────────────────────────────────

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidPeerSubdomain(value: string): boolean {
  return SUBDOMAIN_RE.test(value);
}

/** Accept only plain http(s) origins — no path, query or credentials. */
export function parsePeerTarget(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function isClaim(value: unknown): value is PeerClaim {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.target === "string" &&
    parsePeerTarget(v.target) !== null &&
    typeof v.owner === "string" &&
    typeof v.since === "number" &&
    (v.device === undefined || typeof v.device === "string")
  );
}

// ── Persistence ──────────────────────────────────────────────

function readPeersFile(): Map<string, PeerEntry> {
  const next = new Map<string, PeerEntry>();
  if (!existsSync(PEERS_PATH)) return next;
  try {
    const data = JSON.parse(readFileSync(PEERS_PATH, "utf-8")) as unknown;
    if (typeof data !== "object" || data === null) return next;
    for (const [sub, claim] of Object.entries(data as Record<string, unknown>)) {
      if (isValidPeerSubdomain(sub) && isClaim(claim)) {
        // Keep probe state for claims we already know about.
        const prev = peers.get(sub);
        const unchanged = prev?.target === claim.target;
        next.set(sub, {
          target: claim.target,
          owner: claim.owner,
          since: claim.since,
          device: claim.device,
          status: unchanged ? prev.status : "unknown",
          unreachableSince: unchanged ? prev.unreachableSince : undefined,
        });
      }
    }
  } catch (err) {
    console.error(`[dev-proxy] Ignoring ${PEERS_PATH}: ${(err as Error).message}`);
  }
  return next;
}

function writePeersFile(): void {
  const data: Record<string, PeerClaim> = {};
  for (const [sub, entry] of peers) {
    data[sub] = {
      target: entry.target,
      owner: entry.owner,
      since: entry.since,
      device: entry.device,
    };
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  // Write-then-rename so a concurrent reader never sees a partial file.
  const tmp = `${PEERS_PATH}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, PEERS_PATH);
}

// ── Public API (root side) ───────────────────────────────────

/** Load claims from disk. Call once at startup and again when the file changes. */
export function loadPeers(): void {
  peers = readPeersFile();
  notify();
}

export function getPeerTarget(subdomain: string): URL | null {
  const entry = peers.get(subdomain);
  return entry ? new URL(entry.target) : null;
}

export function getPeer(subdomain: string): PeerEntry | undefined {
  return peers.get(subdomain);
}

export function listPeers(): ReadonlyMap<string, PeerEntry> {
  return snapshot;
}

export interface ClaimResult {
  ok: true;
  /** Previous claim this one replaced, if any. */
  replaced: PeerEntry | null;
}

export function claimPeer(
  subdomain: string,
  target: string,
  owner: string,
  device?: string,
): ClaimResult | { ok: false; error: string } {
  if (!isValidPeerSubdomain(subdomain)) {
    return { ok: false, error: `invalid subdomain "${subdomain}"` };
  }
  const url = parsePeerTarget(target);
  if (!url) {
    return {
      ok: false,
      error: `invalid target "${target}" — expected http(s)://host:port`,
    };
  }
  if (!owner.trim()) {
    return { ok: false, error: "owner is required" };
  }
  const replaced = peers.get(subdomain) ?? null;
  // Last claim wins; the TUI/status surfaces the handover.
  peers.set(subdomain, {
    target: url.origin,
    owner: owner.trim(),
    since: Date.now(),
    device,
    status: "unknown",
  });
  writePeersFile();
  notify();
  return { ok: true, replaced };
}

export function releasePeer(subdomain: string): boolean {
  if (!peers.delete(subdomain)) return false;
  writePeersFile();
  notify();
  return true;
}

/** Drop every claim made by these paired machines. Returns the subdomains released. */
export function releasePeersOfDevices(deviceIds: ReadonlySet<string>): string[] {
  const released: string[] = [];
  for (const [sub, entry] of peers) {
    if (entry.device !== undefined && deviceIds.has(entry.device)) {
      peers.delete(sub);
      released.push(sub);
    }
  }
  if (released.length > 0) {
    writePeersFile();
    notify();
  }
  return released;
}

// ── Health probing ───────────────────────────────────────────

function probe(target: string): Promise<boolean> {
  return new Promise((res) => {
    const url = new URL(target);
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    const socket = net.createConnection({ host: url.hostname, port }, () => {
      socket.destroy();
      res(true);
    });
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      res(false);
    });
    socket.on("error", () => {
      socket.destroy();
      res(false);
    });
  });
}

/** Probe every claim once; drop claims unreachable for longer than PEER_STALE_MS. */
export async function probePeers(now = Date.now()): Promise<void> {
  const entries = [...peers.entries()];
  const changes = await Promise.all(
    entries.map(async ([sub, entry]): Promise<boolean> => {
      const reachable = await probe(entry.target);
      const current = peers.get(sub);
      // The claim may have been replaced or released while probing.
      if (current?.target !== entry.target) return false;
      if (reachable) {
        if (current.status === "ok" && current.unreachableSince === undefined)
          return false;
        current.status = "ok";
        current.unreachableSince = undefined;
        return true;
      }
      current.unreachableSince ??= now;
      if (now - current.unreachableSince >= PEER_STALE_MS) {
        console.warn(
          `[dev-proxy] Dropping stale peer claim "${sub}" (${entry.owner} → ${entry.target}, unreachable for ${String(Math.round(PEER_STALE_MS / 60_000))}m)`,
        );
        peers.delete(sub);
        writePeersFile();
        return true;
      }
      if (current.status === "unreachable") return false;
      current.status = "unreachable";
      return true;
    }),
  );
  if (changes.some(Boolean)) notify();
}

export function startPeerProbes(): void {
  if (probeTimer) return;
  void probePeers();
  probeTimer = setInterval(() => {
    void probePeers();
  }, PEER_PROBE_INTERVAL_MS);
  probeTimer.unref();
}

export function stopPeerProbes(): void {
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

// ── Control-API token ────────────────────────────────────────

/** Read the root's control-API token, creating it on first use. */
export function ensurePeerToken(): string {
  try {
    const existing = readFileSync(PEER_TOKEN_PATH, "utf-8").trim();
    if (existing) return existing;
  } catch {
    // Not created yet.
  }
  const token = randomBytes(24).toString("hex");
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(PEER_TOKEN_PATH, token + "\n", { mode: 0o600 });
  return token;
}

// ── React hook ───────────────────────────────────────────────

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReadonlyMap<string, PeerEntry> {
  return snapshot;
}

export function usePeers(): ReadonlyMap<string, PeerEntry> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const __testing = {
  isClaim,
  readPeersFile,
  probe,
  reset(): void {
    stopPeerProbes();
    peers = new Map();
    snapshot = peers;
    listeners.clear();
  },
  get peers() {
    return peers;
  },
};
