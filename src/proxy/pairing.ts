import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { useSyncExternalStore } from "react";
import { CONFIG_DIR } from "./config.js";

/**
 * Peer pairing — how a machine earns a control-API token without anyone
 * copying a secret around.
 *
 * The peer generates its own token and sends only the SHA-256 of it. The root
 * shows the request (name, address, a short code derived from the hash) and a
 * human approves it in the TUI. From then on the peer authenticates with the
 * token it kept; the root only ever stores the hash, so the file on disk
 * cannot be replayed and each machine can be revoked on its own.
 */

export const PEER_DEVICES_PATH = resolve(CONFIG_DIR, "peer-devices.json");

/** A request nobody answered is dropped after this long. */
export const PAIR_TTL_MS = 5 * 60_000;
/** The pair endpoint is unauthenticated, so keep the queue small. */
const MAX_PENDING = 8;
const MAX_NAME_LENGTH = 40;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;

export interface PairRequest {
  id: string;
  name: string;
  /** Address the request came from. */
  address: string;
  tokenHash: string;
  requestedAt: number;
}

export interface PeerDevice {
  name: string;
  address: string;
  tokenHash: string;
  approvedAt: number;
}

export type PairStatus = "pending" | "approved" | "denied" | "unknown";

// ── State ────────────────────────────────────────────────────

interface TrackedRequest extends PairRequest {
  denied: boolean;
}

let requests = new Map<string, TrackedRequest>();
let devices = new Map<string, PeerDevice>();
const listeners = new Set<() => void>();
let pendingSnapshot: readonly PairRequest[] = [];

function notify(): void {
  pendingSnapshot = [...requests.values()].filter((r) => !r.denied);
  for (const l of listeners) l();
}

// ── Helpers ──────────────────────────────────────────────────

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Short code both sides can show so the approver knows which request is which. */
export function pairCode(tokenHash: string): string {
  const head = tokenHash.slice(0, 6).toUpperCase();
  return `${head.slice(0, 3)}-${head.slice(3)}`;
}

/**
 * The name arrives unauthenticated and ends up on the root's terminal, so
 * strip anything that is not plainly printable.
 */
export function sanitizeDeviceName(raw: string): string {
  return raw
    .replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function prune(now: number): boolean {
  let changed = false;
  for (const [id, req] of requests) {
    if (now - req.requestedAt >= PAIR_TTL_MS) {
      requests.delete(id);
      changed = true;
    }
  }
  return changed;
}

// ── Persistence ──────────────────────────────────────────────

function isDevice(value: unknown): value is PeerDevice {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === "string" &&
    typeof v.address === "string" &&
    typeof v.tokenHash === "string" &&
    TOKEN_HASH_RE.test(v.tokenHash) &&
    typeof v.approvedAt === "number"
  );
}

function readDevicesFile(): Map<string, PeerDevice> {
  const next = new Map<string, PeerDevice>();
  if (!existsSync(PEER_DEVICES_PATH)) return next;
  try {
    const data = JSON.parse(readFileSync(PEER_DEVICES_PATH, "utf-8")) as unknown;
    if (typeof data !== "object" || data === null) return next;
    for (const [id, device] of Object.entries(data as Record<string, unknown>)) {
      if (isDevice(device)) next.set(id, device);
    }
  } catch (err) {
    console.error(`[dev-proxy] Ignoring ${PEER_DEVICES_PATH}: ${(err as Error).message}`);
  }
  return next;
}

function writeDevicesFile(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  // Write-then-rename so a concurrent reader never sees a partial file.
  const tmp = `${PEER_DEVICES_PATH}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(devices), null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(tmp, PEER_DEVICES_PATH);
}

// ── Public API (root side) ───────────────────────────────────

/** Load approved devices from disk. Call at startup and when the file changes. */
export function loadDevices(): void {
  devices = readDevicesFile();
}

export function listDevices(): ReadonlyMap<string, PeerDevice> {
  return devices;
}

/** Id of the paired machine this token belongs to, if any. */
export function deviceIdForToken(token: string): string | null {
  const hash = hashToken(token);
  for (const [id, device] of devices) {
    if (device.tokenHash === hash) return id;
  }
  return null;
}

export function requestPairing(
  name: string,
  address: string,
  tokenHash: string,
  now = Date.now(),
): { ok: true; request: PairRequest } | { ok: false; status: number; error: string } {
  const cleanName = sanitizeDeviceName(name);
  if (!cleanName) return { ok: false, status: 400, error: "name is required" };
  if (!TOKEN_HASH_RE.test(tokenHash)) {
    return { ok: false, status: 400, error: "tokenHash must be a sha256 hex digest" };
  }

  prune(now);
  // A machine asking again replaces its earlier request instead of piling up.
  for (const [id, req] of requests) {
    if (req.address === address) requests.delete(id);
  }
  if (requests.size >= MAX_PENDING) {
    notify();
    return { ok: false, status: 429, error: "too many pending pair requests" };
  }

  const request: TrackedRequest = {
    id: randomBytes(8).toString("hex"),
    name: cleanName,
    address,
    tokenHash,
    requestedAt: now,
    denied: false,
  };
  requests.set(request.id, request);
  // Expire it even if nobody polls or asks again.
  setTimeout(() => {
    if (prune(Date.now())) notify();
  }, PAIR_TTL_MS + 1000).unref();
  notify();
  return { ok: true, request };
}

/** What the peer sees while polling; it must present the token it hashed. */
export function pairingStatus(id: string, token: string, now = Date.now()): PairStatus {
  if (prune(now)) notify();
  const hash = hashToken(token);
  if (devices.get(id)?.tokenHash === hash) return "approved";
  const req = requests.get(id);
  if (req?.tokenHash !== hash) return "unknown";
  return req.denied ? "denied" : "pending";
}

export function approvePairing(id: string, now = Date.now()): PeerDevice | null {
  const req = requests.get(id);
  if (!req || req.denied) return null;
  requests.delete(id);
  // Re-pairing a machine supersedes its previous token.
  for (const [deviceId, device] of devices) {
    if (device.name === req.name) devices.delete(deviceId);
  }
  const device: PeerDevice = {
    name: req.name,
    address: req.address,
    tokenHash: req.tokenHash,
    approvedAt: now,
  };
  devices.set(id, device);
  writeDevicesFile();
  notify();
  return device;
}

/** Keep the request around as denied so the waiting peer gets a clear answer. */
export function denyPairing(id: string): boolean {
  const req = requests.get(id);
  if (!req || req.denied) return false;
  req.denied = true;
  notify();
  return true;
}

/** Remove every device with this name or id. Returns the ids that were removed. */
export function revokeDevice(nameOrId: string): string[] {
  const removed: string[] = [];
  for (const [id, device] of devices) {
    if (id === nameOrId || device.name === nameOrId) {
      devices.delete(id);
      removed.push(id);
    }
  }
  if (removed.length > 0) writeDevicesFile();
  return removed;
}

// ── React hook ───────────────────────────────────────────────

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): readonly PairRequest[] {
  return pendingSnapshot;
}

export function usePairRequests(): readonly PairRequest[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const __testing = {
  readDevicesFile,
  reset(): void {
    requests = new Map();
    devices = new Map();
    pendingSnapshot = [];
    listeners.clear();
  },
  get requests() {
    return requests;
  },
  get devices() {
    return devices;
  },
};
