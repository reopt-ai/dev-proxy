import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ───────────────────────────────────────────────────

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

vi.mock("./config.js", () => ({
  CONFIG_DIR: "/mock/.dev-proxy",
}));

// TCP probe results per target origin.
const reachable = new Map<string, boolean>();
vi.mock("node:net", () => ({
  default: {
    createConnection: (opts: { host: string; port: number }, onConnect: () => void) => {
      const handlers: Record<string, () => void> = {};
      const socket = {
        destroy: vi.fn(),
        setTimeout: vi.fn(),
        on: (ev: string, cb: () => void) => {
          handlers[ev] = cb;
          return socket;
        },
      };
      queueMicrotask(() => {
        if (reachable.get(`http://${opts.host}:${String(opts.port)}`)) onConnect();
        else handlers.error?.();
      });
      return socket;
    },
  },
}));

vi.mock("react", () => ({ useSyncExternalStore: vi.fn() }));

const peers = await import("./peers.js");
const {
  __testing,
  claimPeer,
  releasePeer,
  loadPeers,
  getPeerTarget,
  listPeers,
  probePeers,
  parsePeerTarget,
  isValidPeerSubdomain,
  PEERS_PATH,
  PEER_STALE_MS,
  ensurePeerToken,
  PEER_TOKEN_PATH,
} = peers;

beforeEach(() => {
  files.clear();
  reachable.clear();
  __testing.reset();
});

// ── Validation ───────────────────────────────────────────────

describe("parsePeerTarget", () => {
  it("accepts plain http(s) origins", () => {
    expect(parsePeerTarget("http://192.168.1.20:3001")?.origin).toBe(
      "http://192.168.1.20:3001",
    );
    expect(parsePeerTarget("https://box.lan:8443/")?.origin).toBe("https://box.lan:8443");
  });

  it("rejects paths, credentials and other schemes", () => {
    expect(parsePeerTarget("http://h:1/app")).toBeNull();
    expect(parsePeerTarget("http://u:p@h:1")).toBeNull();
    expect(parsePeerTarget("ws://h:1")).toBeNull();
    expect(parsePeerTarget("not a url")).toBeNull();
  });
});

describe("isValidPeerSubdomain", () => {
  it("accepts dns labels and rejects the rest", () => {
    expect(isValidPeerSubdomain("studio")).toBe(true);
    expect(isValidPeerSubdomain("my-app2")).toBe(true);
    expect(isValidPeerSubdomain("-bad")).toBe(false);
    expect(isValidPeerSubdomain("a.b")).toBe(false);
    expect(isValidPeerSubdomain("")).toBe(false);
  });
});

// ── Claims ───────────────────────────────────────────────────

describe("claimPeer / releasePeer", () => {
  it("stores a claim, persists it, and routes the subdomain to it", () => {
    const result = claimPeer("studio", "http://192.168.1.20:3001", "box-b");
    expect(result).toEqual({ ok: true, replaced: null });
    expect(getPeerTarget("studio")?.origin).toBe("http://192.168.1.20:3001");

    const saved = JSON.parse(files.get(PEERS_PATH) ?? "{}") as Record<string, unknown>;
    expect(saved.studio).toMatchObject({
      target: "http://192.168.1.20:3001",
      owner: "box-b",
    });
  });

  it("last claim wins and reports what it replaced", () => {
    claimPeer("studio", "http://192.168.1.20:3001", "box-b");
    const result = claimPeer("studio", "http://192.168.1.30:3001", "box-c");
    expect(result.ok).toBe(true);
    expect(result.ok && result.replaced?.owner).toBe("box-b");
    expect(getPeerTarget("studio")?.hostname).toBe("192.168.1.30");
  });

  it("rejects bad input without touching state", () => {
    expect(claimPeer("bad.sub", "http://h:1", "o")).toMatchObject({ ok: false });
    expect(claimPeer("studio", "http://h:1/path", "o")).toMatchObject({ ok: false });
    expect(claimPeer("studio", "http://h:1", "  ")).toMatchObject({ ok: false });
    expect(listPeers().size).toBe(0);
    expect(files.has(PEERS_PATH)).toBe(false);
  });

  it("release removes the claim and reports whether one existed", () => {
    claimPeer("studio", "http://192.168.1.20:3001", "box-b");
    expect(releasePeer("studio")).toBe(true);
    expect(releasePeer("studio")).toBe(false);
    expect(getPeerTarget("studio")).toBeNull();
  });
});

// ── Persistence ──────────────────────────────────────────────

describe("loadPeers", () => {
  it("reads valid claims and skips malformed entries", () => {
    files.set(
      PEERS_PATH,
      JSON.stringify({
        studio: { target: "http://192.168.1.20:3001", owner: "box-b", since: 1 },
        "bad sub": { target: "http://h:1", owner: "x", since: 1 },
        api: { target: "ftp://h:1", owner: "x", since: 1 },
        docs: "nope",
      }),
    );
    loadPeers();
    expect([...listPeers().keys()]).toEqual(["studio"]);
  });

  it("keeps probe state for claims whose target did not change", async () => {
    claimPeer("studio", "http://192.168.1.20:3001", "box-b");
    reachable.set("http://192.168.1.20:3001", true);
    await probePeers();
    expect(listPeers().get("studio")?.status).toBe("ok");

    loadPeers();
    expect(listPeers().get("studio")?.status).toBe("ok");
  });

  it("tolerates a corrupt file", () => {
    files.set(PEERS_PATH, "{not json");
    loadPeers();
    expect(listPeers().size).toBe(0);
  });
});

// ── Probing ──────────────────────────────────────────────────

describe("probePeers", () => {
  it("marks reachable targets ok and unreachable ones unreachable", async () => {
    claimPeer("up", "http://192.168.1.20:3001", "b");
    claimPeer("down", "http://192.168.1.21:3001", "c");
    reachable.set("http://192.168.1.20:3001", true);

    await probePeers(1_000);

    expect(listPeers().get("up")?.status).toBe("ok");
    expect(listPeers().get("down")).toMatchObject({
      status: "unreachable",
      unreachableSince: 1_000,
    });
  });

  it("drops a claim once it has been unreachable for PEER_STALE_MS", async () => {
    claimPeer("down", "http://192.168.1.21:3001", "c");
    await probePeers(1_000);
    await probePeers(1_000 + PEER_STALE_MS - 1);
    expect(listPeers().has("down")).toBe(true);

    await probePeers(1_000 + PEER_STALE_MS);
    expect(listPeers().has("down")).toBe(false);
    expect(JSON.parse(files.get(PEERS_PATH) ?? "{}")).toEqual({});
  });

  it("clears the outage once the target comes back", async () => {
    claimPeer("flaky", "http://192.168.1.22:3001", "d");
    await probePeers(1_000);
    reachable.set("http://192.168.1.22:3001", true);
    await probePeers(2_000);
    expect(listPeers().get("flaky")).toMatchObject({
      status: "ok",
      unreachableSince: undefined,
    });
  });
});

// ── Token ────────────────────────────────────────────────────

describe("ensurePeerToken", () => {
  it("creates a token once and returns the same one afterwards", () => {
    const first = ensurePeerToken();
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(files.get(PEER_TOKEN_PATH)).toBe(first + "\n");
    expect(ensurePeerToken()).toBe(first);
  });
});
