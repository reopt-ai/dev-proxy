---
name: dev-proxy-init
description: |
  Set up @reopt-ai/dev-proxy for any project. Detects project structure,
  frameworks, and services, then generates config files and guides DNS/TLS
  setup. Triggers on: "setup dev-proxy", "dev-proxy init", "dev-proxy setup",
  "configure dev-proxy", "add dev-proxy", "initialize dev-proxy".
metadata:
  version: 1.0.0
---

# dev-proxy-init Skill

Set up `@reopt-ai/dev-proxy` — a subdomain-based reverse proxy for local
development. This skill detects the project structure, generates configuration
files, and guides DNS/TLS setup so the user can access local services at
`http://<subdomain>.<domain>:<port>`.

> **IMPORTANT**: Always confirm the proposed route map with the user before
> writing config files. Never overwrite existing configs without asking.

---

## Phase 1: Prerequisites

### 1.1 Check Node.js

```bash
node -v
```

Must be >= 20.11.0. If not, ask the user to upgrade before continuing.

### 1.2 Check dev-proxy installation

```bash
npm list -g @reopt-ai/dev-proxy 2>/dev/null
```

If not installed:

```bash
npm install -g @reopt-ai/dev-proxy
```

Verify:

```bash
dev-proxy --version
```

### 1.3 Check existing global config

```bash
cat ~/.dev-proxy/config.json 2>/dev/null
```

If it exists, note the current `domain`, `port`, `httpsPort`, and `projects`
array — these will be preserved. If this project's path is already in
`projects`, inform the user and ask whether to reconfigure or skip.

### 1.4 Check for legacy project config

If `.dev-proxy.json` exists in the project root and contains a `routes` key,
this is a legacy JSON-only config. Inform the user and suggest:

```bash
dev-proxy migrate
```

This converts the JSON routes to `dev-proxy.config.js`. If the user chooses
to migrate, run the command and skip to Phase 3.3.

---

## Phase 2: Project Detection

Analyze the current project to build a route map. Follow these steps in order.

### 2.1 Domain selection

- If global config already has a domain → use it (show to user for confirmation)
- If no global config → ask the user. Default to `localhost` if unsure.
- Note: `localhost` requires no DNS setup (browsers resolve `*.localhost`
  to 127.0.0.1 natively)

### 2.2 Monorepo detection

Check for monorepo indicators:

- `turbo.json` → Turborepo (read `workspaces` from root `package.json`)
- `nx.json` → Nx (read `projects` from `workspace.json` or `project.json` files)
- `pnpm-workspace.yaml` → pnpm workspaces (read `packages` globs)
- `lerna.json` → Lerna (read `packages`)
- Root `package.json` with `workspaces` field → npm/yarn workspaces

If monorepo: identify each app/service workspace. Focus on directories that
contain runnable services (things that listen on ports), not libraries.

### 2.3 Framework and port detection

For each app/service (or the single project root if not a monorepo), detect
the framework by checking for config files. Use this detection matrix:

| File                   | Framework           | Default Port  | Port Source                                  |
| ---------------------- | ------------------- | ------------- | -------------------------------------------- |
| `next.config.*`        | Next.js             | 3000          | `package.json` scripts `-p`, `.env*` `PORT=` |
| `vite.config.*`        | Vite                | 5173          | `vite.config.*` `server.port`                |
| `angular.json`         | Angular             | 4200          | `angular.json` `serve.options.port`          |
| `svelte.config.js`     | SvelteKit           | 5173          | Vite-based                                   |
| `nuxt.config.*`        | Nuxt                | 3000          | `nuxt.config` `devServer.port`               |
| `remix.config.*`       | Remix               | 3000          | `package.json` scripts                       |
| `astro.config.*`       | Astro               | 4321          | `astro.config` `server.port`                 |
| `app.py` / `manage.py` | Python              | 8000          | Various                                      |
| `docker-compose.yml`   | Docker              | from `ports:` | Parse port mappings                          |
| `Cargo.toml`           | Rust                | 8080          | Various                                      |
| `go.mod`               | Go                  | 8080          | Various                                      |
| `server.js` / `app.js` | Express/Fastify/Koa | 3000          | Source code `listen()`, `.env*` `PORT=`      |

Port detection priority:

1. `.env.local` → `.env.development` → `.env` for `PORT=` entries
2. `package.json` scripts for `--port`, `-p`, `PORT=` flags
3. Framework config files for port settings
4. Default port for the framework

### 2.4 Build proposed route map

For each detected service, propose a subdomain name:

- Use the directory name (e.g., `apps/web` → `web`, `packages/api` → `api`)
- For single projects, use a sensible name based on the framework (`web`, `app`)

Build the map:

```
subdomain → http://localhost:<detected-port>
```

If there's only one service, suggest it as the `"*"` wildcard.

### 2.5 Present route map to user

Show the proposed routes and ask the user to confirm or modify:

```
Detected routes:
  web → http://localhost:3000 (Next.js)
  api → http://localhost:4000 (Express)
  *   → http://localhost:3000 (fallback)

Domain: localhost (from existing global config / default)

Is this correct? Would you like to add, remove, or change any routes?
```

---

## Phase 3: Generate Configuration

The primary config file is `dev-proxy.config.js`. This is the only file users
edit directly. `.dev-proxy.json` is a runtime file managed by dev-proxy CLI
commands — it is only needed for worktree port allocation state.

### 3.1 Global config (`~/.dev-proxy/config.json`)

If it exists: read it and only add the current project's absolute path to the
`projects` array. Do not modify domain, ports, or other projects.

If it does not exist:

```bash
mkdir -p ~/.dev-proxy
```

Write `~/.dev-proxy/config.json`:

```json
{
  "domain": "<confirmed domain>",
  "port": 3000,
  "httpsPort": 3443,
  "projects": ["<absolute path to project>"]
}
```

### 3.2 Project config (`dev-proxy.config.js`)

This is the main configuration file. If `dev-proxy.config.js` or
`dev-proxy.config.mjs` already exists, ask the user before overwriting.

Create `dev-proxy.config.js` in the project root with the confirmed routes.
The format must match exactly:

```js
/** @type {import('@reopt-ai/dev-proxy').Config} */
export default {
  routes: {
    api: "http://localhost:4000",
    web: "http://localhost:3001",
    "*": "http://localhost:3001",
  },
};
```

Format rules:

- Keys are subdomain names (strings)
- Values are full URLs: `http://localhost:<port>`
- `"*"` wildcard is optional — only include if the user wants a fallback
- Use double quotes for keys and values
- Include trailing commas
- JSDoc `@type` annotation enables IDE autocomplete via the exported `Config` type

If the user wants **worktree support**, also add `worktreeConfig`:

```js
/** @type {import('@reopt-ai/dev-proxy').Config} */
export default {
  routes: {
    api: "http://localhost:4000",
    web: "http://localhost:3001",
    "*": "http://localhost:3001",
  },
  worktreeConfig: {
    portRange: [4101, 5000],
    directory: "../<project-name>-{branch}",
    services: {
      api: { env: "API_PORT" },
      web: { env: "PORT" },
    },
    envFile: ".env.local",
  },
};
```

Optionally add lifecycle `hooks` for worktree create/destroy:

```js
  worktreeConfig: {
    portRange: [4101, 5000],
    directory: "../<project-name>-{branch}",
    services: {
      "api": { env: "API_PORT" },
      "web": { env: "PORT" },
    },
    envFile: ".env.local",
    hooks: {
      "post-create": "pnpm install",
      "post-remove": "echo cleanup",
    },
  },
```

Ask the user for:

- Port range (default: `[4101, 5000]`)
- Directory pattern (default: `../<project-dirname>-{branch}`)
- For each service: what env variable the app reads for its port
- Post-create hook (e.g., `pnpm install`, `npm install`) — optional
- Post-remove hook — optional

### 3.3 Worktree runtime file (`.dev-proxy.json`) — optional

This file is **only needed when using worktree commands** (`dev-proxy worktree
create/destroy`). It stores allocated port state per branch and is managed
automatically by dev-proxy CLI. Do NOT put routes here — routes belong in
`dev-proxy.config.js`.

If the user enabled worktree support in 3.2, create `.dev-proxy.json`:

```json
{
  "worktrees": {}
}
```

Then add it to `.gitignore` (if not already listed):

```
# dev-proxy worktree runtime state
.dev-proxy.json
```

If the user does not need worktree support, this file can be skipped.
The CLI commands (`dev-proxy project add`, `dev-proxy worktree create`)
will create it automatically when needed.

### 3.4 Framework-specific setup

After generating the dev-proxy config, check if any detected frameworks
require additional configuration to work behind a reverse proxy.

**Next.js (>= 15.0)**: The dev server validates request origins and blocks
requests from unrecognized hosts. Add `allowedDevOrigins` to `next.config.*`:

```js
// next.config.mjs
const nextConfig = {
  allowedDevOrigins: [
    "http://<subdomain>.<domain>:<port>", // e.g. "http://web.localhost:3000"
  ],
};
export default nextConfig;
```

Build the origins list from the confirmed route map:

- For each subdomain that routes to a Next.js service, add
  `http://<subdomain>.<domain>:<proxy-port>` (the proxy port, not the
  upstream port)
- If HTTPS is enabled, also add `https://<subdomain>.<domain>:<httpsPort>`
- If worktree support is enabled, add `http://<branch>--<subdomain>.<domain>:<port>`
  patterns as well (or use a broad pattern if the user prefers)

Always explain to the user why this is needed before modifying their
`next.config.*` file.

---

## Phase 4: DNS Setup

**Skip this entire phase if domain is `localhost`.** Browsers resolve
`*.localhost` to 127.0.0.1 natively — no DNS setup needed.

Detect the platform:

```bash
uname
```

### macOS (dnsmasq)

Check if already installed and configured:

```bash
brew list dnsmasq 2>/dev/null && echo "installed" || echo "not installed"
grep -q "<domain>" "$(brew --prefix)/etc/dnsmasq.conf" 2>/dev/null && echo "configured" || echo "not configured"
```

If not installed:

```bash
brew install dnsmasq
```

If not configured:

```bash
echo "address=/<domain>/127.0.0.1" >> "$(brew --prefix)/etc/dnsmasq.conf"
```

Start/restart and configure resolver:

```bash
sudo brew services restart dnsmasq
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/<domain>
```

> **All `sudo` commands require explicit user confirmation.** Explain what
> each command does before running.

### Linux

`/etc/hosts` does not support wildcards. Add each subdomain individually:

```bash
grep -q "<subdomain>.<domain>" /etc/hosts || \
  echo "127.0.0.1 <subdomain>.<domain>" | sudo tee -a /etc/hosts
```

### Verify DNS

```bash
ping -c 1 <subdomain>.<domain>
```

Should resolve to 127.0.0.1.

---

## Phase 5: TLS Setup

Check if mkcert is installed:

```bash
which mkcert
```

If not installed, provide platform-specific install instructions:

```bash
# macOS
brew install mkcert && mkcert -install

# Linux (Debian/Ubuntu)
sudo apt install mkcert && mkcert -install
```

dev-proxy automatically generates wildcard TLS certificates on first run when
mkcert is available. No manual cert creation is needed.

If the user does not need HTTPS, this phase can be skipped entirely.

---

## Phase 6: Verify

### 6.1 Run diagnostics

```bash
dev-proxy doctor
```

Review the output:

- All green checks (✓) = ready
- Yellow warnings (⚠) for DNS are expected if domain is `localhost`
- Red failures (✗) need to be addressed

### 6.2 Show routing table

```bash
dev-proxy status
```

### 6.3 Print summary

Output the final setup summary:

```
dev-proxy setup complete!

  Config:  <project-path>/dev-proxy.config.js
  Global:  ~/.dev-proxy/config.json
  Domain:  <domain>

  Routes:
    http://web.<domain>:3000 → localhost:3001
    http://api.<domain>:3000 → localhost:4000

  Start the proxy:
    dev-proxy

  Inspect traffic:
    Press Enter in the TUI to open the traffic inspector
```

---

## Rules

- Never overwrite an existing global config — merge by adding the project path to `projects[]`
- Never overwrite an existing `dev-proxy.config.js` without explicit user confirmation
- Never run `sudo` commands without explicit user confirmation
- Always use `http://localhost:<port>` format for route targets (not bare ports)
- The `"*"` wildcard route is optional — only add if the user wants a fallback
- `dev-proxy.config.js` is the primary config file — all routes and worktreeConfig go here
- `.dev-proxy.json` is for worktree runtime state only — do not put routes in it
- `.dev-proxy.json` should be added to `.gitignore` when created (it's machine-specific runtime state)
- `dev-proxy.config.js` should be committed to git (it's project configuration)
- If the project already has a `.dev-proxy.json` with routes (legacy format), suggest running `dev-proxy migrate` to convert to JS config
- Never modify the user's application code, `.env` files, or `package.json`
- Always confirm the proposed route map before writing any files
