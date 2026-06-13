import { execFileSync, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Box, Text, render } from "ink";
import {
  readGlobalConfig,
  readProjectConfig,
  writeProjectConfig,
  isValidPort,
  isValidSubdomain,
  allocatePorts,
  getEntryPorts,
  generateEnvContent,
  type WorktreeEntry,
  type WorktreeConfig,
} from "../cli/config-io.js";
import {
  Header,
  Row,
  SuccessMessage,
  ErrorMessage,
  ExitOnRender,
} from "../cli/output.js";
import { config } from "../proxy/config.js";

function findOwningProject(cwd: string): string | null {
  const cfg = readGlobalConfig();
  const projects = cfg.projects ?? [];
  const normalizedCwd = resolve(cwd);
  // Normalize both sides (trailing slashes, `..`, symlink-free relative parts)
  // and prefer the longest matching prefix so a nested project wins over its
  // parent when both are registered.
  let best: string | null = null;
  for (const p of projects) {
    const normalized = resolve(p);
    if (normalizedCwd === normalized || normalizedCwd.startsWith(normalized + "/")) {
      if (best === null || normalized.length > resolve(best).length) {
        best = p;
      }
    }
  }
  return best;
}

/**
 * Look up worktreeConfig from the loaded proxy config singleton, which already
 * merges dev-proxy.config.mjs (preferred) with .dev-proxy.json (legacy fallback).
 * CLI invocations are short-lived, so the singleton is always fresh.
 */
function getWorktreeConfig(projectPath: string): WorktreeConfig | undefined {
  const project = config.projects.find((p) => p.path === projectPath);
  return project?.worktreeConfig as WorktreeConfig | undefined;
}

// ── Helpers ──────────────────────────────────────────────────

function formatPorts(entry: WorktreeEntry): string {
  if ("ports" in entry) {
    return Object.entries(entry.ports)
      .map(([svc, p]) => `${svc}:${p}`)
      .join(", ");
  }
  return `port ${entry.port}`;
}

// ── List worktrees ───────────────────────────────────────────

function WorktreeList() {
  const cfg = readGlobalConfig();
  const projects = cfg.projects ?? [];

  const entries: { project: string; name: string; entry: WorktreeEntry }[] = [];
  for (const p of projects) {
    const pc = readProjectConfig(p);
    for (const [name, entry] of Object.entries(pc.worktrees ?? {})) {
      entries.push({ project: p, name, entry });
    }
  }

  if (entries.length === 0) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <Header text="Worktrees" />
        <Text dimColor>{"    (none)"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <Header text="Worktrees" />
      {entries.map((e) => (
        <Row
          key={`${e.project}:${e.name}`}
          label={e.name}
          value={`${formatPorts(e.entry)}  (${e.project})`}
          pad={20}
        />
      ))}
    </Box>
  );
}

// ── Add worktree ─────────────────────────────────────────────

function WorktreeAdd({ name, port }: { name: string; port: number }) {
  const cwd = process.cwd();
  const projectPath = findOwningProject(cwd);

  if (!projectPath) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message="Current directory is not inside a registered project"
          hint="Run 'dev-proxy project add .' to register this project first"
        />
      </Box>
    );
  }

  const cfg = readProjectConfig(projectPath);
  const worktrees = { ...(cfg.worktrees ?? {}), [name]: { port } };
  // Write only the worktrees file — passing the full merged cfg would
  // resurrect a legacy .dev-proxy.json from routes/worktreeConfig read from it.
  writeProjectConfig(projectPath, { worktrees });

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <SuccessMessage message={`Added worktree "${name}" on port ${port}`} />
    </Box>
  );
}

// ── Remove worktree ──────────────────────────────────────────

function WorktreeRemove({ name }: { name: string }) {
  const cwd = process.cwd();
  const projectPath = findOwningProject(cwd);

  if (!projectPath) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message="Current directory is not inside a registered project"
          hint="Run 'dev-proxy project add .' to register this project first"
        />
      </Box>
    );
  }

  const cfg = readProjectConfig(projectPath);
  const worktrees = cfg.worktrees ?? {};

  if (!(name in worktrees)) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message={`Worktree "${name}" not found in project`}
          hint="Run 'dev-proxy worktree list' to see all worktrees"
        />
      </Box>
    );
  }

  const { [name]: _, ...remaining } = worktrees;
  writeProjectConfig(projectPath, { worktrees: remaining });

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <SuccessMessage message={`Removed worktree "${name}"`} />
    </Box>
  );
}

// ── Create worktree (full lifecycle) ─────────────────────────

function WorktreeCreate({ branch }: { branch: string }) {
  const cwd = process.cwd();
  const projectPath = findOwningProject(cwd);

  if (!projectPath) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message="Current directory is not inside a registered project"
          hint="Run 'dev-proxy project add .' to register this project first"
        />
      </Box>
    );
  }

  const cfg = readProjectConfig(projectPath);
  const wtConfig = getWorktreeConfig(projectPath);

  if (!wtConfig) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message="worktreeConfig not configured in dev-proxy.config.mjs"
          hint="Add `worktreeConfig: { portRange: [4001, 5000], directory: '../project-{branch}' }` to the default export"
        />
      </Box>
    );
  }

  const worktrees = cfg.worktrees ?? {};

  if (branch in worktrees) {
    const existing = worktrees[branch] as WorktreeEntry;
    const portInfo =
      "ports" in existing
        ? Object.entries(existing.ports)
            .map(([s, p]) => `${s}:${p}`)
            .join(", ")
        : `port ${existing.port}`;
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage message={`Worktree "${branch}" already exists (${portInfo})`} />
      </Box>
    );
  }

  // Collect used ports across all existing worktrees
  const usedPorts = new Set(Object.values(worktrees).flatMap((w) => getEntryPorts(w)));

  // Allocate ports — multi-service or single
  const services = wtConfig.services;
  const serviceNames = services ? Object.keys(services) : null;
  const portCount = serviceNames ? serviceNames.length : 1;

  const allocated = allocatePorts(portCount, wtConfig.portRange, usedPorts);
  if (allocated === null) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message={`No available ports in range ${wtConfig.portRange[0]}-${wtConfig.portRange[1]}`}
          hint="Destroy unused worktrees or expand portRange"
        />
      </Box>
    );
  }

  // Build the worktree entry
  let worktreeEntry: WorktreeEntry;
  let portsMap: Record<string, number> | null = null;
  if (serviceNames) {
    portsMap = {};
    for (let i = 0; i < serviceNames.length; i++) {
      portsMap[serviceNames[i] as string] = allocated[i] as number;
    }
    worktreeEntry = { ports: portsMap };
  } else {
    worktreeEntry = { port: allocated[0] as number };
  }

  // Resolve directory
  const dirPattern = wtConfig.directory.replace("{branch}", branch);
  const worktreeDir = resolve(projectPath, dirPattern);

  const messages: string[] = [];
  const warnings: string[] = [];

  // git worktree add — execFileSync avoids the shell entirely, so the branch
  // name can never be interpreted as shell syntax regardless of validation.
  try {
    execFileSync("git", ["worktree", "add", worktreeDir, branch], {
      cwd: projectPath,
      stdio: "pipe",
    });
    messages.push(`Created git worktree at ${worktreeDir}`);
  } catch (err) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message={`git worktree add failed: ${(err as Error).message}`}
          hint="Ensure the branch exists or will be created"
        />
      </Box>
    );
  }

  // Re-read worktrees immediately before writing to narrow the TOCTOU window
  // against a concurrent `worktree create`. Detect collisions on either the
  // branch or any allocated port, and rebuild on the freshest state.
  const fresh = readProjectConfig(projectPath).worktrees ?? {};
  const freshUsedPorts = new Set(Object.values(fresh).flatMap((w) => getEntryPorts(w)));
  const collidingPort = getEntryPorts(worktreeEntry).find((p) => freshUsedPorts.has(p));
  if (branch in fresh) {
    warnings.push(`Config entry for "${branch}" already added by another process`);
  } else if (collidingPort !== undefined) {
    warnings.push(
      `Port ${collidingPort} was taken by another process — config not updated`,
    );
  } else {
    try {
      writeProjectConfig(projectPath, {
        worktrees: { ...fresh, [branch]: worktreeEntry },
      });
    } catch (err) {
      warnings.push(`Failed to update config: ${(err as Error).message}`);
    }
  }

  if (portsMap) {
    for (const [svc, p] of Object.entries(portsMap)) {
      messages.push(`Allocated port ${p} for ${svc}`);
    }
  } else {
    messages.push(`Allocated port ${allocated[0]}`);
  }

  // Generate .env file for multi-service worktrees
  if (services && portsMap) {
    const envContent = generateEnvContent(services, portsMap);
    const envFile = wtConfig.envFile ?? ".env.local";
    try {
      writeFileSync(resolve(worktreeDir, envFile), envContent);
      messages.push(`Wrote ${envFile}`);
    } catch (err) {
      warnings.push(`Failed to write ${envFile}: ${(err as Error).message}`);
    }
  }

  // Run post-create hook
  const hook = wtConfig.hooks?.["post-create"];
  if (hook) {
    try {
      execSync(hook, { cwd: worktreeDir, stdio: "inherit" });
      messages.push(`Hook post-create completed`);
    } catch {
      warnings.push(`Hook post-create failed (worktree was still created)`);
    }
  }

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      {messages.map((m, i) => (
        <SuccessMessage key={i} message={m} />
      ))}
      {warnings.map((w, i) => (
        <Text key={i}>
          {"  "}
          <Text color="yellow">{"\u26A0"}</Text>
          <Text>{` ${w}`}</Text>
        </Text>
      ))}
      <Text>{""}</Text>
      <Text
        dimColor
      >{`    Access: {branch}--*.${readGlobalConfig().domain ?? "localhost"}:${readGlobalConfig().port ?? 3000}`}</Text>
    </Box>
  );
}

// ── Destroy worktree (full lifecycle) ────────────────────────

function WorktreeDestroy({ branch }: { branch: string }) {
  const cwd = process.cwd();
  const projectPath = findOwningProject(cwd);

  if (!projectPath) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message="Current directory is not inside a registered project"
          hint="Run 'dev-proxy project add .' to register this project first"
        />
      </Box>
    );
  }

  const cfg = readProjectConfig(projectPath);
  const worktrees = cfg.worktrees ?? {};

  if (!(branch in worktrees)) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message={`Worktree "${branch}" not found`}
          hint="Run 'dev-proxy worktree list' to see all worktrees"
        />
      </Box>
    );
  }

  const wtConfig = getWorktreeConfig(projectPath);
  const messages: string[] = [];
  const warnings: string[] = [];

  // Resolve directory
  const dirPattern = wtConfig
    ? wtConfig.directory.replace("{branch}", branch)
    : `../${branch}`;
  const worktreeDir = resolve(projectPath, dirPattern);

  // Run post-remove hook
  const hook = wtConfig?.hooks?.["post-remove"];
  if (hook) {
    try {
      execSync(hook, { cwd: worktreeDir, stdio: "inherit" });
      messages.push(`Hook post-remove completed`);
    } catch {
      warnings.push(`Hook post-remove failed (continuing with removal)`);
    }
  }

  // git worktree remove — execFileSync avoids the shell (no injection via dir)
  try {
    execFileSync("git", ["worktree", "remove", worktreeDir, "--force"], {
      cwd: projectPath,
      stdio: "pipe",
    });
    messages.push(`Removed git worktree at ${worktreeDir}`);
  } catch {
    warnings.push(`git worktree remove failed (config entry still removed)`);
  }

  // Update config — write only the worktrees file (re-read for freshness)
  const removed = worktrees[branch] as WorktreeEntry;
  const fresh = readProjectConfig(projectPath).worktrees ?? worktrees;
  const { [branch]: _, ...remaining } = fresh;
  try {
    writeProjectConfig(projectPath, { worktrees: remaining });
  } catch (err) {
    warnings.push(`Failed to update config: ${(err as Error).message}`);
  }

  const releasedPorts = getEntryPorts(removed);
  if ("ports" in removed) {
    for (const [svc, p] of Object.entries(removed.ports)) {
      messages.push(`Released port ${p} (${svc})`);
    }
  } else {
    messages.push(`Released port ${releasedPorts[0]}`);
  }

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      {messages.map((m, i) => (
        <SuccessMessage key={i} message={m} />
      ))}
      {warnings.map((w, i) => (
        <Text key={i}>
          {"  "}
          <Text color="yellow">{"\u26A0"}</Text>
          <Text>{` ${w}`}</Text>
        </Text>
      ))}
    </Box>
  );
}

// ── Entry point ──────────────────────────────────────────────

const args = process.argv.slice(3);
const subcommand = args[0];

if (subcommand === "create") {
  const branch = args[1];
  if (!branch) {
    render(<ErrorMessage message="Usage: dev-proxy worktree create <branch>" />);
  } else if (!isValidSubdomain(branch)) {
    render(
      <ErrorMessage
        message={`Invalid branch name "${branch}" for subdomain routing`}
        hint="Use lowercase alphanumeric and hyphens only (e.g. fix-auth-bug)"
      />,
    );
  } else {
    render(<WorktreeCreate branch={branch} />);
  }
} else if (subcommand === "destroy") {
  const branch = args[1];
  if (!branch) {
    render(<ErrorMessage message="Usage: dev-proxy worktree destroy <branch>" />);
  } else if (!isValidSubdomain(branch)) {
    // Validate before any directory resolution / hook execution — an
    // unvalidated branch flows into `{branch}` substitution and the hook cwd.
    render(
      <ErrorMessage
        message={`Invalid branch name "${branch}"`}
        hint="Use lowercase alphanumeric and hyphens only (e.g. fix-auth-bug)"
      />,
    );
  } else {
    render(<WorktreeDestroy branch={branch} />);
  }
} else if (subcommand === "add") {
  const name = args[1];
  const portStr = args[2];
  if (!name || !portStr) {
    render(<ErrorMessage message="Usage: dev-proxy worktree add <name> <port>" />);
  } else {
    const port = Number(portStr);
    if (!isValidSubdomain(name)) {
      render(
        <ErrorMessage
          message={`Invalid worktree name "${name}"`}
          hint="Use lowercase alphanumeric and hyphens only"
        />,
      );
    } else if (!isValidPort(port)) {
      render(
        <ErrorMessage
          message={`Invalid port "${portStr}"`}
          hint="Expected an integer between 1 and 65535"
        />,
      );
    } else {
      render(<WorktreeAdd name={name} port={port} />);
    }
  }
} else if (subcommand === "remove") {
  const name = args[1];
  if (!name) {
    render(<ErrorMessage message="Usage: dev-proxy worktree remove <name>" />);
  } else {
    render(<WorktreeRemove name={name} />);
  }
} else {
  // "list" or no subcommand → default to list
  render(<WorktreeList />);
}

export const __testing = { findOwningProject, formatPorts, getWorktreeConfig };
