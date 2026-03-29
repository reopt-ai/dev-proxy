import { execSync } from "node:child_process";
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
} from "../cli/config-io.js";
import {
  Header,
  Row,
  SuccessMessage,
  ErrorMessage,
  ExitOnRender,
} from "../cli/output.js";

function findOwningProject(cwd: string): string | null {
  const cfg = readGlobalConfig();
  const projects = cfg.projects ?? [];
  for (const p of projects) {
    if (cwd === p || cwd.startsWith(p + "/")) {
      return p;
    }
  }
  return null;
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
  cfg.worktrees = cfg.worktrees ?? {};
  cfg.worktrees[name] = { port };
  writeProjectConfig(projectPath, cfg);

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
  cfg.worktrees = remaining;
  writeProjectConfig(projectPath, cfg);

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
  const wtConfig = cfg.worktreeConfig;

  if (!wtConfig) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message="worktreeConfig not configured in .dev-proxy.json"
          hint='Add "worktreeConfig": { "portRange": [4001, 5000], "directory": "../project-{branch}" }'
        />
      </Box>
    );
  }

  const worktrees = cfg.worktrees ?? {};

  if (branch in worktrees) {
    const existing = worktrees[branch]!;
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
      portsMap[serviceNames[i]!] = allocated[i]!;
    }
    worktreeEntry = { ports: portsMap };
  } else {
    worktreeEntry = { port: allocated[0]! };
  }

  // Resolve directory
  const dirPattern = wtConfig.directory.replace("{branch}", branch);
  const worktreeDir = resolve(projectPath, dirPattern);

  const messages: string[] = [];
  const warnings: string[] = [];

  // git worktree add
  try {
    execSync(`git worktree add ${JSON.stringify(worktreeDir)} ${branch}`, {
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

  // Update config
  cfg.worktrees = { ...worktrees, [branch]: worktreeEntry };
  try {
    writeProjectConfig(projectPath, cfg);
  } catch (err) {
    warnings.push(`Failed to update config: ${(err as Error).message}`);
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

  const wtConfig = cfg.worktreeConfig;
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

  // git worktree remove
  try {
    execSync(`git worktree remove ${JSON.stringify(worktreeDir)} --force`, {
      cwd: projectPath,
      stdio: "pipe",
    });
    messages.push(`Removed git worktree at ${worktreeDir}`);
  } catch {
    warnings.push(`git worktree remove failed (config entry still removed)`);
  }

  // Update config
  const removed = worktrees[branch]!;
  const { [branch]: _, ...remaining } = worktrees;
  cfg.worktrees = remaining;
  try {
    writeProjectConfig(projectPath, cfg);
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

export const __testing = { findOwningProject, formatPorts };
