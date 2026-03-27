import { useState } from "react";
import { Box, Text, render, useApp } from "ink";

function ExitOnRender() {
  const { exit } = useApp();
  useState(() => {
    setTimeout(exit, 0);
  });
  return null;
}

function Help() {
  return (
    <Box flexDirection="column" paddingX={2}>
      <ExitOnRender />

      <Text bold>dev-proxy</Text>
      <Text dimColor> subdomain-based reverse proxy with traffic inspector</Text>
      <Text>{""}</Text>

      <Text bold>Usage</Text>
      <Text>{"  "}$ dev-proxy [command]</Text>
      <Text>{""}</Text>

      <Text bold>Commands</Text>
      <Text>
        {"  (none)              "}
        <Text dimColor>Start proxy and open traffic inspector</Text>
      </Text>
      <Text>
        {"  init                "}
        <Text dimColor>Interactive setup wizard</Text>
      </Text>
      <Text>
        {"  status              "}
        <Text dimColor>Show current configuration and routing table</Text>
      </Text>
      <Text>
        {"  doctor              "}
        <Text dimColor>Run environment diagnostics</Text>
      </Text>
      <Text>
        {"  config              "}
        <Text dimColor>View or modify global settings</Text>
      </Text>
      <Text>
        {"  project             "}
        <Text dimColor>Manage registered projects</Text>
      </Text>
      <Text>
        {"  worktree            "}
        <Text dimColor>Manage worktree port mappings</Text>
      </Text>
      <Text>{""}</Text>

      <Text bold>Options</Text>
      <Text>
        {"  --help, -h          "}
        <Text dimColor>Show this help</Text>
      </Text>
      <Text>
        {"  --version, -v       "}
        <Text dimColor>Show version</Text>
      </Text>
      <Text>{""}</Text>

      <Text bold>Examples</Text>
      <Text>
        {"  "}
        <Text color="cyan">$ dev-proxy</Text>
        {"                          "}
        <Text dimColor>Start the proxy</Text>
      </Text>
      <Text>
        {"  "}
        <Text color="cyan">$ dev-proxy init</Text>
        {"                     "}
        <Text dimColor>Set up a new project</Text>
      </Text>
      <Text>
        {"  "}
        <Text color="cyan">$ dev-proxy project add .</Text>
        {"            "}
        <Text dimColor>Register current directory</Text>
      </Text>
      <Text>
        {"  "}
        <Text color="cyan">$ dev-proxy worktree add feature 4001</Text>
      </Text>
      <Text>
        {"  "}
        <Text color="cyan">$ dev-proxy doctor</Text>
        {"                   "}
        <Text dimColor>Check your setup</Text>
      </Text>
      <Text>{""}</Text>

      <Text bold>Documentation</Text>
      <Text>{"  "}https://github.com/reopt-ai/dev-proxy</Text>
    </Box>
  );
}

render(<Help />);
