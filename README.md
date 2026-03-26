# dev-proxy

[![CI](https://github.com/reopt-ai/dev-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/reopt-ai/dev-proxy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen.svg)](https://nodejs.org)

**Subdomain-based reverse proxy with a real-time HTTP/WS traffic inspector TUI.**

Routes `*.{domain}:3000` requests to local services by subdomain and displays all traffic in a terminal dashboard. Think of it as a lightweight, terminal-native alternative to tools like Charles or Proxyman — purpose-built for local multi-service development.

[한국어 문서 (Korean)](README_KO.md)

![dev-proxy screenshot](docs/screenshot.png)

## Why dev-proxy?

When developing with multiple local services (frontend, API, auth, docs, admin...), you need a way to route requests by subdomain and see what's happening. Existing options are either too heavy (nginx, Caddy) or GUI-only (Charles, Proxyman).

dev-proxy is:

- **Zero-config start** — Works out of the box with `localhost` and auto-generated TLS certs
- **Terminal-native** — No browser windows to manage; lives where you already work
- **Vim-style navigation** — `j`/`k` to browse, `/` to search, `r` to replay
- **Worktree-aware** — Routes `branch--app.domain` to per-worktree ports automatically
- **Lightweight** — Two runtime dependencies (`ink` + `react`), ~10fps throttled rendering

## Features

- Real-time HTTP request/response monitoring (method, status, size, latency)
- WebSocket connection tracking (OPEN / CLOSED / ERROR)
- Request/response header, cookie, and query parameter inspection
- Noise filter (`_next/`, `favicon`), error-only mode, URL/method search
- Request replay with original headers and curl copy to clipboard
- Upstream `http`/`https` and `ws`/`wss` target support
- Git worktree-based dynamic routing via `.worktrees.json`
- Auto-generated TLS certificates via [mkcert](https://github.com/FiloSottile/mkcert)
- Three-tier config: defaults → global → per-project

## Prerequisites

- **Node.js** >= 20.11
- **mkcert** _(optional, for HTTPS)_ — `brew install mkcert && mkcert -install`

## Quick Start

```bash
# 1. Install
npm install -g dev-proxy

# 2. Create a config (optional — works without one using localhost defaults)
mkdir -p ~/.dev-proxy
cat > ~/.dev-proxy/config.json << 'EOF'
{
  "domain": "example.dev",
  "routes": {
    "www": "http://localhost:3001",
    "api": "http://localhost:4000"
  }
}
EOF

# 3. Run
dev-proxy
```

Press **Enter** to arm the inspector, then open `http://www.example.dev:3000` in your browser.

## Install

```bash
# npx (no install)
npx dev-proxy

# Global install
npm install -g dev-proxy

# From source
git clone https://github.com/reopt-ai/dev-proxy.git
cd dev-proxy && pnpm install && pnpm proxy
```

## Configuration

Config is loaded in three layers (later layers override earlier ones):

1. **Defaults** — `domain: "localhost"`, `port: 3000`, `httpsPort: 3443`
2. **`~/.dev-proxy/config.json`** — Global user config
3. **`.proxy.json`** — Per-project override (searched from cwd upward)

### Global Config (`~/.dev-proxy/config.json`)

```json
{
  "domain": "example.dev",
  "port": 3000,
  "httpsPort": 3443,
  "defaultTarget": "http://localhost:3001",
  "routes": {
    "www": "http://localhost:3001",
    "studio": "http://localhost:3001",
    "api": "http://localhost:4000",
    "docs": "http://localhost:3003",
    "admin": "http://localhost:3002"
  }
}
```

### Project Override (`.proxy.json`)

Place a `.proxy.json` in your project root to override global config. JSON parse errors, invalid ports, and unsupported URL protocols are warned at startup and ignored.

```json
{
  "routes": {
    "api": "http://localhost:4000",
    "oauth": "https://localhost:9443"
  },
  "certPath": "certs/dev+1.pem",
  "keyPath": "certs/dev+1-key.pem"
}
```

> `certPath`/`keyPath` are resolved relative to the `.proxy.json` file location.

### HTTPS

Certificates are stored in `~/.dev-proxy/certs/`. If missing, they are auto-generated using [mkcert](https://github.com/FiloSottile/mkcert).

```bash
brew install mkcert
mkcert -install
```

When mkcert is installed, dev-proxy automatically generates wildcard certificates on first run. No manual steps needed.

### Worktree Routing

dev-proxy supports git worktree-based dynamic routing. When you use `branch--app.domain` as the hostname, it routes to a per-worktree port.

**How it works:**

1. A `.worktrees.json` file maps branch names to ports:

```json
{
  "worktrees": {
    "feature-auth": { "port": 3101 },
    "fix-nav": { "port": 3102 }
  },
  "nextPort": 3103
}
```

2. Access `feature-auth--www.example.dev:3000` and it routes to `localhost:3101`
3. The file is watched live — add/remove entries and routing updates instantly

This lets multiple worktree checkouts run simultaneously on different ports without config changes.

## Usage

```bash
# If installed globally or via npx
dev-proxy

# From source
pnpm proxy

# Debug mode (tsx, no build step)
pnpm proxy:src
```

`pnpm proxy` builds `dist/` first, then runs with `NODE_ENV=production` to avoid Ink/React dev-mode memory leaks.

### UI States

The TUI has three states:

1. **Splash** — Shows configured routes and listening ports. Press **Enter** to arm.
2. **Inspect** — Live traffic dashboard with list + detail panels.
3. **Standby** — Auto-sleeps after 60s of no interaction to reduce memory pressure. Press **I** or **Enter** to resume.

## Keybindings

### Navigation

| Key       | Action                      |
| --------- | --------------------------- |
| `←` / `→` | Switch list / detail focus  |
| `j` / `↓` | Next request                |
| `k` / `↑` | Previous request            |
| `g`       | Jump to first               |
| `G`       | Jump to last                |
| `Enter`   | Open detail panel           |
| `Esc`     | Back to list / clear search |

### Detail Panel

| Key       | Action |
| --------- | ------ |
| `↑` / `↓` | Scroll |

> Focusing the detail panel automatically disables Follow mode so your selection stays put.

### Filters & Actions

| Key | Action                                     |
| --- | ------------------------------------------ |
| `/` | Search mode (filter by URL or method)      |
| `f` | Toggle Follow mode                         |
| `n` | Toggle noise filter (`_next`, `favicon`)   |
| `e` | Toggle error-only mode                     |
| `x` | Clear all traffic and filters              |
| `r` | Replay selected request (with headers)     |
| `y` | Copy selected request as curl to clipboard |

### Mouse

- **Scroll** in list or detail panel
- **Click** a row to select it
- **Click** header filter badges to toggle them

## Security

This is a **development tool** and makes deliberate trade-offs for local development convenience:

- **`rejectUnauthorized: false`** — The proxy accepts self-signed certificates from upstream targets. This is intentional so that dev services using mkcert or self-signed certs work without extra configuration. **Do not use this proxy in production.**
- **No authentication** — The proxy binds to localhost by default with no auth layer.

## Troubleshooting

### Port already in use

```
Error: port 3000 is already in use (another dev-proxy instance may already be running)
```

Kill the existing process or use a different port in your config:

```bash
# Find and kill
lsof -ti :3000 | xargs kill

# Or change port
echo '{ "port": 3080 }' > .proxy.json
```

### mkcert not found

```
HTTPS disabled — mkcert not found.
```

HTTPS is optional. Install mkcert for TLS support:

```bash
brew install mkcert    # macOS
mkcert -install
```

### Blank screen / Raw mode error

If you see `Raw mode is not supported`, you're running in a non-TTY context (e.g., piped output, CI). dev-proxy requires an interactive terminal.

### Request not routing to expected target

1. Check the splash screen — it lists all configured routes
2. Verify your `Host` header matches `subdomain.domain:port`
3. Ensure the target service is actually running on the configured port

## Architecture

```
src/
├── index.tsx              # Entry (Ink render + proxy lifecycle)
├── store.ts               # External store (useSyncExternalStore)
├── proxy/
│   ├── config.ts          # Config loader (~/.dev-proxy + .proxy.json)
│   ├── server.ts          # HTTP/WS reverse proxy
│   ├── routes.ts          # Subdomain → target routing
│   ├── certs.ts           # TLS certificate resolution (mkcert)
│   ├── worktrees.ts       # Dynamic worktree port registry
│   └── types.ts           # Event types
├── components/
│   ├── app.tsx             # Root (resize, keyboard, state machine)
│   ├── splash.tsx          # Splash screen
│   ├── status-bar.tsx      # Top status bar
│   ├── request-list.tsx    # Request list (viewport slicing)
│   ├── detail-panel.tsx    # Detail panel (scrollable)
│   └── footer-bar.tsx      # Bottom keybinding hints
├── hooks/
│   └── use-mouse.ts        # SGR mouse event parser
└── utils/
    ├── format.ts           # Color palette, formatters
    └── list-layout.ts      # Responsive column layout
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
