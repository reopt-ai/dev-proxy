import { spawn } from "node:child_process";
import { config } from "../proxy/config.js";
import { isValidPeerSubdomain, type PeerEntry } from "../proxy/peers.js";
import { getLanAddresses } from "../cli/net.js";
import {
  claim,
  defaultOwner,
  fetchPeers,
  normalizeRoot,
  PEER_CLIENT_PATH,
  PeerApiError,
  release,
  resolvePeerClient,
  writePeerClientConfig,
  type PeerClientConfig,
} from "../cli/peer-client.js";

/**
 * `dev-proxy peer` — claim subdomains on the root proxy from another machine.
 *
 * Plain console output rather than Ink: `peer run` hands the terminal to the
 * wrapped dev server for as long as it lives, so this command must not own
 * the screen.
 */

/** stdout line writer — console.log is lint-banned (the TUI owns stdout elsewhere). */
function out(line = ""): void {
  process.stdout.write(line + "\n");
}

const OK = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const CYAN = (s: string) => `\x1b[36m${s}\x1b[0m`;

function fail(message: string, hint?: string): never {
  console.error(`\n  ${FAIL} ${message}`);
  if (hint) console.error(`    ${DIM(hint)}`);
  console.error("");
  process.exit(1);
}

// ── Arg parsing ──────────────────────────────────────────────

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true>;
  /** Everything after `--` (the command for `peer run`). */
  rest: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, rest };
}

function flagString(flags: ParsedArgs["flags"], name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

// ── Shared helpers ───────────────────────────────────────────

function requireClient(): PeerClientConfig {
  const cfg = resolvePeerClient(config.port);
  if (!cfg) {
    fail(
      "not joined to a root proxy",
      "run `dev-proxy peer join <root-host> --token <token>` first (token: ~/.dev-proxy/peer-token on the root)",
    );
  }
  return cfg;
}

function requireSubdomain(value: string | undefined): string {
  if (!value)
    fail("subdomain is required", "e.g. dev-proxy peer claim studio --port 3001");
  if (!isValidPeerSubdomain(value)) fail(`invalid subdomain "${value}"`);
  return value;
}

function buildTarget(flags: ParsedArgs["flags"]): string {
  const portRaw = flagString(flags, "port");
  const port = Number(portRaw);
  if (!portRaw || !Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(
      "--port <n> is required",
      "the local port the app listens on (bind it to 0.0.0.0)",
    );
  }
  const host = flagString(flags, "host") ?? getLanAddresses()[0];
  if (!host) {
    fail("no LAN address found", "pass --host <ip> explicitly");
  }
  return `http://${host}:${String(port)}`;
}

function describe(sub: string, entry: PeerEntry): string {
  const status =
    entry.status === "ok"
      ? "\x1b[32mok\x1b[0m"
      : entry.status === "unreachable"
        ? "\x1b[33munreachable\x1b[0m"
        : DIM("unknown");
  return `  ${CYAN(sub.padEnd(14))} ${entry.target.padEnd(28)} ${entry.owner.padEnd(16)} ${status}`;
}

function apiMessage(err: unknown): string {
  return err instanceof PeerApiError ? err.message : (err as Error).message;
}

// ── Subcommands ──────────────────────────────────────────────

function join(args: ParsedArgs): void {
  const hostArg = args.positional[0];
  const token = flagString(args.flags, "token");
  if (!hostArg)
    fail("root host is required", "e.g. dev-proxy peer join 192.168.1.10 --token …");
  if (!token)
    fail(
      "--token is required",
      "copy it from ~/.dev-proxy/peer-token on the root machine",
    );
  const root = normalizeRoot(hostArg, config.port);
  if (!root) fail(`invalid root "${hostArg}"`);
  writePeerClientConfig({ root, token });
  out(`\n  ${OK} joined root proxy at ${CYAN(root)}`);
  out(`    ${DIM(`saved to ${PEER_CLIENT_PATH}`)}\n`);
}

async function list(): Promise<void> {
  const cfg = requireClient();
  const { domain, peers } = await fetchPeers(cfg).catch((err: unknown) =>
    fail(apiMessage(err)),
  );
  const entries = Object.entries(peers);
  out(`\n  ${DIM(`root: ${cfg.root} · *.${domain}`)}`);
  if (entries.length === 0) {
    out("  no peer claims\n");
    return;
  }
  out(
    `  ${DIM("subdomain".padEnd(14))} ${DIM("target".padEnd(28))} ${DIM("owner".padEnd(16))} ${DIM("status")}`,
  );
  for (const [sub, entry] of entries) out(describe(sub, entry));
  out("");
}

async function doClaim(
  cfg: PeerClientConfig,
  sub: string,
  target: string,
  owner: string,
): Promise<void> {
  const { domain, replaced } = await claim(cfg, sub, target, owner).catch(
    (err: unknown) => fail(apiMessage(err)),
  );
  out(`\n  ${OK} ${CYAN(`${sub}.${domain}`)} → ${target} ${DIM(`(${owner})`)}`);
  if (replaced && replaced.target !== target) {
    out(`    ${DIM(`took over from ${replaced.owner} → ${replaced.target}`)}`);
  }
  out("");
}

async function claimCmd(args: ParsedArgs): Promise<void> {
  const cfg = requireClient();
  const sub = requireSubdomain(args.positional[0]);
  const target = buildTarget(args.flags);
  await doClaim(cfg, sub, target, flagString(args.flags, "owner") ?? defaultOwner());
}

async function releaseCmd(args: ParsedArgs): Promise<void> {
  const cfg = requireClient();
  const sub = requireSubdomain(args.positional[0]);
  await release(cfg, sub).catch((err: unknown) => {
    if (err instanceof PeerApiError && err.status === 404) {
      out(`\n  ${DIM(`no claim for ${sub}`)}\n`);
      return;
    }
    fail(apiMessage(err));
  });
  out(`\n  ${OK} released ${CYAN(sub)}\n`);
}

/** Claim while the wrapped command runs; release when it exits. */
async function run(args: ParsedArgs): Promise<void> {
  const cfg = requireClient();
  const sub = requireSubdomain(args.positional[0]);
  const target = buildTarget(args.flags);
  const owner = flagString(args.flags, "owner") ?? defaultOwner();
  const [cmd, ...cmdArgs] = args.rest;
  if (!cmd)
    fail(
      "command is required after --",
      "e.g. dev-proxy peer run studio --port 3001 -- pnpm dev",
    );

  await doClaim(cfg, sub, target, owner);

  const child = spawn(cmd, cmdArgs, { stdio: "inherit", env: process.env });
  let releasing = false;
  const releaseAndExit = (code: number) => {
    if (releasing) return;
    releasing = true;
    release(cfg, sub)
      .then(() => {
        out(`\n  ${OK} released ${CYAN(sub)}`);
      })
      .catch((err: unknown) => {
        console.error(`\n  ${FAIL} could not release ${sub}: ${apiMessage(err)}`);
        console.error(`    ${DIM("the root drops unreachable claims automatically")}`);
      })
      .finally(() => {
        process.exit(code);
      });
  };

  // Forward termination to the child; release once it has actually exited.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      if (!child.killed) child.kill(sig);
    });
  }
  child.on("exit", (code, signal) => {
    releaseAndExit(code ?? (signal ? 1 : 0));
  });
  child.on("error", (err) => {
    console.error(`\n  ${FAIL} failed to start ${cmd}: ${err.message}`);
    releaseAndExit(1);
  });
}

function usage(): void {
  out(`
  ${DIM("Usage")}
    dev-proxy peer join <root-host[:port]> --token <token>
    dev-proxy peer claim <subdomain> --port <n> [--host <ip>] [--owner <name>]
    dev-proxy peer release <subdomain>
    dev-proxy peer run <subdomain> --port <n> [--host <ip>] -- <command…>
    dev-proxy peer list

  ${DIM("The root proxy routes <subdomain>.<root domain> to this machine while the claim is held.")}
`);
}

// ── Dispatch ─────────────────────────────────────────────────

const argv = process.argv.slice(3);
const sub = argv[0];
const parsed = parseArgs(argv.slice(1));

switch (sub) {
  case "join":
    join(parsed);
    break;
  case "claim":
    await claimCmd(parsed);
    break;
  case "release":
    await releaseCmd(parsed);
    break;
  case "run":
    await run(parsed);
    break;
  case "list":
  case "ls":
    await list();
    break;
  case undefined:
  case "--help":
  case "-h":
    usage();
    break;
  default:
    console.error(`\n  ${FAIL} unknown peer subcommand: ${sub}`);
    usage();
    process.exitCode = 1;
}

export const __testing = { parseArgs };
