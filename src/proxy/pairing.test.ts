import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("node:fs", () => ({
  existsSync: (p: string) => files.has(p),
  readFileSync: (p: string) => {
    const v = files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  },
  writeFileSync: (p: string, data: string) => {
    files.set(p, data);
  },
  renameSync: (from: string, to: string) => {
    files.set(to, files.get(from) ?? "");
    files.delete(from);
  },
  mkdirSync: vi.fn(),
}));
vi.mock("./config.js", () => ({ CONFIG_DIR: "/mock/.dev-proxy" }));
vi.mock("react", () => ({ useSyncExternalStore: vi.fn() }));

const {
  __testing,
  PAIR_TTL_MS,
  PEER_DEVICES_PATH,
  approvePairing,
  denyPairing,
  hashToken,
  deviceIdForToken,
  listDevices,
  loadDevices,
  pairCode,
  pairingStatus,
  requestPairing,
  revokeDevice,
  sanitizeDeviceName,
} = await import("./pairing.js");

const TOKEN = "peer-secret";
const HASH = hashToken(TOKEN);

function request(name = "box-b", address = "192.168.1.20", hash = HASH, now = 1000) {
  const result = requestPairing(name, address, hash, now);
  if (!result.ok) throw new Error(result.error);
  return result.request;
}

beforeEach(() => {
  files.clear();
  __testing.reset();
});

describe("helpers", () => {
  it("derives a stable short code from the token hash", () => {
    expect(pairCode("a3f9c2" + "0".repeat(58))).toBe("A3F-9C2");
    expect(pairCode(HASH)).toBe(pairCode(hashToken(TOKEN)));
  });

  it("strips control characters and escape sequences from names", () => {
    expect(sanitizeDeviceName("  box\x1b[31m-b\n ")).toBe("box[31m-b");
    expect(sanitizeDeviceName("x".repeat(100))).toHaveLength(40);
    expect(sanitizeDeviceName("\x07\x00")).toBe("");
  });
});

describe("requestPairing", () => {
  it("rejects an empty name or a malformed hash", () => {
    expect(requestPairing("\x00", "10.0.0.2", HASH)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(requestPairing("box", "10.0.0.2", "not-a-hash")).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(__testing.requests.size).toBe(0);
  });

  it("replaces an earlier request from the same address", () => {
    const first = request("box-b", "192.168.1.20", HASH);
    const second = request("box-b", "192.168.1.20", hashToken("other"));
    expect([...__testing.requests.keys()]).toEqual([second.id]);
    expect(pairingStatus(first.id, TOKEN, 1000)).toBe("unknown");
  });

  it("caps the number of pending requests", () => {
    for (let i = 0; i < 8; i++) request(`box-${String(i)}`, `10.0.0.${String(i)}`);
    expect(requestPairing("one-more", "10.0.1.1", HASH, 1000)).toMatchObject({
      ok: false,
      status: 429,
    });
  });

  it("drops requests nobody answered within the TTL", () => {
    const req = request();
    expect(pairingStatus(req.id, TOKEN, 1000 + PAIR_TTL_MS - 1)).toBe("pending");
    expect(pairingStatus(req.id, TOKEN, 1000 + PAIR_TTL_MS)).toBe("unknown");
    expect(__testing.requests.size).toBe(0);
  });
});

describe("approval", () => {
  it("only answers a poll that presents the token behind the hash", () => {
    const req = request();
    expect(pairingStatus(req.id, "someone-else", 1000)).toBe("unknown");
    expect(pairingStatus(req.id, TOKEN, 1000)).toBe("pending");
  });

  it("turns an approved request into a device that authenticates", () => {
    const req = request();
    expect(deviceIdForToken(TOKEN)).toBeNull();

    expect(approvePairing(req.id, 2000)).toEqual({
      name: "box-b",
      address: "192.168.1.20",
      tokenHash: HASH,
      approvedAt: 2000,
    });
    expect(pairingStatus(req.id, TOKEN, 2000)).toBe("approved");
    expect(deviceIdForToken(TOKEN)).toBe(req.id);
    expect(deviceIdForToken("someone-else")).toBeNull();
    // Only the hash is persisted.
    expect(files.get(PEER_DEVICES_PATH)).not.toContain(TOKEN);
    expect(approvePairing(req.id)).toBeNull();
  });

  it("supersedes the previous token when a machine pairs again", () => {
    approvePairing(request().id);
    const again = request("box-b", "192.168.1.21", hashToken("new-token"));
    approvePairing(again.id);
    expect(listDevices().size).toBe(1);
    expect(deviceIdForToken(TOKEN)).toBeNull();
    expect(deviceIdForToken("new-token")).toBe(again.id);
  });

  it("reports a denial to the waiting peer and cannot approve it afterwards", () => {
    const req = request();
    expect(denyPairing(req.id)).toBe(true);
    expect(pairingStatus(req.id, TOKEN, 1000)).toBe("denied");
    expect(approvePairing(req.id)).toBeNull();
    expect(denyPairing(req.id)).toBe(false);
    expect(deviceIdForToken(TOKEN)).toBeNull();
  });
});

describe("devices file", () => {
  it("survives a reload and ignores malformed entries", () => {
    approvePairing(request().id, 2000);
    const saved = JSON.parse(files.get(PEER_DEVICES_PATH) ?? "{}") as Record<
      string,
      unknown
    >;
    files.set(
      PEER_DEVICES_PATH,
      JSON.stringify({ ...saved, broken: { name: "x", tokenHash: "nope" } }),
    );
    __testing.reset();

    loadDevices();
    expect([...listDevices().values()].map((d) => d.name)).toEqual(["box-b"]);
    expect(deviceIdForToken(TOKEN)).not.toBeNull();
  });

  it("treats an unreadable file as no devices", () => {
    files.set(PEER_DEVICES_PATH, "{not json");
    loadDevices();
    expect(listDevices().size).toBe(0);
  });

  it("revokes by name and stops accepting the token", () => {
    const req = request();
    approvePairing(req.id);
    expect(revokeDevice("nobody")).toEqual([]);
    expect(revokeDevice("box-b")).toEqual([req.id]);
    expect(deviceIdForToken(TOKEN)).toBeNull();
    expect(files.get(PEER_DEVICES_PATH)?.trim()).toBe("{}");
  });
});
