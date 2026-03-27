import { useState } from "react";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { Box, Text, render, useApp } from "ink";
import { Header, Row, SuccessMessage, ErrorMessage } from "../cli/output.js";

const CONFIG_DIR = resolve(homedir(), ".dev-proxy");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");
const PROJECT_CONFIG_NAME = ".dev-proxy.json";

interface RawGlobalConfig {
  domain?: string;
  port?: number;
  httpsPort?: number;
  projects?: string[];
}

interface RawProjectConfig {
  routes?: Record<string, string>;
  worktrees?: Record<string, { port: number }>;
}

function readGlobalConfig(): RawGlobalConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as RawGlobalConfig;
    }
  } catch {
    // corrupt — treat as empty
  }
  return {};
}

function readProjectConfig(projectPath: string): RawProjectConfig {
  const configPath = resolve(projectPath, PROJECT_CONFIG_NAME);
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf-8")) as RawProjectConfig;
    }
  } catch {
    // corrupt
  }
  return { routes: {}, worktrees: {} };
}

function writeProjectConfig(projectPath: string, cfg: RawProjectConfig): void {
  const configPath = resolve(projectPath, PROJECT_CONFIG_NAME);
  writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

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

function ExitOnRender() {
  const { exit } = useApp();
  useState(() => {
    setTimeout(exit, 0);
  });
  return null;
}

// ── List worktrees ───────────────────────────────────────────

function WorktreeList() {
  const cfg = readGlobalConfig();
  const projects = cfg.projects ?? [];

  const entries: { project: string; name: string; port: number }[] = [];
  for (const p of projects) {
    const pc = readProjectConfig(p);
    for (const [name, wt] of Object.entries(pc.worktrees ?? {})) {
      entries.push({ project: p, name, port: wt.port });
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
          value={`port ${e.port}  (${e.project})`}
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

// ── Entry point ──────────────────────────────────────────────

const args = process.argv.slice(3);
const subcommand = args[0];

if (subcommand === "add") {
  const name = args[1];
  const portStr = args[2];
  if (!name || !portStr) {
    render(<ErrorMessage message="Usage: dev-proxy worktree add <name> <port>" />);
  } else {
    const port = Number(portStr);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
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
