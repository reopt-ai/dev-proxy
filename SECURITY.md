# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities through [GitHub Security Advisories](https://github.com/reopt-ai/dev-proxy/security/advisories/new) (private disclosure).

**Do not** open a public issue for security vulnerabilities.

### Response Timeline

- **Acknowledgment**: within 48 hours
- **Patch target**: within 7 days for confirmed vulnerabilities

### Scope

dev-proxy is a **local development tool** — it is not designed or intended to be deployed as production infrastructure. Certain design decisions reflect this:

- Self-signed TLS certificates are generated intentionally for local HTTPS development
- `rejectUnauthorized: false` is used by design to proxy to local dev servers with self-signed certs
- The TUI inspector displays request/response data on the local terminal only

Security reports should focus on vulnerabilities that could affect developers using the tool in their local environment (e.g., arbitrary code execution, credential leakage, supply chain risks).
