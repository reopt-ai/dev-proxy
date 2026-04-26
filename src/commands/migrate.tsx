import { existsSync } from "node:fs";
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

interface MigrateResult {
  path: string;
  status: "migrated" | "skipped-js-exists" | "skipped-no-json" | "skipped-no-routes";
}

function migrateProject(projectPath: string): MigrateResult {
  const resolution = resolveProjectConfigFile(projectPath);

  // Already using JS config
  if (resolution?.type === "js") {
    return { path: projectPath, status: "skipped-js-exists" };
  }

  // No .dev-proxy.json
  const jsonPath = resolve(projectPath, PROJECT_CONFIG_NAME);
  if (!existsSync(jsonPath)) {
    return { path: projectPath, status: "skipped-no-json" };
  }

  const cfg = readProjectConfig(projectPath);
  const routes = cfg.routes ?? {};

  // Nothing to migrate
  if (Object.keys(routes).length === 0 && !cfg.worktreeConfig) {
    return { path: projectPath, status: "skipped-no-routes" };
  }

  // Write dev-proxy.config.mjs with routes (and worktreeConfig comment hint)
  writeJsConfig(projectPath, routes);

  // Rewrite .dev-proxy.json with only worktrees
  writeProjectConfig(projectPath, {
    worktrees: cfg.worktrees ?? {},
  });

  return { path: projectPath, status: "migrated" };
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
  const migrated = results.filter((r) => r.status === "migrated");
  const skipped = results.filter((r) => r.status !== "migrated");

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <Header text="dev-proxy migrate" />

      {migrated.map((r) => (
        <SuccessMessage key={r.path} message={`Migrated: ${r.path}`} />
      ))}

      {skipped.map((r) => (
        <Text key={r.path} dimColor>
          {"    "}
          {r.status === "skipped-js-exists" && `Skipped (already JS config): ${r.path}`}
          {r.status === "skipped-no-json" && `Skipped (no .dev-proxy.json): ${r.path}`}
          {r.status === "skipped-no-routes" &&
            `Skipped (no routes to migrate): ${r.path}`}
        </Text>
      ))}

      {migrated.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {
              "    Routes moved to dev-proxy.config.mjs, worktrees kept in .dev-proxy.json"
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
