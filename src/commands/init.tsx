import { useState, useMemo } from "react";
import { render, Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { platform } from "node:os";
import { execFileSync } from "node:child_process";
import type { RawGlobalConfig } from "../cli/config-io.js";
import {
  CONFIG_DIR,
  GLOBAL_CONFIG_PATH,
  PROJECT_CONFIG_NAME,
  JS_CONFIG_NAMES,
  isValidPort,
  isValidSubdomain,
  readGlobalConfig,
  writeGlobalConfig,
  writeProjectConfig,
  writeJsConfig,
  resolveProjectConfigFile,
} from "../cli/config-io.js";
import { ExitOnRender } from "../cli/output.js";

interface Route {
  subdomain: string;
  port: string;
}

type Step =
  | "domain"
  | "httpPort"
  | "httpsPort"
  | "projectPath"
  | "routes"
  | "wildcard"
  | "confirm"
  | "done";

// ── Validators ──────────────────────────────────────────────

function validatePort(value: string): string | null {
  const num = parseInt(value, 10);
  if (!isValidPort(num)) return `Invalid port "${value}" — must be 1-65535`;
  return null;
}

function validateProjectPath(value: string): string | null {
  const abs = isAbsolute(value) ? value : resolve(process.cwd(), value);
  if (!existsSync(abs)) return `Path does not exist: ${abs}`;
  return null;
}

// ── Pure logic ──────────────────────────────────────────────

type ParseRouteResult =
  | { ok: true; sub: string; port: string }
  | { ok: false; done: true }
  | { ok: false; done?: false; error: string };

function parseRouteInput(value: string, existing: Route[]): ParseRouteResult {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, done: true };

  const eq = trimmed.indexOf("=");
  if (eq === -1) {
    return { ok: false, error: "Expected format: subdomain=port (e.g. api=4000)" };
  }

  const sub = trimmed.slice(0, eq).trim();
  if (!isValidSubdomain(sub)) {
    return {
      ok: false,
      error: `Invalid subdomain "${sub}" — use lowercase alphanumeric and hyphens only`,
    };
  }
  if (existing.some((r) => r.subdomain === sub)) {
    return { ok: false, error: `Subdomain "${sub}" already added` };
  }

  const portStr = trimmed.slice(eq + 1).trim();
  const portNum = parseInt(portStr, 10);
  if (!isValidPort(portNum)) {
    return { ok: false, error: `Invalid port "${portStr}" — must be 1-65535` };
  }

  return { ok: true, sub, port: portStr };
}

interface BuildGlobalConfigInput {
  domain: string;
  httpPort: string;
  httpsPort: string;
  absPath: string;
}

interface BuildGlobalConfigResult {
  config: { domain: string; port: number; httpsPort: number; projects: string[] };
  message: string;
}

function buildGlobalConfig(
  input: BuildGlobalConfigInput,
  existing: RawGlobalConfig | null,
): BuildGlobalConfigResult {
  if (existing) {
    const config = {
      domain: existing.domain ?? input.domain,
      port: existing.port ?? parseInt(input.httpPort, 10),
      httpsPort: existing.httpsPort ?? parseInt(input.httpsPort, 10),
      projects: [...(existing.projects ?? [])],
    };
    if (!config.projects.includes(input.absPath)) {
      config.projects.push(input.absPath);
      return { config, message: "added" };
    }
    return { config, message: "already-registered" };
  }

  return {
    config: {
      domain: input.domain,
      port: parseInt(input.httpPort, 10),
      httpsPort: parseInt(input.httpsPort, 10),
      projects: [input.absPath],
    },
    message: "created",
  };
}

function buildRouteMap(routes: Route[], wildcard: string): Record<string, string> {
  const routeMap: Record<string, string> = {};
  for (const r of routes) {
    routeMap[r.subdomain] = `http://localhost:${r.port}`;
  }
  if (wildcard) {
    routeMap["*"] = `http://localhost:${wildcard}`;
  }
  return routeMap;
}

// ── Completed Step Display ───────────────────────────────────

function CompletedStep({ label, value }: { label: string; value: string }) {
  return (
    <Text>
      {"  "}
      <Text color="green">{"\u2713"}</Text>
      <Text bold>{` ${label}: `}</Text>
      <Text>{value}</Text>
    </Text>
  );
}

// ── Route Input ──────────────────────────────────────────────

function RouteInput({
  existing,
  onAdd,
  onDone,
}: {
  existing: Route[];
  onAdd: (sub: string, port: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{"    "}</Text>
        <TextInput
          value={value}
          placeholder="subdomain=port (empty to finish)"
          onChange={(v) => {
            setValue(v);
            setError("");
          }}
          onSubmit={(v) => {
            const result = parseRouteInput(v, existing);
            if (result.ok) {
              onAdd(result.sub, result.port);
              setValue("");
              setError("");
            } else if (result.done) {
              onDone();
            } else {
              setError(result.error);
            }
          }}
        />
      </Box>
      {error && (
        <Text color="red">
          {"      "}
          {error}
        </Text>
      )}
    </Box>
  );
}

// ── Prompt ───────────────────────────────────────────────────

function Prompt({
  label,
  defaultValue,
  onSubmit,
  validate,
}: {
  label: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  validate?: (value: string) => string | null;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  return (
    <Box flexDirection="column">
      <Box>
        <Text>{"  "}</Text>
        <Text bold>{label}</Text>
        {defaultValue && <Text dimColor>{` (${defaultValue})`}</Text>}
        <Text>{": "}</Text>
        <TextInput
          value={value}
          onChange={(v) => {
            setValue(v);
            setError("");
          }}
          onSubmit={(v) => {
            const trimmed = v.trim();
            const resolved = trimmed !== "" ? trimmed : (defaultValue ?? "");
            if (validate) {
              const err = validate(resolved);
              if (err) {
                setError(err);
                return;
              }
            }
            onSubmit(resolved);
          }}
        />
      </Box>
      {error && (
        <Text color="red">
          {"      "}
          {error}
        </Text>
      )}
    </Box>
  );
}

// ── Confirm Step ─────────────────────────────────────────────

function ConfirmOverwrite({
  path,
  onConfirm,
}: {
  path: string;
  onConfirm: (yes: boolean) => void;
}) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") onConfirm(true);
    else if (key === "n") onConfirm(false);
  });

  return (
    <Text>
      {"  "}
      <Text color="yellow">{"\u26A0"}</Text>
      <Text>{` ${path} exists. Overwrite? `}</Text>
      <Text dimColor>[y/N]</Text>
    </Text>
  );
}

// ── Main Wizard ──────────────────────────────────────────────

function InitWizard() {
  const existing = readGlobalConfig();
  const hasGlobal = existsSync(GLOBAL_CONFIG_PATH) && existing.domain;

  const [step, setStep] = useState<Step>(hasGlobal ? "projectPath" : "domain");
  const [domain, setDomain] = useState(hasGlobal ? (existing.domain ?? "") : "");
  const [httpPort, setHttpPort] = useState(
    hasGlobal ? String(existing.port ?? 3000) : "",
  );
  const [httpsPort, setHttpsPort] = useState(
    hasGlobal ? String(existing.httpsPort ?? 3443) : "",
  );
  const [projectPath, setProjectPath] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [wildcard, setWildcard] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

  const addMessage = (msg: string) => {
    setMessages((prev) => [...prev, msg]);
  };

  const writeConfigs = (overwriteProject: boolean) => {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
    } catch (err) {
      addMessage(`Failed to create ${CONFIG_DIR}: ${(err as Error).message}`);
      setStep("done");
      return;
    }
    const absPath = isAbsolute(projectPath)
      ? projectPath
      : resolve(process.cwd(), projectPath);

    const currentGlobal = readGlobalConfig();
    const hasExisting = existsSync(GLOBAL_CONFIG_PATH);
    const { config: globalConfig, message: globalMsg } = buildGlobalConfig(
      { domain, httpPort, httpsPort, absPath },
      hasExisting ? currentGlobal : null,
    );

    switch (globalMsg) {
      case "added":
        addMessage(`Added project to ${GLOBAL_CONFIG_PATH}`);
        break;
      case "already-registered":
        addMessage(`Project already registered`);
        break;
      case "created":
        addMessage(`Created ${GLOBAL_CONFIG_PATH}`);
        break;
    }

    try {
      writeGlobalConfig(globalConfig);
    } catch (err) {
      addMessage(`Failed to write ${GLOBAL_CONFIG_PATH}: ${(err as Error).message}`);
    }

    // Project config — JS config for routes, JSON for worktrees
    const jsConfigPath = resolve(absPath, JS_CONFIG_NAMES[0] as string);
    const jsonConfigPath = resolve(absPath, PROJECT_CONFIG_NAME);
    const routeMap = buildRouteMap(routes, wildcard);

    if (!existsSync(jsConfigPath) || overwriteProject) {
      try {
        writeJsConfig(absPath, routeMap);
        addMessage(`Created ${jsConfigPath}`);
      } catch (err) {
        addMessage(`Failed to write ${jsConfigPath}: ${(err as Error).message}`);
      }
    } else {
      addMessage(`Skipped ${jsConfigPath}`);
    }

    // Ensure .dev-proxy.json exists for worktrees
    if (!existsSync(jsonConfigPath)) {
      try {
        writeProjectConfig(absPath, { worktrees: {} });
        addMessage(`Created ${jsonConfigPath}`);
      } catch (err) {
        addMessage(`Failed to write ${jsonConfigPath}: ${(err as Error).message}`);
      }
    }

    setStep("done");
  };

  // DNS + mkcert info for done screen — only computed once
  const hasMkcert = useMemo(() => {
    try {
      execFileSync("which", ["mkcert"], { stdio: "ignore" });
      return true;
    } catch {
      // Expected: mkcert is simply not installed
      return false;
    }
  }, []);

  const absProjectPath = projectPath
    ? isAbsolute(projectPath)
      ? projectPath
      : resolve(process.cwd(), projectPath)
    : "";
  const projectConfigExists =
    absProjectPath && resolveProjectConfigFile(absProjectPath) !== null;

  // Check if project is already registered in global config
  const isAlreadyRegistered =
    absProjectPath && (existing.projects ?? []).includes(absProjectPath);

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1}>
      {/* Title */}
      <Text bold>{"  dev-proxy init"}</Text>
      <Text dimColor>{"  " + "\u2500".repeat(44)}</Text>
      <Text>{""}</Text>

      {/* Completed steps */}
      {domain && step !== "domain" && <CompletedStep label="Domain" value={domain} />}
      {httpPort && step !== "httpPort" && (
        <CompletedStep label="HTTP" value={`:${httpPort}`} />
      )}
      {httpsPort && step !== "httpsPort" && (
        <CompletedStep label="HTTPS" value={`:${httpsPort}`} />
      )}
      {projectPath && step !== "projectPath" && (
        <CompletedStep label="Project" value={absProjectPath} />
      )}
      {isAlreadyRegistered && step === "routes" && (
        <Text>
          {"  "}
          <Text color="yellow">{"\u26A0"}</Text>
          <Text dimColor>{" Project already registered — routes will be updated"}</Text>
        </Text>
      )}
      {routes.length > 0 && step !== "routes" && (
        <Box flexDirection="column">
          {routes.map((r) => (
            <CompletedStep key={r.subdomain} label={r.subdomain} value={`:${r.port}`} />
          ))}
        </Box>
      )}
      {wildcard && step !== "wildcard" && (
        <CompletedStep label="*" value={`:${wildcard}`} />
      )}

      {/* Current step */}
      {step === "domain" && (
        <Prompt
          label="Domain"
          defaultValue="localhost"
          onSubmit={(v) => {
            setDomain(v);
            setStep("httpPort");
          }}
        />
      )}

      {step === "httpPort" && (
        <Prompt
          label="HTTP port"
          defaultValue="3000"
          validate={validatePort}
          onSubmit={(v) => {
            setHttpPort(v);
            setStep("httpsPort");
          }}
        />
      )}

      {step === "httpsPort" && (
        <Prompt
          label="HTTPS port"
          defaultValue="3443"
          validate={validatePort}
          onSubmit={(v) => {
            setHttpsPort(v);
            setStep("projectPath");
          }}
        />
      )}

      {step === "projectPath" && (
        <Prompt
          label="Project path"
          defaultValue={process.cwd()}
          validate={validateProjectPath}
          onSubmit={(v) => {
            setProjectPath(v);
            setStep("routes");
          }}
        />
      )}

      {step === "routes" && (
        <Box flexDirection="column">
          <Text dimColor>{"  Add routes (subdomain=port, empty to finish):"}</Text>
          {routes.map((r) => (
            <Text key={r.subdomain}>
              {"    "}
              <Text color="cyan">{r.subdomain}</Text>
              <Text dimColor>{" \u279C "}</Text>
              <Text>{`:${r.port}`}</Text>
            </Text>
          ))}
          <RouteInput
            existing={routes}
            onAdd={(sub, port) => {
              setRoutes((prev) => [...prev, { subdomain: sub, port }]);
            }}
            onDone={() => {
              setStep("wildcard");
            }}
          />
        </Box>
      )}

      {step === "wildcard" && (
        <Prompt
          label="Default port for unmatched subdomains (empty to skip)"
          onSubmit={(v) => {
            setWildcard(v);
            if (projectConfigExists) {
              setStep("confirm");
            } else {
              writeConfigs(false);
            }
          }}
        />
      )}

      {step === "confirm" && (
        <ConfirmOverwrite
          path={resolve(absProjectPath, JS_CONFIG_NAMES[0] as string)}
          onConfirm={(yes) => {
            writeConfigs(yes);
          }}
        />
      )}

      {step === "done" && (
        <Box flexDirection="column">
          <Text>{""}</Text>
          {messages.map((msg, i) => (
            <Text key={i}>
              {"  "}
              <Text color="green">{"\u2713"}</Text>
              <Text>{` ${msg}`}</Text>
            </Text>
          ))}

          {/* DNS guide */}
          {domain !== "localhost" && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>{"  DNS Setup"}</Text>
              <Text dimColor>{"  " + "\u2500".repeat(44)}</Text>
              {platform() === "darwin" ? (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>{"  Recommended: dnsmasq (automatic wildcard)"}</Text>
                  <Text color="cyan">{`    brew install dnsmasq`}</Text>
                  <Text color="cyan">{`    echo "address=/${domain}/127.0.0.1" >> $(brew --prefix)/etc/dnsmasq.conf`}</Text>
                  <Text color="cyan">{`    sudo brew services start dnsmasq`}</Text>
                  <Text color="cyan">{`    sudo mkdir -p /etc/resolver`}</Text>
                  <Text color="cyan">{`    echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/${domain}`}</Text>
                </Box>
              ) : (
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor>{"  Add to /etc/hosts:"}</Text>
                  {routes.map((r) => (
                    <Text key={r.subdomain} color="cyan">
                      {`    127.0.0.1 ${r.subdomain}.${domain}`}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* mkcert */}
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{"  TLS"}</Text>
            <Text dimColor>{"  " + "\u2500".repeat(44)}</Text>
            {hasMkcert ? (
              <Text>
                {"  "}
                <Text color="green">{"\u2713"}</Text>
                <Text>
                  {" mkcert detected \u2014 TLS certs auto-generated on first run"}
                </Text>
              </Text>
            ) : (
              <Box flexDirection="column">
                <Text>
                  {"  "}
                  <Text color="yellow">{"\u26A0"}</Text>
                  <Text>{" mkcert not found \u2014 HTTPS will be disabled"}</Text>
                </Text>
                <Text dimColor>
                  {"    Install: brew install mkcert && mkcert -install"}
                </Text>
              </Box>
            )}
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{"  " + "\u2500".repeat(44)}</Text>
            <Text>
              {"  "}
              <Text bold>Done!</Text>
              <Text>{" Run "}</Text>
              <Text color="cyan">dev-proxy</Text>
              <Text>{" to start."}</Text>
            </Text>
          </Box>
          <ExitOnRender />
        </Box>
      )}
    </Box>
  );
}

render(<InitWizard />);

export const __testing = {
  validatePort,
  validateProjectPath,
  parseRouteInput,
  buildGlobalConfig,
  buildRouteMap,
};
