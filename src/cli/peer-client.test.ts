import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  mkdirSync: vi.fn(),
}));
vi.mock("node:os", () => ({ hostname: () => "box-b.local" }));
vi.mock("../proxy/config.js", () => ({ CONFIG_DIR: "/mock/.dev-proxy" }));
vi.mock("../proxy/peers.js", () => ({ PEER_TOKEN_PATH: "/mock/.dev-proxy/peer-token" }));

const {
  PEER_CLIENT_PATH,
  PeerApiError,
  claim,
  defaultOwner,
  fetchPairStatus,
  fetchPeers,
  normalizeRoot,
  readPeerClientConfig,
  release,
  requestPair,
  resolvePeerClient,
  rootCandidates,
  writePeerClientConfig,
} = await import("./peer-client.js");

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  files.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("normalizeRoot", () => {
  it("fills in the scheme and default port", () => {
    expect(normalizeRoot("192.168.1.10", 3000)).toBe("http://192.168.1.10:3000");
    expect(normalizeRoot("box.lan:3100", 3000)).toBe("http://box.lan:3100");
  });

  it("leaves https on its own default port", () => {
    expect(normalizeRoot("https://box.lan", 3000)).toBe("https://box.lan");
    expect(normalizeRoot("https://box.lan:3443", 3000)).toBe("https://box.lan:3443");
  });

  it("rejects paths and garbage", () => {
    expect(normalizeRoot("box.lan/proxy", 3000)).toBeNull();
    expect(normalizeRoot("http://box.lan/?x=1", 3000)).toBeNull();
    expect(normalizeRoot("", 3000)).toBeNull();
  });
});

describe("defaultOwner", () => {
  it("strips the mDNS suffix from the hostname", () => {
    expect(defaultOwner()).toBe("box-b");
  });
});

describe("peer client config", () => {
  it("round-trips through peer.json", () => {
    writePeerClientConfig({ root: "http://r:3000", token: "t" });
    expect(JSON.parse(files.get(PEER_CLIENT_PATH) ?? "")).toEqual({
      root: "http://r:3000",
      token: "t",
    });
    expect(readPeerClientConfig()).toEqual({ root: "http://r:3000", token: "t" });
  });

  it("treats a missing or malformed file as not joined", () => {
    expect(readPeerClientConfig()).toBeNull();
    files.set(PEER_CLIENT_PATH, "{bad");
    expect(readPeerClientConfig()).toBeNull();
    files.set(PEER_CLIENT_PATH, JSON.stringify({ root: 1 }));
    expect(readPeerClientConfig()).toBeNull();
  });

  it("resolvePeerClient prefers an explicit join, then the local root token", () => {
    expect(resolvePeerClient(3000)).toBeNull();

    files.set("/mock/.dev-proxy/peer-token", "local-token\n");
    expect(resolvePeerClient(3000)).toEqual({
      root: "http://127.0.0.1:3000",
      token: "local-token",
    });

    writePeerClientConfig({ root: "http://r:3000", token: "t" });
    expect(resolvePeerClient(3000)).toEqual({ root: "http://r:3000", token: "t" });
  });
});

describe("API calls", () => {
  const cfg = { root: "http://r:3000", token: "t" };

  it("fetchPeers sends the bearer token and returns domain + peers", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { domain: "d.test", peers: { a: { target: "http://x:1" } } }),
    );
    const result = await fetchPeers(cfg);
    expect(result).toEqual({ domain: "d.test", peers: { a: { target: "http://x:1" } } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://r:3000/_dev-proxy/peers");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("claim PUTs a JSON body and surfaces the replaced owner", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        domain: "d.test",
        peers: {},
        replaced: { owner: "old", target: "http://y:1" },
      }),
    );
    const result = await claim(cfg, "studio", "http://x:1", "me");
    expect(result.domain).toBe("d.test");
    expect(result.replaced?.owner).toBe("old");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://r:3000/_dev-proxy/peers/studio");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      target: "http://x:1",
      owner: "me",
    });
  });

  it("release DELETEs and resolves to undefined", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { domain: "d.test", peers: {} }));
    await expect(release(cfg, "studio")).resolves.toBeUndefined();
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("turns error responses into PeerApiError with the server message and status", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: "no such claim" }));
    await expect(release(cfg, "studio")).rejects.toMatchObject({
      name: "PeerApiError",
      message: "no such claim",
      status: 404,
    });
  });

  it("falls back to the status code when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(fetchPeers(cfg)).rejects.toThrow("root proxy answered 500");
  });

  it("wraps network failures with the root address", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const err = await fetchPeers(cfg).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PeerApiError);
    expect((err as Error).message).toBe(
      "cannot reach root proxy at http://r:3000: ECONNREFUSED",
    );
  });
});

describe("rootCandidates", () => {
  it("tries root.<domain> over TLS first for a bare hostname", () => {
    expect(rootCandidates("example.dev", 3000)).toEqual([
      "https://root.example.dev",
      "http://root.example.dev:3000",
      "http://example.dev:3000",
    ]);
    expect(rootCandidates("root.example.dev", 3000)).toEqual([
      "https://root.example.dev",
      "http://root.example.dev:3000",
    ]);
  });

  it("uses an IP, an explicit port or a full origin exactly as given", () => {
    expect(rootCandidates("192.168.1.10", 3000)).toEqual(["http://192.168.1.10:3000"]);
    expect(rootCandidates("[fd12::1]", 3000)).toEqual(["http://[fd12::1]:3000"]);
    expect(rootCandidates("box.lan:3100", 3000)).toEqual(["http://box.lan:3100"]);
    expect(rootCandidates("https://root.example.dev", 3000)).toEqual([
      "https://root.example.dev",
    ]);
  });

  it("returns nothing for garbage", () => {
    expect(rootCandidates("box.lan/proxy", 3000)).toEqual([]);
  });
});

describe("pairing calls", () => {
  it("sends only the name and token hash, without credentials", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { id: "req1", code: "ABC-123", domain: "example.dev" }),
    );
    await expect(
      requestPair("https://root.example.dev", "box-b", "hash"),
    ).resolves.toEqual({ id: "req1", code: "ABC-123", domain: "example.dev" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://root.example.dev/_dev-proxy/pair");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "box-b", tokenHash: "hash" }));
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("rejects a 200 that is not a pair response", async () => {
    fetchMock.mockResolvedValue(new Response("<html>hello</html>", { status: 200 }));
    await expect(
      requestPair("https://root.example.dev", "box-b", "hash"),
    ).rejects.toThrow(/did not answer like a dev-proxy root/);
  });

  it("polls status with the token it generated", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: "approved" }));
    await expect(
      fetchPairStatus("https://root.example.dev", "req 1", "tok"),
    ).resolves.toBe("approved");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://root.example.dev/_dev-proxy/pair/req%201");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });
});
