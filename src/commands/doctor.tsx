import { useState, useEffect } from "react";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import * as dns from "node:dns";
import * as net from "node:net";
import { X509Certificate } from "node:crypto";
import { Box, Text, render, useApp } from "ink";
import { config, CONFIG_DIR, GLOBAL_CONFIG_PATH } from "../proxy/config.js";
import type { ProjectConfig } from "../proxy/config.js";
import {
  getEntryPorts,
  readProjectConfig,
  type WorktreeConfig,
} from "../cli/config-io.js";
import { Header, Check, Section } from "../cli/output.js";
import { getLanAddresses } from "../cli/net.js";
import { fetchPeers, PeerApiError, readPeerClientConfig } from "../cli/peer-client.js";
import { listDevices, loadDevices } from "../proxy/pairing.js";

interface CheckResult {
  ok: boolean;
  warn?: boolean;
  label: string;
}

function checkConfigSection(): CheckResult[] {
  const results: CheckResult[] = [];

  // config.json exists + valid JSON
  let configExists = false;
  if (existsSync(GLOBAL_CONFIG_PATH)) {
    try {
      JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, "utf-8"));
      configExists = true;
      results.push({ ok: true, label: "config.json exists and is valid JSON" });
    } catch {
      results.push({ ok: false, label: "config.json exists but is not valid JSON" });
    }
  } else {
    results.push({ ok: false, label: "config.json not found" });
  }

  // domain is set
  if (configExists && config.domain && config.domain !== "localhost") {
    results.push({ ok: true, label: `domain is set: ${config.domain}` });
  } else {
    results.push({
      ok: false,
      warn: true,
      label: `domain: ${config.domain || "not set"}`,
    });
  }

  // projects count
  results.push({
    ok: config.projects.length > 0,
    warn: config.projects.length === 0,
    label: `${String(config.projects.length)} project(s) registered`,
  });

  return results;
}

function checkProjectsSection(): CheckResult[] {
  const results: CheckResult[] = [];

  for (const project of config.projects) {
    const exists = existsSync(project.configPath);
    const configFile = project.configPath.split("/").pop() ?? project.configPath;
    results.push({
      ok: exists,
      label: exists
        ? `${configFile} exists: ${project.path}`
        : `config missing: ${project.path}`,
    });

    if (exists) {
      const routeCount = Object.keys(project.routes).length;
      const worktreeCount = Object.keys(project.worktrees).length;
      results.push({
        ok: routeCount > 0,
        warn: routeCount === 0,
        label: `  ${String(routeCount)} route(s), ${String(worktreeCount)} worktree(s)`,
      });
    }
  }

  return results;
}

/** Subset of X509Certificate the cert checks depend on (keeps tests fixture-free). */
interface CertInfo {
  issuer: string;
  validTo: string;
  checkHost(name: string): string | undefined;
}

const CERT_EXPIRY_WARN_MS = 14 * 24 * 60 * 60 * 1000;

function describeCert(cert: CertInfo, domain: string, now = Date.now()): CheckResult[] {
  const results: CheckResult[] = [];

  const issuerCn = /CN=([^\n]+)/.exec(cert.issuer)?.[1] ?? cert.issuer;
  if (/mkcert/i.test(cert.issuer)) {
    results.push({
      ok: true,
      label:
        "issued by mkcert — trusted on this machine only; install its root CA on other devices",
    });
  } else {
    results.push({ ok: true, label: `issued by ${issuerCn}` });
  }

  const probe = `doctor-probe.${domain}`;
  const covers =
    cert.checkHost(probe) !== undefined && cert.checkHost(domain) !== undefined;
  results.push({
    ok: covers,
    label: covers
      ? `covers *.${domain} and ${domain}`
      : `does not cover *.${domain} and ${domain}`,
  });

  const expiresAt = Date.parse(cert.validTo);
  const remaining = expiresAt - now;
  const expiry = new Date(expiresAt).toISOString().slice(0, 10);
  if (remaining <= 0) {
    results.push({ ok: false, label: `expired on ${expiry}` });
  } else if (remaining < CERT_EXPIRY_WARN_MS) {
    results.push({ ok: false, warn: true, label: `expires on ${expiry} — renew soon` });
  } else {
    results.push({ ok: true, label: `valid until ${expiry}` });
  }

  return results;
}

type CertKind = "public" | "mkcert" | "none";

/** What kind of certificate the proxy serves — decides how peers can reach it. */
function certKind(): CertKind {
  const explicit = Boolean(config.certPath && config.keyPath);
  const certFile =
    config.certPath ?? resolve(CONFIG_DIR, "certs", `${config.domain}+1.pem`);
  if (!existsSync(certFile)) return "none";
  if (!explicit) return "mkcert";
  try {
    const cert = new X509Certificate(readFileSync(certFile));
    return /mkcert/i.test(cert.issuer) ? "mkcert" : "public";
  } catch {
    return "none";
  }
}

function checkTlsSection(): CheckResult[] {
  const results: CheckResult[] = [];

  // mkcert installed — only required when no explicit cert is configured
  const explicit = Boolean(config.certPath && config.keyPath);
  try {
    execFileSync("which", ["mkcert"], { stdio: "pipe" });
    results.push({ ok: true, label: "mkcert is installed" });
  } catch {
    results.push({ ok: !explicit, warn: explicit, label: "mkcert is not installed" });
  }

  // cert files — explicit config wins, otherwise the mkcert default location
  const certsDir = resolve(CONFIG_DIR, "certs");
  const certFile = config.certPath ?? resolve(certsDir, `${config.domain}+1.pem`);
  const keyFile = config.keyPath ?? resolve(certsDir, `${config.domain}+1-key.pem`);
  const certExists = existsSync(certFile);
  const keyExists = existsSync(keyFile);
  results.push({
    ok: certExists && keyExists,
    warn: !explicit,
    label:
      certExists && keyExists
        ? `cert: ${certFile}`
        : explicit
          ? `configured cert/key missing: ${certFile}`
          : `cert files missing in ${certsDir} (generated on first run)`,
  });

  if (certExists) {
    try {
      results.push(
        ...describeCert(new X509Certificate(readFileSync(certFile)), config.domain),
      );
    } catch {
      results.push({
        ok: false,
        label: `cert is not a valid PEM certificate: ${certFile}`,
      });
    }
  }

  return results;
}

// ── Network ──────────────────────────────────────────────────

type AddressKind = "loopback" | "lan" | "other";

function classifyAddress(address: string, lanAddresses: string[]): AddressKind {
  if (address.startsWith("127.")) return "loopback";
  if (lanAddresses.includes(address)) return "lan";
  return "other";
}

function checkNetworkSection(lanAddresses: string[]): CheckResult[] {
  if (lanAddresses.length === 0) {
    return [
      {
        ok: false,
        warn: true,
        label: "no LAN address — other devices cannot reach this machine",
      },
    ];
  }
  return lanAddresses.map((addr) => ({
    ok: true,
    label:
      config.port === null
        ? `reachable at https://${addr}:${String(config.httpsPort)}`
        : `reachable at ${addr}:${String(config.port)} (https :${String(config.httpsPort)})`,
  }));
}

function collectSubdomains(projects: ProjectConfig[]): string[] {
  const subs = new Set<string>();
  for (const project of projects) {
    for (const sub of Object.keys(project.routes)) {
      // Skip sentinel keys: "*" matches any subdomain, "@" matches the bare
      // domain itself. Neither produces a real `<sub>.<domain>` host to look up.
      if (sub !== "*" && sub !== "@") {
        subs.add(sub);
      }
    }
  }
  return [...subs];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("timeout"));
      }, ms);
    }),
  ]);
}

function describeDnsResult(
  hostname: string,
  address: string,
  lanAddresses: string[],
): CheckResult {
  switch (classifyAddress(address, lanAddresses)) {
    case "loopback":
      return { ok: true, label: `${hostname} → ${address} (this machine only)` };
    case "lan":
      return {
        ok: true,
        label: `${hostname} → ${address} (reachable from your network)`,
      };
    case "other":
      return {
        ok: false,
        warn: true,
        label: `${hostname} → ${address} (expected 127.0.0.1 or this machine's LAN address)`,
      };
  }
}

async function checkDns(
  subdomains: string[],
  domain: string,
  lanAddresses: string[],
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const sub of subdomains) {
    const hostname = `${sub}.${domain}`;
    try {
      const { address } = await withTimeout(
        dns.promises.lookup(hostname, { family: 4 }),
        5000,
      );
      results.push(describeDnsResult(hostname, address, lanAddresses));
    } catch {
      results.push({ ok: false, label: `${hostname} does not resolve` });
    }
  }

  return results;
}

function checkPort(port: number | null): Promise<CheckResult> {
  if (port === null) return Promise.resolve({ ok: true, label: "http listener is off" });
  return new Promise((res) => {
    const server = net.createServer();
    server.once("error", () => {
      res({ ok: false, label: `:${String(port)} is in use` });
    });
    server.listen(port, () => {
      server.close(() => {
        res({ ok: true, label: `:${String(port)} is available` });
      });
    });
  });
}

// ── Peers ────────────────────────────────────────────────────

interface PeerReadiness {
  domain: string;
  httpPort: number | null;
  httpsPort: number;
  cert: CertKind;
  /** Where `root.<domain>` resolves to, or null when it does not. */
  rootAddress: string | null;
  lanAddresses: string[];
  pairedDevices: number;
}

/** Can another machine run `peer join <domain>` against this one? */
function describePeerReadiness(r: PeerReadiness): CheckResult[] {
  const results: CheckResult[] = [];
  const rootHost = `root.${r.domain}`;

  if (r.rootAddress === null) {
    results.push({
      ok: false,
      warn: true,
      label: `${rootHost} does not resolve — peers must use \`peer join <this machine's IP>\``,
    });
  } else if (classifyAddress(r.rootAddress, r.lanAddresses) === "lan") {
    results.push({
      ok: true,
      label: `${rootHost} → ${r.rootAddress} (peers can find this machine by name)`,
    });
  } else {
    results.push({
      ok: false,
      warn: true,
      label: `${rootHost} → ${r.rootAddress} (not this machine's LAN address — peers must use \`peer join <ip>\`)`,
    });
  }

  const httpFallback =
    r.httpPort === null ? null : `plain HTTP on :${String(r.httpPort)}`;
  if (r.cert === "public" && r.httpsPort === 443) {
    results.push({ ok: true, label: `peers can join over https://${rootHost}` });
  } else if (r.cert === "public") {
    results.push({
      ok: false,
      warn: true,
      label: `httpsPort is ${String(r.httpsPort)} — \`peer join\` ${httpFallback ? `falls back to ${httpFallback}` : "has nothing to fall back to"}; set httpsPort 443`,
    });
  } else if (httpFallback) {
    results.push({
      ok: false,
      warn: true,
      label: `${r.cert === "mkcert" ? "mkcert certificate is not trusted on other machines" : "no certificate"} — peers join over ${httpFallback}`,
    });
  } else {
    results.push({
      ok: false,
      label: `${r.cert === "mkcert" ? "mkcert certificate is not trusted on other machines" : "no certificate"} and the HTTP listener is off — peers cannot join`,
    });
  }

  results.push({
    ok: true,
    label: `${String(r.pairedDevices)} paired machine(s)`,
  });
  return results;
}

async function lookupRoot(domain: string): Promise<string | null> {
  try {
    const { address } = await withTimeout(
      dns.promises.lookup(`root.${domain}`, { family: 4 }),
      5000,
    );
    return address;
  } catch {
    return null;
  }
}

/** This machine joined a root: does the root still accept it? */
async function checkJoinedRoot(): Promise<CheckResult | null> {
  const joined = readPeerClientConfig();
  if (!joined) return null;
  try {
    const { peers } = await fetchPeers(joined);
    return {
      ok: true,
      label: `joined ${joined.root} (${String(Object.keys(peers).length)} claim(s) on the root)`,
    };
  } catch (err) {
    if (err instanceof PeerApiError && err.status === 401) {
      return {
        ok: false,
        label: `${joined.root} no longer accepts this machine — run \`peer join\` again`,
      };
    }
    return { ok: false, label: (err as Error).message };
  }
}

async function checkPeersSection(): Promise<CheckResult[]> {
  loadDevices();
  const [rootAddress, joined] = await Promise.all([
    lookupRoot(config.domain),
    checkJoinedRoot(),
  ]);
  const results = describePeerReadiness({
    domain: config.domain,
    httpPort: config.port,
    httpsPort: config.httpsPort,
    cert: certKind(),
    rootAddress,
    lanAddresses,
    pairedDevices: listDevices().size,
  });
  if (joined) results.push(joined);
  return results;
}

// ── Worktree checks ──────────────────────────────────────────

function checkWorktreeConfig(projects: ProjectConfig[]): CheckResult[] {
  const results: CheckResult[] = [];

  for (const project of projects) {
    const cfg = readProjectConfig(project.path);
    const worktrees = cfg.worktrees ?? {};
    // worktreeConfig and routes come from the resolved singleton, which merges
    // dev-proxy.config.mjs (the standard format). readProjectConfig reads JSON
    // only, so cfg.worktreeConfig is always undefined for mjs-based projects.
    const wtConfig = project.worktreeConfig as WorktreeConfig | undefined;
    const routes = project.routes;
    const entries = Object.entries(worktrees);

    if (entries.length === 0) continue;

    // Port conflict check — across all worktrees in this project
    const portMap = new Map<number, string[]>();
    for (const [branch, entry] of entries) {
      for (const p of getEntryPorts(entry)) {
        const existing = portMap.get(p) ?? [];
        existing.push(branch);
        portMap.set(p, existing);
      }
    }
    for (const [port, branches] of portMap) {
      if (branches.length > 1) {
        results.push({
          ok: false,
          label: `port ${port} used by multiple worktrees: ${branches.join(", ")}`,
        });
      }
    }
    if ([...portMap.values()].every((b) => b.length === 1)) {
      results.push({ ok: true, label: `no port conflicts in ${project.path}` });
    }

    // worktreeConfig validation
    if (wtConfig) {
      const [min, max] = wtConfig.portRange;
      if (min >= max) {
        results.push({
          ok: false,
          label: `invalid portRange [${min}, ${max}] — min must be less than max`,
        });
      } else {
        results.push({ ok: true, label: `portRange [${min}, ${max}] is valid` });
      }

      // services vs routes cross-check
      if (wtConfig.services) {
        const routeKeys = new Set(Object.keys(routes));
        for (const svc of Object.keys(wtConfig.services)) {
          if (!routeKeys.has(svc) && svc !== "*") {
            results.push({
              ok: false,
              warn: true,
              label: `service "${svc}" not found in routes`,
            });
          }
        }
      }
    }

    // Per-worktree directory + env file checks
    if (wtConfig) {
      for (const [branch] of entries) {
        const dirPattern = wtConfig.directory.replace("{branch}", branch);
        const worktreeDir = resolve(project.path, dirPattern);

        // Directory exists
        if (existsSync(worktreeDir)) {
          results.push({ ok: true, label: `${branch}: directory exists` });

          // .env.local exists (if services defined)
          if (wtConfig.services) {
            const envFile = wtConfig.envFile ?? ".env.local";
            const envPath = resolve(worktreeDir, envFile);
            if (existsSync(envPath)) {
              results.push({ ok: true, label: `${branch}: ${envFile} exists` });
            } else {
              results.push({
                ok: false,
                warn: true,
                label: `${branch}: ${envFile} missing — run 'dev-proxy worktree create' to regenerate`,
              });
            }
          }
        } else {
          // Skip "main" — it's the project root, not a worktree directory
          if (branch !== "main") {
            results.push({
              ok: false,
              warn: true,
              label: `${branch}: directory not found at ${worktreeDir}`,
            });
          }
        }
      }
    }
  }

  return results;
}

function checkWorktreePort(
  port: number,
  branch: string,
  service?: string,
): Promise<CheckResult> {
  const label = service ? `${branch}/${service} :${port}` : `${branch} :${port}`;
  return new Promise((res) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      socket.destroy();
      res({ ok: true, label: `${label} is responding` });
    });
    socket.on("error", () => {
      socket.destroy();
      res({ ok: false, warn: true, label: `${label} is not responding` });
    });
    socket.setTimeout(2000, () => {
      socket.destroy();
      res({ ok: false, warn: true, label: `${label} timed out` });
    });
  });
}

async function checkWorktreePorts(projects: ProjectConfig[]): Promise<CheckResult[]> {
  const checks: Promise<CheckResult>[] = [];

  for (const project of projects) {
    const cfg = readProjectConfig(project.path);
    const worktrees = cfg.worktrees ?? {};

    for (const [branch, entry] of Object.entries(worktrees)) {
      if ("ports" in entry) {
        for (const [svc, port] of Object.entries(entry.ports)) {
          checks.push(checkWorktreePort(port, branch, svc));
        }
      } else {
        checks.push(checkWorktreePort(entry.port, branch));
      }
    }
  }

  if (checks.length === 0) return [];
  return Promise.all(checks);
}

// Interfaces do not change while doctor runs; resolve once so the render
// and the async DNS check see the same addresses.
const lanAddresses = getLanAddresses();

function Doctor() {
  const { exit } = useApp();
  const [asyncChecks, setAsyncChecks] = useState<{
    dns: CheckResult[];
    ports: CheckResult[];
    peers: CheckResult[];
    worktreePorts: CheckResult[];
  } | null>(null);

  const configChecks = checkConfigSection();
  const projectChecks = checkProjectsSection();
  const tlsChecks = checkTlsSection();
  const networkChecks = checkNetworkSection(lanAddresses);
  const worktreeChecks = checkWorktreeConfig(config.projects);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const subdomains = collectSubdomains(config.projects);
      const [dnsResults, httpPort, httpsPort, peers, wtPorts] = await Promise.all([
        checkDns(subdomains, config.domain, lanAddresses),
        checkPort(config.port),
        checkPort(config.httpsPort),
        checkPeersSection(),
        checkWorktreePorts(config.projects),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated in cleanup
      if (!cancelled) {
        setAsyncChecks({
          dns: dnsResults,
          ports: [httpPort, httpsPort],
          peers,
          worktreePorts: wtPorts,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (asyncChecks) {
      setTimeout(exit, 0);
    }
  }, [asyncChecks, exit]);

  const allChecks = [
    ...configChecks,
    ...projectChecks,
    ...tlsChecks,
    ...networkChecks,
    ...worktreeChecks,
    ...(asyncChecks?.dns ?? []),
    ...(asyncChecks?.ports ?? []),
    ...(asyncChecks?.peers ?? []),
    ...(asyncChecks?.worktreePorts ?? []),
  ];

  const passed = allChecks.filter((c) => c.ok).length;
  const warnings = allChecks.filter((c) => !c.ok && c.warn).length;
  const failed = allChecks.filter((c) => !c.ok && !c.warn).length;

  return (
    <Box flexDirection="column">
      <Header text="dev-proxy doctor" />

      <Section title="Config">
        {configChecks.map((c) => (
          <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
        ))}
      </Section>

      <Section title="Projects">
        {projectChecks.length > 0 ? (
          projectChecks.map((c) => (
            <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
          ))
        ) : (
          <Check ok={false} warn label="no projects registered" />
        )}
      </Section>

      <Section title="DNS">
        {asyncChecks ? (
          asyncChecks.dns.length > 0 ? (
            asyncChecks.dns.map((c) => (
              <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
            ))
          ) : (
            <Check ok={true} label="no subdomains to check" />
          )
        ) : (
          <Text dimColor>{"    checking..."}</Text>
        )}
      </Section>

      <Section title="TLS">
        {tlsChecks.map((c) => (
          <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
        ))}
      </Section>

      <Section title="Network">
        {networkChecks.map((c) => (
          <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
        ))}
      </Section>

      <Section title="Ports">
        {asyncChecks ? (
          asyncChecks.ports.map((c) => (
            <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
          ))
        ) : (
          <Text dimColor>{"    checking..."}</Text>
        )}
      </Section>

      <Section title="Peers">
        {asyncChecks ? (
          asyncChecks.peers.map((c) => (
            <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
          ))
        ) : (
          <Text dimColor>{"    checking..."}</Text>
        )}
      </Section>

      {(worktreeChecks.length > 0 || (asyncChecks?.worktreePorts.length ?? 0) > 0) && (
        <Section title="Worktrees">
          {worktreeChecks.map((c) => (
            <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
          ))}
          {asyncChecks
            ? asyncChecks.worktreePorts.map((c) => (
                <Check key={c.label} ok={c.ok} warn={c.warn} label={c.label} />
              ))
            : worktreeChecks.length > 0 && (
                <Text dimColor>{"    checking ports..."}</Text>
              )}
        </Section>
      )}

      {asyncChecks && (
        <Box marginTop={1}>
          <Text>
            {"  "}
            {String(allChecks.length)} checks:{" "}
            <Text color="green">{String(passed)} passed</Text>
            {warnings > 0 && (
              <Text>
                , <Text color="yellow">{String(warnings)} warnings</Text>
              </Text>
            )}
            {failed > 0 && (
              <Text>
                , <Text color="red">{String(failed)} failed</Text>
              </Text>
            )}
          </Text>
        </Box>
      )}
    </Box>
  );
}

render(<Doctor />);

export const __testing = {
  collectSubdomains,
  withTimeout,
  checkWorktreeConfig,
  classifyAddress,
  describeDnsResult,
  describeCert,
  describePeerReadiness,
  checkJoinedRoot,
};
