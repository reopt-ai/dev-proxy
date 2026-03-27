# Changelog

## 1.1.0 (2026-03-27)

### Features

- add worktree diagnostics to doctor command
- multi-port worktree services with .env.local generation
- add worktree create/destroy lifecycle commands

### Documentation

- improve LLM installation guide clarity and edge cases
- add LLM agent installation guide
- add CLI, worktree lifecycle, and LLM guide changelog entries

### Maintenance

- add publish skill and no-autonomous-push rule
- exclude .tsbuildinfo from npm package

## 1.0.0 (2026-03-26)

Initial open-source release.

### Features

- Subdomain-based reverse proxy with HTTP and HTTPS support
- Real-time HTTP/WS traffic inspector TUI (Ink + React)
- Request/response header, cookie, and query parameter inspection
- Noise filtering (Next.js static assets, favicon)
- Error-only mode
- URL/method search filtering
- Request replay and curl copy to clipboard
- Worktree lifecycle management: `worktree create/destroy` with auto port allocation and hooks
- Worktree-based dynamic routing (`branch--app.domain`)
- Full CLI: `init`, `status`, `doctor`, `config`, `project`, `worktree`, `--help`, `--version`
- LLM agent installation guide (`docs/guide/installation.md`)
- Auto-generated TLS certificates via mkcert
- Project-based config: global (`~/.dev-proxy/config.json`) + per-project (`.dev-proxy.json`)
- Wildcard route (`"*"`) for unmatched subdomain fallback
