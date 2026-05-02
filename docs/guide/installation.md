# dev-proxy Installation Guide (for LLM Agents)

This guide is designed for AI coding agents (Claude Code, Cursor, Copilot, etc.) to install and configure dev-proxy non-interactively. Follow each step in order. All placeholders (like `DOMAIN`) must be replaced with actual values from the user.

> **Two paths.** If you can run an interactive TUI in the user's terminal, prefer **Path A — `dev-proxy init`** (Step 3A). It walks the user through every prompt and writes the correct config files automatically. If you cannot drive a TUI (background agent, CI, scripted setup), use **Path B — manual file authoring** (Step 3B).

## Prerequisites

```bash
node -v
# Must be >= 20.11.0. If not, ask the user to upgrade before continuing.
```

## Step 1: Install

```bash
npm install -g @reopt-ai/dev-proxy
dev-proxy --version
# Should print the version. If command not found, check npm global bin is in PATH.
```

## Step 2: Gather Information

Ask the user these questions. Do not assume defaults without asking.

1. **Domain** — What domain do you want to use for local development? Examples: `myapp.dev`, `example.local`. If unsure, use `localhost` (no DNS setup needed).
2. **Project path** — Absolute path to the project directory. Example: `/Users/me/projects/myapp`.
3. **Routes** — Which subdomains should map to which local ports?
   - Example: `www` → `3001`, `api` → `4000`, `admin` → `3002`
4. **Default port** — Should unmatched subdomains fall back to a port? (optional, becomes `"*"` wildcard)
5. **Worktree support** — Does the project use git worktrees? If yes, ask:
   - Port range for worktree allocation (e.g., `4101-5000`)
   - Directory pattern (e.g., `../myproject-{branch}`)
   - For each service/subdomain in routes: what env variable name does the app use for its port? (e.g., `www` uses `PORT`, `data` uses `DATA_PORT`)

## Step 3A: Configure (Interactive — Preferred)

Run the wizard from the user's project directory:

```bash
cd <project path>
dev-proxy init
```

`dev-proxy init` prompts for domain, ports, project path, routes, and a wildcard fallback, then writes:

- `~/.dev-proxy/config.json` (creating or updating the `projects` array)
- `<project path>/dev-proxy.config.mjs` (routes — the canonical project config)
- `<project path>/.dev-proxy.json` (empty `{ "worktrees": {} }` placeholder)

If a `dev-proxy.config.mjs` already exists, the wizard asks before overwriting. Skip Step 3B and continue at Step 4.

> **Worktree support is not part of the wizard.** If the user wants worktrees, finish `init`, then add the `worktreeConfig` block to `.dev-proxy.json` as shown in Step 3B (substep 3).

## Step 3B: Configure (Manual)

Use this path only when an interactive TUI is unavailable.

### 1. Global config

If `~/.dev-proxy/config.json` already exists, read it first and only add the new project path to the `projects` array. Do not overwrite existing domain/port settings.

If it does not exist, create it:

```bash
mkdir -p ~/.dev-proxy
```

Then write `~/.dev-proxy/config.json` — replace placeholders with the user's answers from Step 2:

```json
{
  "domain": "<user's domain, e.g. myapp.dev>",
  "port": 3000,
  "httpsPort": 3443,
  "projects": ["<absolute path to project>"]
}
```

### 2. Project config (routes)

Routes live in **`<project path>/dev-proxy.config.mjs`** — this is the canonical format. Do not place routes in `.dev-proxy.json`; that file is reserved for the worktree instance map (see substep 3).

If a `dev-proxy.config.mjs` already exists, read it first and merge — do not overwrite existing routes.

```js
// <project path>/dev-proxy.config.mjs
/** @type {import('@reopt-ai/dev-proxy').Config} */
export default {
  routes: {
    www: "http://localhost:3001",
    api: "http://localhost:4000",
    "*": "http://localhost:3001",
  },
};
```

Only include the `"*"` entry if the user provided a default port in Step 2.

> **Why `.mjs`?** dev-proxy is ESM-only. `.mjs` works in any project regardless of the package's `"type"` field. `dev-proxy.config.js` is also accepted (used when `package.json` has `"type": "module"`); `.mjs` takes precedence if both exist.

### 3. Worktree support (optional)

If the user wants worktrees, add `worktreeConfig` to **`<project path>/.dev-proxy.json`** (not the `.mjs` file). The `services` field maps each subdomain to the env variable name the app reads for its port:

```json
{
  "worktrees": {},
  "worktreeConfig": {
    "portRange": [4101, 5000],
    "directory": "../<project-name>-{branch}",
    "services": {
      "www": { "env": "PORT" },
      "data": { "env": "DATA_PORT" }
    },
    "envFile": ".env.local",
    "hooks": {
      "post-create": "<install command, e.g. pnpm install>",
      "post-remove": "echo cleanup"
    }
  }
}
```

Routes still live in `dev-proxy.config.mjs` from substep 2 — only `worktreeConfig` and the `worktrees` map go into `.dev-proxy.json`.

When `dev-proxy worktree create <branch>` runs, it:

1. Allocates one port per service from `portRange`
2. Writes the env file (e.g., `.env.local`) with the port assignments: `PORT=4101`, `DATA_PORT=4102`
3. Updates `.dev-proxy.json` to record the new worktree's ports
4. The app reads `.env.local` to know which port to listen on — works with Next.js, Vite, and most Node.js frameworks

The `{branch}` placeholder in `directory` is replaced with the branch name at runtime.

> **File-split summary.** Routes → `dev-proxy.config.mjs` (you author this). `worktreeConfig` + `worktrees` map → `.dev-proxy.json` (you author `worktreeConfig`; the CLI manages the `worktrees` map). Both files are safe to commit so teammates share the same setup.

## Step 4: DNS Setup

**Skip this entire step if domain is `localhost`.**

Detect the operating system and set up DNS resolution so `*.domain` resolves to `127.0.0.1`.

### macOS (recommended: dnsmasq)

dnsmasq provides automatic wildcard resolution — no need to add each subdomain manually.

First check if dnsmasq is already installed and running:

```bash
brew list dnsmasq 2>/dev/null && echo "already installed" || echo "not installed"
```

If not installed:

```bash
brew install dnsmasq
```

Then add the domain entry. Check for duplicates first:

```bash
# Only add if not already configured
grep -q "<domain>" "$(brew --prefix)/etc/dnsmasq.conf" 2>/dev/null || \
  echo "address=/<domain>/127.0.0.1" >> "$(brew --prefix)/etc/dnsmasq.conf"
```

Start/restart dnsmasq and configure the resolver:

```bash
sudo brew services restart dnsmasq
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/<domain>
```

Replace `<domain>` with the actual domain (e.g., `myapp.dev`).

> **Important:** The `sudo` commands require user confirmation. Explain what each command does before running. Never run sudo commands without user awareness.

### Linux

Linux `/etc/hosts` does not support wildcards. Each subdomain must be added individually.

Check for existing entries before adding:

```bash
# For each subdomain in routes (excluding "*"):
grep -q "www.<domain>" /etc/hosts || echo "127.0.0.1 www.<domain>" | sudo tee -a /etc/hosts
grep -q "api.<domain>" /etc/hosts || echo "127.0.0.1 api.<domain>" | sudo tee -a /etc/hosts
```

### Verify DNS

```bash
ping -c 1 www.<domain>
# Should resolve to 127.0.0.1. If not, DNS setup failed — re-check the steps above.
```

## Step 5: HTTPS Setup (Optional)

Check if mkcert is installed:

```bash
which mkcert && echo "installed" || echo "not installed"
```

If not installed:

```bash
# macOS
brew install mkcert && mkcert -install

# Linux (Debian/Ubuntu)
sudo apt install mkcert && mkcert -install
```

dev-proxy automatically generates wildcard TLS certificates on first run when mkcert is available. No manual cert creation needed.

## Step 6: Verify Installation

```bash
dev-proxy doctor
```

This checks config files, DNS resolution, TLS setup, and port availability. Review the output:

- All green checks (✓) = ready
- Yellow warnings (⚠) for DNS are expected if domain is `localhost`
- Red failures (✗) need to be addressed before proceeding

## Step 7: Start

dev-proxy runs as a **foreground process** with a terminal UI. It will take over the terminal until stopped with Ctrl+C.

```bash
dev-proxy
```

The proxy is now running. Access services at:

- `http://www.<domain>:3000` (HTTP)
- `https://www.<domain>:3443` (HTTPS, if mkcert was set up)

Press **Enter** in the TUI to activate the traffic inspector.

To run in the background, use a terminal multiplexer or a separate terminal tab.

## Migrating from `.dev-proxy.json`

Earlier versions of dev-proxy stored routes in `.dev-proxy.json`. That format still works, but `dev-proxy.config.mjs` is now the documented default — it supports comments, type hints (`/** @type {import('@reopt-ai/dev-proxy').Config} */`), and dynamic logic.

To migrate every project registered in `~/.dev-proxy/config.json` in one shot:

```bash
dev-proxy migrate
```

For each project, this command:

1. Reads `routes` from `.dev-proxy.json`.
2. Writes them to `dev-proxy.config.mjs` (skipped if a JS config already exists).
3. Rewrites `.dev-proxy.json` to contain only `worktrees` (per-worktree port assignments).

Projects already on `dev-proxy.config.mjs` / `.js` are skipped. The command is idempotent — running it twice is safe.

> **`worktreeConfig` is preserved-but-not-copied.** `dev-proxy migrate` only moves `routes`. If your `.dev-proxy.json` had a `worktreeConfig` block, **re-add it manually** to the rewritten `.dev-proxy.json` after migration — `worktreeConfig` continues to live in `.dev-proxy.json`, not in the `.mjs` file.

> **Resolution order at runtime:** `dev-proxy.config.mjs` → `dev-proxy.config.js` → `.dev-proxy.json`. The first one found wins for routes; `worktrees` (the runtime instance map) always comes from `.dev-proxy.json` regardless of which routes file is used.

## Managing Projects

Add another project (this also creates an empty `.dev-proxy.json` template if one doesn't exist; you still need to add `dev-proxy.config.mjs` with routes):

```bash
dev-proxy project add /path/to/another/project
```

Then add a `dev-proxy.config.mjs` to that project as described in Step 3B (substep 2), or `cd` into it and run `dev-proxy init`.

List all registered projects:

```bash
dev-proxy project list
```

## Managing Worktrees

Requires `worktreeConfig` in the project's `.dev-proxy.json` (see Step 3B, substep 3).

```bash
# Create: git worktree + auto port + runs post-create hook
dev-proxy worktree create feature-auth

# Access via browser:
# http://feature-auth--www.<domain>:3000

# List all worktrees across projects
dev-proxy worktree list

# Destroy: runs post-remove hook + git worktree remove + releases port
dev-proxy worktree destroy feature-auth
```

For manual registration without git operations (no `worktreeConfig` needed):

```bash
dev-proxy worktree add feature-auth 4001
dev-proxy worktree remove feature-auth
```

## Troubleshooting

Run diagnostics:

```bash
dev-proxy doctor
```

Common issues:

- **DNS not resolving** — Re-run Step 4. On macOS, try `sudo dscacheutil -flushcache`. Verify with `ping www.<domain>`.
- **Port in use** — Check with `lsof -ti :3000`. Kill the process or change the port via `dev-proxy config set port 3080`.
- **HTTPS not working** — Ensure mkcert is installed (`which mkcert`) and the local CA is set up (`mkcert -install`).
- **Config not loading** — Run `dev-proxy status` to see what config is actually loaded. Check file paths and that `dev-proxy.config.mjs` has a default export.
- **Routes seem stale after editing `.dev-proxy.json`** — If `dev-proxy.config.mjs` exists, routes are read from there and `.dev-proxy.json` `routes` are ignored. Either edit the `.mjs` file or delete it to fall back to JSON.
- **Next.js HMR not working / origin errors** — Next.js >= 15.0 validates request origins. Add `allowedDevOrigins` to `next.config.mjs` with each proxy subdomain URL (e.g., `["http://web.localhost:3000"]`). See the [Next.js docs on allowedDevOrigins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).
