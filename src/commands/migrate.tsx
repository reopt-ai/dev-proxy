import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Box, Text, render } from "ink";
import {
  PROJECT_CONFIG_NAME,
  readGlobalConfig,
  readProjectConfig,
  writeProjectConfig,
  writeJsConfig,
  resolveProjectConfigFile,
} from "../cli/config-io.js";
import { Header, SuccessMessage, ErrorMessage, ExitOnRender } from "../cli/output.js";
import { config } from "../proxy/config.js";

interface MigrateResult {
  path: string;
  status:
    | "migrated"
    | "cleaned-legacy"
    | "skipped-no-legacy"
    | "skipped-no-json"
    | "skipped-no-routes";
}

function migrateProject(projectPath: string): MigrateResult {
  const resolution = resolveProjectConfigFile(projectPath);
  const legacyPath = resolve(projectPath, PROJECT_CONFIG_NAME);

  if (resolution?.type === "js") {
    // mjs is already the active config. Move any leftovers from
    // .dev-proxy.json (worktrees / worktreeConfig) into their proper homes,
    // then delete the legacy file.
    if (!existsSync(legacyPath)) {
      return { path: projectPath, status: "skipped-no-legacy" };
    }

    const cfg = readProjectConfig(projectPath);
    const hasWorktrees = cfg.worktrees && Object.keys(cfg.worktrees).length > 0;
    const hasLegacyWtConfig = cfg.worktreeConfig !== undefined;

    if (!hasWorktrees && !hasLegacyWtConfig) {
      cleanupLegacyFile(legacyPath);
      return { path: projectPath, status: "cleaned-legacy" };
    }

    if (hasWorktrees) {
      writeProjectConfig(projectPath, { worktrees: cfg.worktrees ?? {} });
    }

    if (hasLegacyWtConfig) {
      // Preserve existing mjs routes (loaded via the proxy config singleton)
      const project = config.projects.find((p) => p.path === projectPath);
      const routes = project?.routes ?? {};
      writeJsConfig(projectPath, routes, cfg.worktreeConfig);
    }

    cleanupLegacyFile(legacyPath);
    return { path: projectPath, status: "cleaned-legacy" };
  }

  if (!existsSync(legacyPath)) {
    return { path: projectPath, status: "skipped-no-json" };
  }

  const cfg = readProjectConfig(projectPath);
  const routes = cfg.routes ?? {};

  if (Object.keys(routes).length === 0 && !cfg.worktreeConfig) {
    return { path: projectPath, status: "skipped-no-routes" };
  }

  // Routes + worktreeConfig → dev-proxy.config.mjs
  writeJsConfig(projectPath, routes, cfg.worktreeConfig);

  // Worktrees → .dev-proxy.worktrees.json
  if (cfg.worktrees && Object.keys(cfg.worktrees).length > 0) {
    writeProjectConfig(projectPath, { worktrees: cfg.worktrees });
  }

  // .dev-proxy.json no longer holds anything — delete it.
  cleanupLegacyFile(legacyPath);

  return { path: projectPath, status: "migrated" };
}

function cleanupLegacyFile(legacyPath: string): void {
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
    (r) => r.status === "migrated" || r.status === "cleaned-legacy",
  );
  const skipped = results.filter(
    (r) => r.status !== "migrated" && r.status !== "cleaned-legacy",
  );

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <Header text="dev-proxy migrate" />

      {migrated.map((r) => (
        <SuccessMessage
          key={r.path}
          message={
            r.status === "cleaned-legacy"
              ? `Cleaned legacy file: ${r.path}`
              : `Migrated: ${r.path}`
          }
        />
      ))}

      {skipped.map((r) => (
        <Text key={r.path} dimColor>
          {"    "}
          {r.status === "skipped-no-legacy" && `Skipped (already on mjs): ${r.path}`}
          {r.status === "skipped-no-json" && `Skipped (no config files): ${r.path}`}
          {r.status === "skipped-no-routes" &&
            `Skipped (no routes to migrate): ${r.path}`}
        </Text>
      ))}

      {migrated.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {
              "    Routes + worktreeConfig → dev-proxy.config.mjs, worktrees → .dev-proxy.worktrees.json"
            }
          </Text>
        </Box>
      )}

      {migrated.length === 0 && <Text dimColor>{"    Nothing to migrate"}</Text>}
    </Box>
  );
}

export const __testing = { migrateProject };

render(<Migrate />);
