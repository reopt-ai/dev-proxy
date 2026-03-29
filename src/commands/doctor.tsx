import { useState, useEffect } from "react";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import * as dns from "node:dns";
import * as net from "node:net";
import { Box, Text, render, useApp } from "ink";
import { config, CONFIG_DIR, GLOBAL_CONFIG_PATH } from "../proxy/config.js";
import type { ProjectConfig } from "../proxy/config.js";
import { getEntryPorts, readProjectConfig } from "../cli/config-io.js";
import { Header, Check, Section } from "../cli/output.js";

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
    results.push({
      ok: exists,
      label: exists
        ? `.dev-proxy.json exists: ${project.path}`
        : `.dev-proxy.json missing: ${project.path}`,
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

function checkTlsSection(): CheckResult[] {
  const results: CheckResult[] = [];

  // mkcert installed
  try {
    execFileSync("which", ["mkcert"], { stdio: "pipe" });
    results.push({ ok: true, label: "mkcert is installed" });
  } catch {
    results.push({ ok: false, label: "mkcert is not installed" });
  }

  // cert files
  const certsDir = resolve(CONFIG_DIR, "certs");
  const certFile = resolve(certsDir, "cert.pem");
  const keyFile = resolve(certsDir, "key.pem");
  const certExists = existsSync(certFile);
  const keyExists = existsSync(keyFile);
  results.push({
    ok: certExists && keyExists,
    label:
      certExists && keyExists
        ? `cert files exist in ${certsDir}`
        : `cert files missing in ${certsDir}`,
  });

  return results;
}

function collectSubdomains(projects: ProjectConfig[]): string[] {
  const subs = new Set<string>();
  for (const project of projects) {
    for (const sub of Object.keys(project.routes)) {
      if (sub !== "*") {
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

async function checkDns(subdomains: string[], domain: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const sub of subdomains) {
    const hostname = `${sub}.${domain}`;
    try {
      const { address } = await withTimeout(
        dns.promises.lookup(hostname, { family: 4 }),
        5000,
      );
      results.push({
        ok: address === "127.0.0.1",
        warn: address !== "127.0.0.1",
        label:
          address === "127.0.0.1"
            ? `${hostname} → 127.0.0.1`
            : `${hostname} → ${address} (expected 127.0.0.1)`,
      });
    } catch {
      results.push({ ok: false, label: `${hostname} does not resolve` });
    }
  }

  return results;
}

function checkPort(port: number): Promise<CheckResult> {
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

// ── Worktree checks ──────────────────────────────────────────

function checkWorktreeConfig(projects: ProjectConfig[]): CheckResult[] {
  const results: CheckResult[] = [];

  for (const project of projects) {
    const cfg = readProjectConfig(project.path);
    const worktrees = cfg.worktrees ?? {};
    const wtConfig = cfg.worktreeConfig;
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
        const routeKeys = new Set(Object.keys(cfg.routes ?? {}));
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
      for (const [branch, entry] of entries) {
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

        // Check if worktree ports are reachable
        // (done async below)
        void entry; // used in async check
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

function Doctor() {
  const { exit } = useApp();
  const [asyncChecks, setAsyncChecks] = useState<{
    dns: CheckResult[];
    ports: CheckResult[];
    worktreePorts: CheckResult[];
  } | null>(null);

  const configChecks = checkConfigSection();
  const projectChecks = checkProjectsSection();
  const tlsChecks = checkTlsSection();
  const worktreeChecks = checkWorktreeConfig(config.projects);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const subdomains = collectSubdomains(config.projects);
      const [dnsResults, httpPort, httpsPort, wtPorts] = await Promise.all([
        checkDns(subdomains, config.domain),
        checkPort(config.port),
        checkPort(config.httpsPort),
        checkWorktreePorts(config.projects),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated in cleanup
      if (!cancelled) {
        setAsyncChecks({
          dns: dnsResults,
          ports: [httpPort, httpsPort],
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
    ...worktreeChecks,
    ...(asyncChecks?.dns ?? []),
    ...(asyncChecks?.ports ?? []),
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

      <Section title="Ports">
        {asyncChecks ? (
          asyncChecks.ports.map((c) => (
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

export const __testing = { collectSubdomains, withTimeout, checkWorktreeConfig };
