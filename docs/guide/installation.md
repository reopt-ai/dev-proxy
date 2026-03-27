# dev-proxy Installation Guide (for LLM Agents)

This guide is designed for AI coding agents (Claude Code, Cursor, Copilot, etc.) to install and configure dev-proxy non-interactively. Follow each step in order.

## Prerequisites

Check Node.js version:

```bash
node -v
# Must be >= 20.11.0. If not, ask the user to upgrade.
```

## Step 1: Install

```bash
npm install -g @reopt-ai/dev-proxy
```

Verify:

```bash
dev-proxy --version
```

## Step 2: Gather Information

Ask the user the following questions before proceeding:

1. **Domain** — What domain do you want to use? (e.g., `myapp.dev`, `example.local`). Use `localhost` if unsure.
2. **Project path** — Absolute path to the project directory (e.g., `/Users/me/projects/myapp`).
3. **Routes** — Which subdomains should map to which local ports? Example:
   - `www` → `3001` (frontend)
   - `api` → `4000` (backend)
   - `admin` → `3002` (admin panel)
4. **Default port** — Should unmatched subdomains fall back to a default port? (optional)

## Step 3: Create Global Config

Create `~/.dev-proxy/config.json`:

```bash
mkdir -p ~/.dev-proxy
```

Write the file with the user's answers. Replace `DOMAIN`, `PROJECT_PATH`:

```json
{
  "domain": "DOMAIN",
  "port": 3000,
  "httpsPort": 3443,
  "projects": ["PROJECT_PATH"]
}
```

## Step 4: Create Project Config

Write `.dev-proxy.json` in the project root (`PROJECT_PATH/.dev-proxy.json`).

Build the routes object from the user's answers. Include `"*"` wildcard if they provided a default port:

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

## Step 5: DNS Setup

**Skip this step if domain is `localhost`.**

Detect the operating system and set up DNS resolution:

### macOS

Recommended approach using dnsmasq (supports wildcard subdomains):

```bash
brew install dnsmasq
echo "address=/DOMAIN/127.0.0.1" >> $(brew --prefix)/etc/dnsmasq.conf
sudo brew services start dnsmasq
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/DOMAIN
```

> **Note:** The `sudo` commands require user confirmation. Explain what each command does before running.

### Linux

Add entries to `/etc/hosts` for each subdomain:

```bash
# For each subdomain in routes (excluding "*"):
echo "127.0.0.1 www.DOMAIN" | sudo tee -a /etc/hosts
echo "127.0.0.1 api.DOMAIN" | sudo tee -a /etc/hosts
```

> **Note:** Linux `/etc/hosts` does not support wildcards. Each subdomain must be added individually.

### Verify DNS

```bash
ping -c 1 www.DOMAIN
# Should show "127.0.0.1"
```

## Step 6: HTTPS Setup (Optional)

Check if mkcert is installed:

```bash
which mkcert
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

Run the environment diagnostic:

```bash
dev-proxy doctor
```

This checks: config files, DNS resolution, TLS setup, and port availability. All checks should pass (DNS warnings are expected if Step 5 was skipped).

## Step 8: Start

```bash
dev-proxy
```

The proxy is now running. Access services at:

- `http://www.DOMAIN:3000` (HTTP)
- `https://www.DOMAIN:3443` (HTTPS, if mkcert was set up)

Press **Enter** in the TUI to activate the traffic inspector.

## Adding More Projects Later

```bash
dev-proxy project add /path/to/another/project
```

Then create `.dev-proxy.json` in that project with its routes.

## Adding Worktrees

For git worktree workflows, add to the project's `.dev-proxy.json`:

```json
{
  "routes": { "...": "..." },
  "worktrees": {
    "feature-branch": { "port": 4001 }
  }
}
```

Access via: `feature-branch--www.DOMAIN:3000`

## Troubleshooting

If something doesn't work, run:

```bash
dev-proxy doctor
```

Common issues:

- **DNS not resolving**: Re-run Step 5, verify with `ping`
- **Port in use**: Another process is on port 3000. Check with `lsof -ti :3000`
- **HTTPS not working**: Ensure mkcert is installed and run `mkcert -install`
