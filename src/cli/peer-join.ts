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

interface Attempt {
  root: string;
  code?: string;
  status?: number;
  message: string;
}

const TLS_CODE_RE = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|ERR_SSL|EPROTO/;

/**
 * Turn the per-candidate failures into one message a person can act on.
 * Every candidate failing the same way is the signal; a mixed bag just
 * reports the most informative failure.
 */
export function explainJoinFailure(
  attempts: readonly Attempt[],
  input: string,
): { error: string; hint?: string } {
  // A root from before pairing existed asks for a token on every control path.
  const answered = attempts.find((a) => a.status !== undefined);
  if (answered?.status === 401) {
    return {
      error: "the root proxy does not support pairing",
      hint: "upgrade dev-proxy on the root, or pass --token <token>",
    };
  }
  if (answered) return { error: answered.message };

  const last = attempts[attempts.length - 1];
  if (!last) return { error: "no root address to try" };
  const codes = attempts.map((a) => a.code ?? "");
  const all = (pred: (c: string) => boolean) => codes.every(pred);
  const tls = attempts.find(
    (a) => a.root.startsWith("https://") && TLS_CODE_RE.test(a.code ?? ""),
  );

  if (all((c) => c === "ENOTFOUND" || c === "EAI_AGAIN")) {
    return {
      error: `${hostnameOf(last.root)} does not resolve on this machine`,
      hint: `check the spelling of "${input}"; if the root uses public DNS, the router may drop answers that point at private IPs (DNS rebinding protection) — try \`peer join <root's LAN IP>\``,
    };
  }
  if (tls) {
    return {
      error: `${hostOf(tls.root)} presented a certificate this machine does not trust`,
      hint: "mkcert certificates are only trusted where the CA is installed — join with the root's LAN IP (plain HTTP) or give the root a publicly trusted certificate",
    };
  }
  if (all((c) => c === "ECONNREFUSED")) {
    return {
      error: `${hostOf(last.root)} refused the connection`,
      hint: "is dev-proxy running on the root? its httpsPort should be 443 for `peer join <domain>`; otherwise pass host:port",
    };
  }
  if (all((c) => c === "ETIMEDOUT" || c === "EHOSTUNREACH" || c === "ENETUNREACH")) {
    return {
      error: `${hostOf(last.root)} did not answer`,
      hint: "the root must be on the same network (no VPN or guest Wi-Fi in between) and allow inbound connections",
    };
  }
  return { error: last.message };
}

function hostOf(root: string): string {
  try {
    return new URL(root).host;
  } catch {
    return root;
  }
}

function hostnameOf(root: string): string {
  try {
    return new URL(root).hostname;
  } catch {
    return root;
  }
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
  /** What the user typed, for the failure message. */
  input = candidates[0] ?? "",
): Promise<JoinOutcome> {
  const sleep = hooks.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = hooks.now ?? Date.now;
  const token = randomBytes(24).toString("hex");
  const tokenHash = hashToken(token);

  let root = "";
  let pair: Awaited<ReturnType<typeof requestPair>> | null = null;
  const attempts: Attempt[] = [];
  for (const candidate of candidates) {
    try {
      pair = await requestPair(candidate, name, tokenHash);
      root = candidate;
      break;
    } catch (err) {
      attempts.push({
        root: candidate,
        message: message(err),
        ...(err instanceof PeerApiError ? { code: err.code, status: err.status } : {}),
      });
    }
  }
  if (!pair) return { ok: false, ...explainJoinFailure(attempts, input) };

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
