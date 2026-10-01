import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const claimPeer = vi.fn();
const releasePeer = vi.fn();
const peers = new Map<string, unknown>();
vi.mock("./peers.js", () => ({
  claimPeer: (...args: unknown[]) => claimPeer(...args) as unknown,
  releasePeer: (...args: unknown[]) => releasePeer(...args) as unknown,
  listPeers: () => peers,
  probePeers: () => Promise.resolve(),
}));
vi.mock("./config.js", () => ({ config: { domain: "test.dev" } }));

const { createControlHandler, isPrivateAddress, isControlPath } =
  await import("./control.js");

const TOKEN = "secret-token";
let server: http.Server;
let base: string;

beforeAll(async () => {
  const handle = createControlHandler(TOKEN);
  server = http.createServer((req, res) => {
    if (handle(req, res)) return;
    res.writeHead(200).end("proxied");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  claimPeer.mockReset();
  releasePeer.mockReset();
  peers.clear();
});

async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return {
    status: res.status,
    json: (await res.json().catch(() => null)) as Record<string, unknown> | null,
    text: "",
  };
}

describe("isPrivateAddress", () => {
  it("accepts loopback, RFC 1918, link-local and IPv4-mapped forms", () => {
    for (const ip of [
      "127.0.0.1",
      "::1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.66",
      "169.254.1.1",
      "::ffff:192.168.1.2",
      "fd12::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("rejects public addresses and garbage", () => {
    for (const ip of [
      "8.8.8.8",
      "172.32.0.1",
      "203.0.113.7",
      "2001:db8::1",
      "",
      undefined,
    ]) {
      expect(isPrivateAddress(ip), String(ip)).toBe(false);
    }
  });
});

describe("isControlPath", () => {
  it("matches only the control prefix", () => {
    expect(isControlPath("/_dev-proxy/peers")).toBe(true);
    expect(isControlPath("/_dev-proxy/")).toBe(true);
    expect(isControlPath("/_dev-proxyx")).toBe(false);
    expect(isControlPath("/api/_dev-proxy/peers")).toBe(false);
    expect(isControlPath(undefined)).toBe(false);
  });
});

describe("control API", () => {
  it("leaves non-control requests to the proxy", async () => {
    const res = await fetch(`${base}/anything`);
    expect(await res.text()).toBe("proxied");
  });

  it("requires the bearer token", async () => {
    expect((await call("GET", "/_dev-proxy/peers")).status).toBe(401);
    expect((await call("GET", "/_dev-proxy/peers", { token: "wrong" })).status).toBe(401);
    expect(claimPeer).not.toHaveBeenCalled();
  });

  it("lists claims", async () => {
    peers.set("studio", {
      target: "http://192.168.1.20:3001",
      owner: "b",
      since: 1,
      status: "ok",
    });
    const res = await call("GET", "/_dev-proxy/peers", { token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      domain: "test.dev",
      peers: {
        studio: {
          target: "http://192.168.1.20:3001",
          owner: "b",
          since: 1,
          status: "ok",
        },
      },
    });
  });

  it("claims a subdomain from a JSON body", async () => {
    claimPeer.mockReturnValue({ ok: true, replaced: null });
    const res = await call("PUT", "/_dev-proxy/peers/studio", {
      token: TOKEN,
      body: { target: "http://192.168.1.20:3001", owner: "b" },
    });
    expect(res.status).toBe(200);
    expect(claimPeer).toHaveBeenCalledWith("studio", "http://192.168.1.20:3001", "b");
  });

  it("returns 400 when the registry rejects the claim or the body is not JSON", async () => {
    claimPeer.mockReturnValue({ ok: false, error: "invalid target" });
    const bad = await call("PUT", "/_dev-proxy/peers/studio", {
      token: TOKEN,
      body: { target: "x", owner: "b" },
    });
    expect(bad.status).toBe(400);
    expect(bad.json?.error).toBe("invalid target");

    const res = await fetch(`${base}/_dev-proxy/peers/studio`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("coerces non-string body fields to empty strings instead of stringifying objects", async () => {
    claimPeer.mockReturnValue({ ok: false, error: "owner is required" });
    await call("PUT", "/_dev-proxy/peers/studio", {
      token: TOKEN,
      body: { target: { a: 1 }, owner: 5 },
    });
    expect(claimPeer).toHaveBeenCalledWith("studio", "", "");
  });

  it("releases a claim and reports 404 when there was none", async () => {
    releasePeer.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(
      (await call("DELETE", "/_dev-proxy/peers/studio", { token: TOKEN })).status,
    ).toBe(200);
    expect(
      (await call("DELETE", "/_dev-proxy/peers/studio", { token: TOKEN })).status,
    ).toBe(404);
  });

  it("rejects unknown resources and methods", async () => {
    expect((await call("GET", "/_dev-proxy/other", { token: TOKEN })).status).toBe(404);
    expect(
      (await call("GET", "/_dev-proxy/peers/studio/extra", { token: TOKEN })).status,
    ).toBe(404);
    expect(
      (await call("POST", "/_dev-proxy/peers/studio", { token: TOKEN })).status,
    ).toBe(405);
  });
});
