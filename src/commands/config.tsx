import { Box, render } from "ink";
import { readGlobalConfig, writeGlobalConfig } from "../cli/config-io.js";
import {
  Header,
  Row,
  SuccessMessage,
  ErrorMessage,
  ExitOnRender,
} from "../cli/output.js";

// ── Show current config ──────────────────────────────────────

function ConfigView() {
  const cfg = readGlobalConfig();
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
    const cfg = readGlobalConfig();

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
      writeGlobalConfig(cfg);
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
