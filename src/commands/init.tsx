import { useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { homedir, platform } from "node:os";
import { execFileSync } from "node:child_process";

const CONFIG_DIR = resolve(homedir(), ".dev-proxy");
const GLOBAL_CONFIG_PATH = resolve(CONFIG_DIR, "config.json");
const PROJECT_CONFIG_NAME = ".dev-proxy.json";

// ── Types ────────────────────────────────────────────────────

interface RawGlobalConfig {
  domain?: string;
  port?: number;
  httpsPort?: number;
  projects?: string[];
}

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
  onAdd,
  onDone,
}: {
  onAdd: (sub: string, port: string) => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");

  return (
    <Box>
      <Text dimColor>{"    "}</Text>
      <TextInput
        value={value}
        placeholder="subdomain=port (empty to finish)"
        onChange={setValue}
        onSubmit={(v) => {
          const trimmed = v.trim();
          if (!trimmed) {
            onDone();
            return;
          }
          const eq = trimmed.indexOf("=");
          if (eq !== -1) {
            onAdd(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
          }
          setValue("");
        }}
      />
    </Box>
  );
}

// ── Prompt ───────────────────────────────────────────────────

function Prompt({
  label,
  defaultValue,
  onSubmit,
}: {
  label: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <Box>
      <Text>{"  "}</Text>
      <Text bold>{label}</Text>
      {defaultValue && <Text dimColor>{` (${defaultValue})`}</Text>}
      <Text>{": "}</Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={(v) => {
          const trimmed = v.trim();
          onSubmit(trimmed ? trimmed : (defaultValue ?? ""));
        }}
      />
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
  const [step, setStep] = useState<Step>("domain");
  const [domain, setDomain] = useState("");
  const [httpPort, setHttpPort] = useState("");
  const [httpsPort, setHttpsPort] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [wildcard, setWildcard] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

  const addMessage = (msg: string) => {
    setMessages((prev) => [...prev, msg]);
  };

  const writeConfigs = (overwriteProject: boolean) => {
    // Global config
    mkdirSync(CONFIG_DIR, { recursive: true });
    const absPath = isAbsolute(projectPath)
      ? projectPath
      : resolve(process.cwd(), projectPath);

    let globalConfig: {
      domain: string;
      port: number;
      httpsPort: number;
      projects: string[];
    };
    if (existsSync(GLOBAL_CONFIG_PATH)) {
      const existing = JSON.parse(
        readFileSync(GLOBAL_CONFIG_PATH, "utf-8"),
      ) as RawGlobalConfig;
      globalConfig = {
        domain: existing.domain ?? domain,
        port: existing.port ?? parseInt(httpPort, 10),
        httpsPort: existing.httpsPort ?? parseInt(httpsPort, 10),
        projects: existing.projects ?? [],
      };
      if (!globalConfig.projects.includes(absPath)) {
        globalConfig.projects.push(absPath);
        addMessage(`Added project to ${GLOBAL_CONFIG_PATH}`);
      } else {
        addMessage(`Project already registered`);
      }
    } else {
      globalConfig = {
        domain,
        port: parseInt(httpPort, 10),
        httpsPort: parseInt(httpsPort, 10),
        projects: [absPath],
      };
      addMessage(`Created ${GLOBAL_CONFIG_PATH}`);
    }
    writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(globalConfig, null, 2) + "\n");

    // Project config
    const projectConfigPath = resolve(absPath, PROJECT_CONFIG_NAME);
    const routeMap: Record<string, string> = {};
    for (const r of routes) {
      routeMap[r.subdomain] = `http://localhost:${r.port}`;
    }
    if (wildcard) {
      routeMap["*"] = `http://localhost:${wildcard}`;
    }

    if (!existsSync(projectConfigPath) || overwriteProject) {
      writeFileSync(
        projectConfigPath,
        JSON.stringify({ routes: routeMap, worktrees: {} }, null, 2) + "\n",
      );
      addMessage(`Created ${projectConfigPath}`);
    } else {
      addMessage(`Skipped ${projectConfigPath}`);
    }

    setStep("done");
  };

  // DNS + mkcert info for done screen
  const hasMkcert = (() => {
    try {
      execFileSync("which", ["mkcert"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  const absProjectPath = projectPath
    ? isAbsolute(projectPath)
      ? projectPath
      : resolve(process.cwd(), projectPath)
    : "";
  const projectConfigExists =
    absProjectPath && existsSync(resolve(absProjectPath, PROJECT_CONFIG_NAME));

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
          path={resolve(absProjectPath, PROJECT_CONFIG_NAME)}
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
          <ExitOnDone />
        </Box>
      )}
    </Box>
  );
}

function ExitOnDone() {
  const { exit } = useApp();
  useState(() => {
    setTimeout(exit, 100);
  });
  return null;
}

render(<InitWizard />);
