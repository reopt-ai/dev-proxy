import { randomBytes } from "node:crypto";
import { hashToken, PAIR_TTL_MS } from "../proxy/pairing.js";
import { fetchPairStatus, fetchPeers, PeerApiError, requestPair } from "./peer-client.js";

/**
 * The two ways `peer join` can end up with a working root + token: pairing
 * (someone approves on the root) or an explicit token. Kept free of console
 * output and process exits so the flow can be tested.
 */

export type JoinOutcome =
  { ok: true; root: string; token: string } | { ok: false; error: string; hint?: string };

export interface PairingHooks {
  /** Called once the root has queued the request and approval is pending. */
  onRequested: (info: { root: string; code: string; domain: string }) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const PAIR_POLL_MS = 1500;

function message(err: unknown): string {
  return (err as Error).message;
}

/** With a token in hand there is nothing to approve — just find the root. */
export async function joinWithToken(
  candidates: string[],
  token: string,
): Promise<JoinOutcome> {
  const [only] = candidates;
  // A single explicit address is trusted as given so joining works while the root is down.
  if (candidates.length === 1 && only) return { ok: true, root: only, token };
  let lastError = "no root address to try";
  for (const root of candidates) {
    try {
      await fetchPeers({ root, token });
      return { ok: true, root, token };
    } catch (err) {
      lastError = message(err);
    }
  }
  return { ok: false, error: lastError };
}

/** Ask the root to pair and wait for someone to approve it there. */
export async function joinByPairing(
  candidates: string[],
  name: string,
  hooks: PairingHooks,
): Promise<JoinOutcome> {
  const sleep = hooks.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = hooks.now ?? Date.now;
  const token = randomBytes(24).toString("hex");
  const tokenHash = hashToken(token);

  let root = "";
  let pair: Awaited<ReturnType<typeof requestPair>> | null = null;
  // An HTTP answer says more than "unreachable", so it is the one worth reporting.
  let answered: PeerApiError | null = null;
  let lastError = "no root address to try";
  for (const candidate of candidates) {
    try {
      pair = await requestPair(candidate, name, tokenHash);
      root = candidate;
      break;
    } catch (err) {
      lastError = message(err);
      if (err instanceof PeerApiError && err.status !== undefined) answered ??= err;
    }
  }
  if (!pair) {
    // A root from before pairing existed asks for a token on every control path.
    if (answered?.status === 401) {
      return {
        ok: false,
        error: "the root proxy does not support pairing",
        hint: "upgrade dev-proxy on the root, or pass --token <token>",
      };
    }
    return { ok: false, error: answered?.message ?? lastError };
  }

  hooks.onRequested({ root, code: pair.code, domain: pair.domain });

  const deadline = now() + PAIR_TTL_MS;
  while (now() < deadline) {
    await sleep(PAIR_POLL_MS);
    // A blip while polling is not an answer; keep waiting until the deadline.
    const status = await fetchPairStatus(root, pair.id, token).catch(
      () => "pending" as const,
    );
    if (status === "approved") return { ok: true, root, token };
    if (status === "denied") return { ok: false, error: "the root denied this request" };
    if (status === "unknown") {
      return {
        ok: false,
        error: "the request expired or the root restarted",
        hint: "run `peer join` again",
      };
    }
  }
  return {
    ok: false,
    error: "timed out waiting for approval",
    hint: "run `peer join` again",
  };
}
