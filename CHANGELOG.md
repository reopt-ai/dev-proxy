# Changelog

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
- Worktree-based dynamic routing (`branch--app.domain`)
- Auto-generated TLS certificates via mkcert
- Three-tier config: defaults, global (`~/.dev-proxy/config.json`), project (`.proxy.json`)
