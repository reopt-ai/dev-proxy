import { beforeEach, describe, expect, it, vi } from "vitest";

const requestPair = vi.fn();
const fetchPairStatus = vi.fn();
const fetchPeers = vi.fn();
class PeerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
vi.mock("./peer-client.js", () => ({
  requestPair: (...args: unknown[]) => requestPair(...args) as unknown,
  fetchPairStatus: (...args: unknown[]) => fetchPairStatus(...args) as unknown,
  fetchPeers: (...args: unknown[]) => fetchPeers(...args) as unknown,
  PeerApiError,
}));
vi.mock("../proxy/pairing.js", () => ({
  hashToken: (token: string) => `hash(${token})`,
  PAIR_TTL_MS: 300_000,
}));

const { joinByPairing, joinWithToken } = await import("./peer-join.js");

const CANDIDATES = ["https://root.example.dev", "http://root.example.dev:3000"];
const PAIR = { id: "req1", code: "ABC-123", domain: "example.dev" };

/** Virtual clock: each sleep advances `now` so the deadline can be reached instantly. */
function hooks() {
  let clock = 0;
  return {
    onRequested: vi.fn(),
    sleep: (ms: number) => {
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
  };
}

beforeEach(() => {
  requestPair.mockReset();
  fetchPairStatus.mockReset();
  fetchPeers.mockReset();
});

describe("joinByPairing", () => {
  it("sends only the hash, waits through pending and returns the token once approved", async () => {
    requestPair.mockResolvedValue(PAIR);
    fetchPairStatus
      .mockResolvedValueOnce("pending")
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce("approved");
    const h = hooks();

    const outcome = await joinByPairing(CANDIDATES, "box-b", h);

    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.root).toBe("https://root.example.dev");
    expect(outcome.token).toMatch(/^[0-9a-f]{48}$/);
    expect(requestPair).toHaveBeenCalledWith(
      "https://root.example.dev",
      "box-b",
      `hash(${outcome.token})`,
    );
    expect(h.onRequested).toHaveBeenCalledWith({
      root: "https://root.example.dev",
      code: "ABC-123",
      domain: "example.dev",
    });
    expect(fetchPairStatus).toHaveBeenCalledTimes(3);
    expect(fetchPairStatus).toHaveBeenLastCalledWith(
      "https://root.example.dev",
      "req1",
      outcome.token,
    );
  });

  it("falls back to the next address when the first is unreachable", async () => {
    requestPair
      .mockRejectedValueOnce(new PeerApiError("cannot reach root"))
      .mockResolvedValueOnce(PAIR);
    fetchPairStatus.mockResolvedValue("approved");

    const outcome = await joinByPairing(CANDIDATES, "box-b", hooks());

    expect(outcome).toMatchObject({ ok: true, root: "http://root.example.dev:3000" });
  });

  it("explains that an old root cannot pair", async () => {
    requestPair
      .mockRejectedValueOnce(new PeerApiError("invalid or missing bearer token", 401))
      .mockRejectedValueOnce(new PeerApiError("cannot reach root"));
    const h = hooks();

    const outcome = await joinByPairing(CANDIDATES, "box-b", h);

    expect(outcome).toMatchObject({
      ok: false,
      error: "the root proxy does not support pairing",
    });
    expect(h.onRequested).not.toHaveBeenCalled();
  });

  it("reports the root's own refusal rather than a later connection error", async () => {
    requestPair
      .mockRejectedValueOnce(new PeerApiError("too many pending pair requests", 429))
      .mockRejectedValueOnce(new PeerApiError("cannot reach root"));

    expect(await joinByPairing(CANDIDATES, "box-b", hooks())).toEqual({
      ok: false,
      error: "too many pending pair requests",
    });
  });

  it("stops on a denial or a forgotten request", async () => {
    requestPair.mockResolvedValue(PAIR);
    fetchPairStatus.mockResolvedValueOnce("denied");
    expect(await joinByPairing(CANDIDATES, "box-b", hooks())).toMatchObject({
      ok: false,
      error: "the root denied this request",
    });

    fetchPairStatus.mockResolvedValueOnce("unknown");
    expect(await joinByPairing(CANDIDATES, "box-b", hooks())).toMatchObject({
      ok: false,
      error: "the request expired or the root restarted",
    });
  });

  it("gives up when nobody answers before the request expires", async () => {
    requestPair.mockResolvedValue(PAIR);
    fetchPairStatus.mockResolvedValue("pending");

    const outcome = await joinByPairing(CANDIDATES, "box-b", hooks());

    expect(outcome).toMatchObject({ ok: false, error: "timed out waiting for approval" });
    expect(fetchPairStatus).toHaveBeenCalledTimes(200);
  });
});

describe("joinWithToken", () => {
  it("trusts a single explicit address without contacting it", async () => {
    expect(await joinWithToken(["http://192.168.1.10:3000"], "tok")).toEqual({
      ok: true,
      root: "http://192.168.1.10:3000",
      token: "tok",
    });
    expect(fetchPeers).not.toHaveBeenCalled();
  });

  it("picks the first guessed address that accepts the token", async () => {
    fetchPeers
      .mockRejectedValueOnce(new PeerApiError("cannot reach root"))
      .mockResolvedValueOnce({ domain: "example.dev", peers: {} });

    expect(await joinWithToken(CANDIDATES, "tok")).toEqual({
      ok: true,
      root: "http://root.example.dev:3000",
      token: "tok",
    });
  });

  it("fails with the last error when no address works", async () => {
    fetchPeers.mockRejectedValue(
      new PeerApiError("invalid or missing bearer token", 401),
    );
    expect(await joinWithToken(CANDIDATES, "tok")).toEqual({
      ok: false,
      error: "invalid or missing bearer token",
    });
  });
});
