import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Box, Text, render } from "ink";
import {
  PROJECT_CONFIG_NAME,
  readGlobalConfig,
  writeGlobalConfig,
  readProjectConfig,
} from "../cli/config-io.js";
import {
  Header,
  Row,
  SuccessMessage,
  ErrorMessage,
  ExitOnRender,
} from "../cli/output.js";

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
        const routeCount = Object.keys(pc.routes ?? {}).length;
        const worktreeCount = Object.keys(pc.worktrees ?? {}).length;
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
