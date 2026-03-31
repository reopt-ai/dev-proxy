import { basename } from "node:path";
import { Box, Text, render } from "ink";
import { config } from "../proxy/config.js";
import { Header, Section, Row, RouteRow, ExitOnRender } from "../cli/output.js";

function formatTarget(target: string): string {
  try {
    const url = new URL(target);
    if (url.protocol === "http:" && url.hostname === "localhost") {
      return `localhost:${url.port || "80"}`;
    }
  } catch {
    // not a URL, return as-is
  }
  return target;
}

function projectLabel(path: string): string {
  return basename(path);
}

function Status() {
  const routesByProject: {
    project: string;
    routes: { sub: string; target: string }[];
  }[] = [];
  const allWorktrees: {
    name: string;
    project: string;
    entry: { ports: Record<string, number> } | { port: number };
  }[] = [];

  let totalRoutes = 0;
  for (const project of config.projects) {
    const routes: { sub: string; target: string }[] = [];
    for (const [sub, target] of Object.entries(project.routes)) {
      routes.push({ sub, target: formatTarget(target) });
    }
    if (routes.length > 0) {
      routesByProject.push({ project: project.path, routes });
      totalRoutes += routes.length;
    }
    for (const [name, wt] of Object.entries(project.worktrees)) {
      allWorktrees.push({ name, project: project.path, entry: wt });
    }
  }

  const multiProject = config.projects.length > 1;

  return (
    <Box flexDirection="column">
      <ExitOnRender />

      <Header text="dev-proxy status" />

      <Box flexDirection="column" marginBottom={1}>
        <Row label="Domain" value={config.domain} />
        <Row label="HTTP" value={`:${String(config.port)}`} />
        <Row label="HTTPS" value={`:${String(config.httpsPort)}`} />
      </Box>

      <Section title={`Routes (${String(totalRoutes)})`}>
        {multiProject
          ? routesByProject.map((g) => (
              <Box key={g.project} flexDirection="column">
                <Text dimColor>{`    [${projectLabel(g.project)}]`}</Text>
                {g.routes.map((r) => (
                  <RouteRow key={`${r.sub}-${r.target}`} sub={r.sub} target={r.target} />
                ))}
              </Box>
            ))
          : routesByProject.flatMap((g) =>
              g.routes.map((r) => (
                <RouteRow key={`${r.sub}-${r.target}`} sub={r.sub} target={r.target} />
              )),
            )}
      </Section>

      <Section title={`Projects (${String(config.projects.length)})`}>
        {config.projects.map((p) => (
          <Text key={p.path}>{`    ${p.path}`}</Text>
        ))}
      </Section>

      <Section title={`Worktrees (${String(allWorktrees.length)})`}>
        {allWorktrees.map((w) =>
          "ports" in w.entry ? (
            <Box key={w.name} flexDirection="column">
              <Text bold>{`    ${w.name}`}</Text>
              {Object.entries(w.entry.ports).map(([svc, p]) => (
                <RouteRow key={svc} sub={`  ${svc}`} target={`:${String(p)}`} />
              ))}
            </Box>
          ) : (
            <RouteRow key={w.name} sub={w.name} target={`:${String(w.entry.port)}`} />
          ),
        )}
      </Section>
    </Box>
  );
}

export const __testing = { formatTarget, projectLabel };

render(<Status />);
