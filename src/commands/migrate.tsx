import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Box, Text, render } from "ink";
import {
  PROJECT_CONFIG_NAME,
  PROJECT_WORKTREES_NAME,
  readGlobalConfig,
  readProjectConfig,
  writeProjectConfig,
  writeJsConfig,
  resolveProjectConfigFile,
} from "../cli/config-io.js";
import { Header, SuccessMessage, ErrorMessage, ExitOnRender } from "../cli/output.js";

interface MigrateResult {
  path: string;
  status:
    | "migrated"
    | "split-worktrees"
    | "skipped-js-exists"
    | "skipped-no-json"
    | "skipped-no-routes";
}

function migrateProject(projectPath: string): MigrateResult {
  const resolution = resolveProjectConfigFile(projectPath);
  const legacyPath = resolve(projectPath, PROJECT_CONFIG_NAME);
  const worktreesPath = resolve(projectPath, PROJECT_WORKTREES_NAME);

  if (resolution?.type === "js") {
    // Already on JS config — only thing left to do is split out worktrees
    // from the legacy file (if any) into the dedicated worktrees file.
    if (!existsSync(legacyPath)) {
      return { path: projectPath, status: "skipped-js-exists" };
    }
    const cfg = readProjectConfig(projectPath);
    const hasLegacyWorktrees = cfg.worktrees && Object.keys(cfg.worktrees).length > 0;
    const newFileExists = existsSync(worktreesPath);
    if (!hasLegacyWorktrees && newFileExists) {
      return { path: projectPath, status: "skipped-js-exists" };
    }

    if (hasLegacyWorktrees) {
      writeProjectConfig(projectPath, { worktrees: cfg.worktrees ?? {} });
    }
    cleanupLegacyFile(legacyPath, cfg.worktreeConfig);
    return { path: projectPath, status: "split-worktrees" };
  }

  if (!existsSync(legacyPath)) {
    return { path: projectPath, status: "skipped-no-json" };
  }

  const cfg = readProjectConfig(projectPath);
  const routes = cfg.routes ?? {};

  if (Object.keys(routes).length === 0 && !cfg.worktreeConfig) {
    return { path: projectPath, status: "skipped-no-routes" };
  }

  writeJsConfig(projectPath, routes);

  // Persist worktrees to the new file and worktreeConfig (if any) back to
  // the legacy file. writeProjectConfig handles the split automatically.
  const splitCfg: {
    worktrees: NonNullable<typeof cfg.worktrees>;
    worktreeConfig?: typeof cfg.worktreeConfig;
  } = {
    worktrees: cfg.worktrees ?? {},
  };
  if (cfg.worktreeConfig) splitCfg.worktreeConfig = cfg.worktreeConfig;
  writeProjectConfig(projectPath, splitCfg);

  // If the legacy file would now hold nothing (no worktreeConfig), delete it.
  cleanupLegacyFile(legacyPath, cfg.worktreeConfig);

  return { path: projectPath, status: "migrated" };
}

function cleanupLegacyFile(legacyPath: string, worktreeConfig: unknown): void {
  if (worktreeConfig) return;
  if (!existsSync(legacyPath)) return;
  try {
    unlinkSync(legacyPath);
  } catch {
    /* best-effort cleanup */
  }
}

function Migrate() {
  const globalCfg = readGlobalConfig();
  const projects = globalCfg.projects ?? [];

  if (projects.length === 0) {
    return (
      <Box flexDirection="column">
        <ExitOnRender />
        <Header text="dev-proxy migrate" />
        <ErrorMessage
          message="No projects registered"
          hint="Run 'dev-proxy init' or 'dev-proxy project add <path>' first"
        />
      </Box>
    );
  }

  const results = projects.map(migrateProject);
  const migrated = results.filter(
    (r) => r.status === "migrated" || r.status === "split-worktrees",
  );
  const skipped = results.filter(
    (r) => r.status !== "migrated" && r.status !== "split-worktrees",
  );

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <Header text="dev-proxy migrate" />

      {migrated.map((r) => (
        <SuccessMessage
          key={r.path}
          message={
            r.status === "split-worktrees"
              ? `Split worktrees: ${r.path}`
              : `Migrated: ${r.path}`
          }
        />
      ))}

      {skipped.map((r) => (
        <Text key={r.path} dimColor>
          {"    "}
          {r.status === "skipped-js-exists" && `Skipped (already migrated): ${r.path}`}
          {r.status === "skipped-no-json" && `Skipped (no config files): ${r.path}`}
          {r.status === "skipped-no-routes" &&
            `Skipped (no routes to migrate): ${r.path}`}
        </Text>
      ))}

      {migrated.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {"    Routes → dev-proxy.config.mjs, worktrees → .dev-proxy.worktrees.json"}
          </Text>
        </Box>
      )}

      {migrated.length === 0 && <Text dimColor>{"    Nothing to migrate"}</Text>}
    </Box>
  );
}

export const __testing = { migrateProject };

render(<Migrate />);
