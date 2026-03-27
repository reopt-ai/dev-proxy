# dev-proxy Installation Guide (for LLM Agents)

This guide is designed for AI coding agents (Claude Code, Cursor, Copilot, etc.) to install and configure dev-proxy non-interactively. Follow each step in order. All placeholders (like `DOMAIN`) must be replaced with actual values from the user.

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
5. **Worktree support** — Does the project use git worktrees? If yes, ask for a port range (e.g., `4001-5000`) and directory pattern (e.g., `../myproject-{branch}`).

## Step 3: Create Global Config

If `~/.dev-proxy/config.json` already exists, read it first and only add the new project path to the `projects` array. Do not overwrite existing domain/port settings.

If it does not exist, create it:

```bash
mkdir -p ~/.dev-proxy
```

Then write `~/.dev-proxy/config.json` — replace the placeholder values with the user's answers from Step 2:

```json
{
  "domain": "<user's domain, e.g. myapp.dev>",
  "port": 3000,
  "httpsPort": 3443,
  "projects": ["<absolute path to project>"]
}
```

## Step 4: Create Project Config

Write `<project path>/.dev-proxy.json`. This file goes inside the project directory, not in `~/.dev-proxy/`.

If the file already exists, read it first and merge — do not overwrite existing routes or worktrees.

Build the content from the user's answers. All values below are examples — replace with actual values:

```json
{
  "routes": {
    "www": "http://localhost:3001",
    "api": "http://localhost:4000",
    "*": "http://localhost:3001"
  },
  "worktrees": {}
}
```

Only include the `"*"` entry if the user provided a default port in Step 2.

If the user wants worktree support, also add `worktreeConfig` (this goes in the same `.dev-proxy.json` file, not a separate file):

```json
{
  "routes": { "...": "..." },
  "worktrees": {},
  "worktreeConfig": {
    "portRange": [4001, 5000],
    "directory": "../<project-name>-{branch}",
    "hooks": {
      "post-create": "<install command, e.g. pnpm install>",
      "post-remove": "echo cleanup"
    }
  }
}
```

The `{branch}` placeholder in `directory` is replaced with the branch name at runtime.

## Step 5: DNS Setup

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

## Step 6: HTTPS Setup (Optional)

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

## Step 7: Verify Installation

```bash
dev-proxy doctor
```

This checks config files, DNS resolution, TLS setup, and port availability. Review the output:

- All green checks (✓) = ready
- Yellow warnings (⚠) for DNS are expected if domain is `localhost`
- Red failures (✗) need to be addressed before proceeding

## Step 8: Start

dev-proxy runs as a **foreground process** with a terminal UI. It will take over the terminal until stopped with Ctrl+C.

```bash
dev-proxy
```

The proxy is now running. Access services at:

- `http://www.<domain>:3000` (HTTP)
- `https://www.<domain>:3443` (HTTPS, if mkcert was set up)

Press **Enter** in the TUI to activate the traffic inspector.

To run in the background, use a terminal multiplexer or a separate terminal tab.

## Managing Projects

Add another project (this also creates an empty `.dev-proxy.json` template if one doesn't exist):

```bash
dev-proxy project add /path/to/another/project
```

Then edit that project's `.dev-proxy.json` to add routes as described in Step 4.

List all registered projects:

```bash
dev-proxy project list
```

## Managing Worktrees

Requires `worktreeConfig` in the project's `.dev-proxy.json` (see Step 4).

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

- **DNS not resolving** — Re-run Step 5. On macOS, try `sudo dscacheutil -flushcache`. Verify with `ping www.<domain>`.
- **Port in use** — Check with `lsof -ti :3000`. Kill the process or change the port via `dev-proxy config set port 3080`.
- **HTTPS not working** — Ensure mkcert is installed (`which mkcert`) and the local CA is set up (`mkcert -install`).
- **Config not loading** — Run `dev-proxy status` to see what config is actually loaded. Check file paths and JSON syntax.
