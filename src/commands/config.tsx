import { useState } from "react";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { Box, render, useApp } from "ink";
import { Header, Row, SuccessMessage, ErrorMessage } from "../cli/output.js";

const CONFIG_DIR = resolve(homedir(), ".dev-proxy");
const CONFIG_PATH = resolve(CONFIG_DIR, "config.json");

interface RawGlobalConfig {
  domain?: string;
  port?: number;
  httpsPort?: number;
  certPath?: string;
  keyPath?: string;
  projects?: string[];
}

function readConfig(): RawGlobalConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as RawGlobalConfig;
    }
  } catch {
    // corrupt file — treat as empty
  }
  return {};
}

function writeConfig(cfg: RawGlobalConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

function ExitOnRender() {
  const { exit } = useApp();
  useState(() => {
    setTimeout(exit, 0);
  });
  return null;
}

// ── Show current config ──────────────────────────────────────

function ConfigView() {
  const cfg = readConfig();
  return (
    <Box flexDirection="column">
      <ExitOnRender />
      <Header text="Global Configuration" />
      <Row label="domain" value={cfg.domain ?? "localhost"} />
      <Row label="port" value={String(cfg.port ?? 3000)} />
      <Row label="httpsPort" value={String(cfg.httpsPort ?? 3443)} />
      <Row
        label="projects"
        value={
          cfg.projects && cfg.projects.length > 0 ? cfg.projects.join(", ") : "(none)"
        }
      />
    </Box>
  );
}

// ── Set a config key ─────────────────────────────────────────

const VALID_KEYS = new Set(["domain", "port", "httpsPort"]);

function ConfigSet({ configKey, value }: { configKey: string; value: string }) {
  let message: string | undefined;
  let error: string | undefined;
  let hint: string | undefined;

  if (!VALID_KEYS.has(configKey)) {
    error = `Unknown config key "${configKey}"`;
    hint = `Supported keys: ${[...VALID_KEYS].join(", ")}`;
  } else {
    const cfg = readConfig();

    if (configKey === "domain") {
      cfg.domain = value;
    } else {
      const num = Number(value);
      if (!Number.isInteger(num) || num <= 0 || num > 65535) {
        error = `Invalid port value "${value}"`;
        hint = "Expected an integer between 1 and 65535";
      } else {
        if (configKey === "port") cfg.port = num;
        else cfg.httpsPort = num;
      }
    }

    if (!error) {
      writeConfig(cfg);
      message = `Set ${configKey} = ${value}`;
    }
  }

  return (
    <Box flexDirection="column">
      <ExitOnRender />
      {message && <SuccessMessage message={message} />}
      {error && <ErrorMessage message={error} hint={hint} />}
    </Box>
  );
}

// ── Entry point ──────────────────────────────────────────────

const args = process.argv.slice(3);
const subcommand = args[0];

if (subcommand === "set") {
  const key = args[1];
  const value = args[2];
  if (!key || !value) {
    render(
      <ErrorMessage
        message="Usage: dev-proxy config set <key> <value>"
        hint={`Supported keys: ${[...VALID_KEYS].join(", ")}`}
      />,
    );
  } else {
    render(<ConfigSet configKey={key} value={value} />);
  }
} else {
  render(<ConfigView />);
}
