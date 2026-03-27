import { useState } from "react";
import { Box, Text, render, useApp } from "ink";
import { config } from "../proxy/config.js";
import { Header, Section, Row, RouteRow } from "../cli/output.js";

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

function ExitOnRender() {
  const { exit } = useApp();
  useState(() => {
    setTimeout(exit, 0);
  });
  return null;
}

function Status() {
  const allRoutes: { sub: string; target: string }[] = [];
  const allWorktrees: { name: string; port: number }[] = [];

  for (const project of config.projects) {
    for (const [sub, target] of Object.entries(project.routes)) {
      allRoutes.push({ sub, target: formatTarget(target) });
    }
    for (const [name, wt] of Object.entries(project.worktrees)) {
      allWorktrees.push({ name, port: wt.port });
    }
  }

  return (
    <Box flexDirection="column">
      <ExitOnRender />

      <Header text="dev-proxy status" />

      <Box flexDirection="column" marginBottom={1}>
        <Row label="Domain" value={config.domain} />
        <Row label="HTTP" value={`:${String(config.port)}`} />
        <Row label="HTTPS" value={`:${String(config.httpsPort)}`} />
      </Box>

      <Section title={`Routes (${String(allRoutes.length)})`}>
        {allRoutes.map((r) => (
          <RouteRow key={`${r.sub}-${r.target}`} sub={r.sub} target={r.target} />
        ))}
      </Section>

      <Section title={`Projects (${String(config.projects.length)})`}>
        {config.projects.map((p) => (
          <Text key={p.path}>{`    ${p.path}`}</Text>
        ))}
      </Section>

      <Section title={`Worktrees (${String(allWorktrees.length)})`}>
        {allWorktrees.map((w) => (
          <RouteRow key={w.name} sub={w.name} target={`:${String(w.port)}`} />
        ))}
      </Section>
    </Box>
  );
}

render(<Status />);
