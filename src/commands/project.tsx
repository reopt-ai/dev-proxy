import { useState } from "react";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  certPath?: string;
  keyPath?: string;
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

function writeGlobalConfig(cfg: RawGlobalConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

function readProjectConfig(projectPath: string): RawProjectConfig | null {
  const configPath = resolve(projectPath, PROJECT_CONFIG_NAME);
  try {
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf-8")) as RawProjectConfig;
    }
  } catch {
    // corrupt
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

// ── List projects ────────────────────────────────────────────

function ProjectList() {
  const cfg = readGlobalConfig();
  const projects = cfg.projects ?? [];

  if (projects.length === 0) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <Header text="Registered Projects" />
        <Text dimColor>{"    (none)"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <Header text="Registered Projects" />
      {projects.map((p) => {
        const pc = readProjectConfig(p);
        const routeCount = pc ? Object.keys(pc.routes ?? {}).length : 0;
        const worktreeCount = pc ? Object.keys(pc.worktrees ?? {}).length : 0;
        return (
          <Row
            key={p}
            label={p}
            value={`${routeCount} route(s), ${worktreeCount} worktree(s)`}
            pad={40}
          />
        );
      })}
    </Box>
  );
}

// ── Add project ──────────────────────────────────────────────

function ProjectAdd({ projectPath }: { projectPath: string }) {
  const absPath = resolve(projectPath);
  const cfg = readGlobalConfig();
  const projects = cfg.projects ?? [];

  if (projects.includes(absPath)) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage message={`Project already registered: ${absPath}`} />
      </Box>
    );
  }

  // Create .dev-proxy.json template if it doesn't exist
  const projectConfigPath = resolve(absPath, PROJECT_CONFIG_NAME);
  if (!existsSync(projectConfigPath)) {
    writeFileSync(
      projectConfigPath,
      JSON.stringify({ routes: {}, worktrees: {} }, null, 2) + "\n",
      "utf-8",
    );
  }

  cfg.projects = [...projects, absPath];
  writeGlobalConfig(cfg);

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <SuccessMessage message={`Added project: ${absPath}`} />
    </Box>
  );
}

// ── Remove project ───────────────────────────────────────────

function ProjectRemove({ projectPath }: { projectPath: string }) {
  const absPath = resolve(projectPath);
  const cfg = readGlobalConfig();
  const projects = cfg.projects ?? [];

  if (!projects.includes(absPath)) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <ErrorMessage
          message={`Project not found: ${absPath}`}
          hint="Run 'dev-proxy project list' to see registered projects"
        />
      </Box>
    );
  }

  cfg.projects = projects.filter((p) => p !== absPath);
  writeGlobalConfig(cfg);

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <SuccessMessage message={`Removed project: ${absPath}`} />
    </Box>
  );
}

// ── Entry point ──────────────────────────────────────────────

const args = process.argv.slice(3);
const subcommand = args[0];

if (subcommand === "add") {
  const path = args[1] ?? process.cwd();
  render(<ProjectAdd projectPath={path} />);
} else if (subcommand === "remove") {
  const path = args[1];
  if (!path) {
    render(<ErrorMessage message="Usage: dev-proxy project remove <path>" />);
  } else {
    render(<ProjectRemove projectPath={path} />);
  }
} else {
  // "list" or no subcommand → default to list
  render(<ProjectList />);
}
