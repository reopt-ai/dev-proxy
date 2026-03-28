import fs from "node:fs";
import { constants } from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { config, CONFIG_DIR } from "./config.js";

const CERTS_DIR = path.resolve(CONFIG_DIR, "certs");
const DEFAULT_CERT = path.join(CERTS_DIR, `${config.domain}+1.pem`);
const DEFAULT_KEY = path.join(CERTS_DIR, `${config.domain}+1-key.pem`);
const DOMAINS = [`*.${config.domain}`, config.domain];

function hasMkcert(): boolean {
  try {
    execSync("which mkcert", { stdio: "ignore" });
    return true;
  } catch {
    // Expected: mkcert is simply not installed
    return false;
  }
}

/**
 * Resolves TLS certificate paths for the dev proxy.
 *
 * 1. If explicit paths are provided (from config), uses those.
 * 2. Otherwise checks for certs at ~/.dev-proxy/certs/.
 * 3. If missing, auto-generates using mkcert (installs local CA if needed).
 * 4. If mkcert is not installed, logs instructions and returns null.
 */
export function resolveCerts(
  configCertPath?: string,
  configKeyPath?: string,
): { certPath: string; keyPath: string } | null {
  // Explicit config — use as-is
  if (configCertPath && configKeyPath) {
    if (fs.existsSync(configCertPath) && fs.existsSync(configKeyPath)) {
      return { certPath: configCertPath, keyPath: configKeyPath };
    }
    console.error(
      `[dev-proxy] Configured cert/key not found:\n  cert: ${configCertPath}\n  key:  ${configKeyPath}`,
    );
    return null;
  }

  // Default location — check if already generated
  if (fs.existsSync(DEFAULT_CERT) && fs.existsSync(DEFAULT_KEY)) {
    return { certPath: DEFAULT_CERT, keyPath: DEFAULT_KEY };
  }

  // Auto-generate with mkcert
  if (!hasMkcert()) {
    console.error(
      "[dev-proxy] HTTPS disabled — mkcert not found.\n" +
        "  Install: brew install mkcert && mkcert -install",
    );
    return null;
  }

  try {
    fs.mkdirSync(CERTS_DIR, { recursive: true });

    // Ensure local CA is installed (idempotent)
    execFileSync("mkcert", ["-install"], { stdio: "ignore" });

    // Generate wildcard cert (use execFileSync to avoid shell injection)
    execFileSync(
      "mkcert",
      ["-cert-file", DEFAULT_CERT, "-key-file", DEFAULT_KEY, ...DOMAINS],
      { stdio: "inherit" },
    );

    // Restrict cert file permissions to owner-only (0600)
    try {
      fs.chmodSync(DEFAULT_CERT, constants.S_IRUSR | constants.S_IWUSR);
      fs.chmodSync(DEFAULT_KEY, constants.S_IRUSR | constants.S_IWUSR);
    } catch {
      // Non-fatal: best-effort permission tightening
    }

    console.warn("[dev-proxy] TLS certificates generated with mkcert");
    return { certPath: DEFAULT_CERT, keyPath: DEFAULT_KEY };
  } catch (err) {
    console.error(
      `[dev-proxy] HTTPS disabled — mkcert failed: ${(err as Error).message}`,
    );
    return null;
  }
}
