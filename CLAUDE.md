# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read and follow [CONTRIBUTING.md](CONTRIBUTING.md) strictly — commit convention, code style, testing rules, and architecture principles all apply.

## Commands

```bash
pnpm check              # Run ALL checks (typecheck + lint + format + test) — run before every commit
pnpm proxy:src          # Run proxy from source via tsx (dev mode)
pnpm proxy              # Build then run from dist/
pnpm test               # Run vitest
pnpm test -- -t "name"  # Run a single test by name
pnpm lint:fix           # Auto-fix ESLint issues
pnpm format             # Auto-fix Prettier formatting
```

Lefthook enforces: commit-msg (conventional commit), pre-commit (typecheck + lint + format), pre-push (test).

## Commit Convention

`<type>(<scope>): <subject>` — max 72 chars, imperative mood, lowercase, no period.

- Types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- Scopes: `proxy`, `store`, `ui`, `config`, `certs`, `routes`, `cli`
- Breaking: `feat!: ...`

## Architecture

**Two-tier event system** — the core design decision:

- **Slim events** (~200 bytes each, max 150 in memory): `SlimRequestEvent | SlimWsEvent` — just enough for the list view
- **Detail data** (headers, cookies, query): stored in a separate LRU map (max 50) — only collected when `isDetailActive()` is true (30s idle timeout)

Split happens at store ingress (`pushHttp`/`pushWs`). Events are immutable after ingress.

**State management**: Module-level variables in `store.ts` + `useSyncExternalStore`. No Redux/context. Mutations are in-place with a `version` counter for change detection. Notifications throttled to ~10fps; user input flushes immediately via `notifySync()`.

**Proxy flow**: `createProxyServer()` → emitter fires `request` / `request:complete` / `request:error` / `ws` → store receives via `pushHttp`/`pushWs` → React renders via snapshot.

**Config**: `~/.dev-proxy/config.json` (global: domain, ports, TLS, `projects` array) → each project's `.dev-proxy.json` (routes + worktrees). No cwd-based search — projects are explicitly registered.

**Routing**: `host.split(".")[0]` extracts subdomain → exact match in merged routes → `"*"` wildcard fallback → `null` (502). Worktree syntax: `branch--app.domain` → lookup in project worktrees → unregistered = offline error page (no silent fallback).

## Critical Invariants

- **Never modify `clientReq` stream lifecycle** — no adding `on("close")`, `on("data")`, or anything that interferes with `clientReq.pipe(proxyReq)`. This is the #1 bug vector. Any change here requires a verified reproduction test.
- **Slim/detail split is non-negotiable** — do not merge them or store full headers in the events array.
- **`selectedIndex` is raw index, not filtered** — snapshot maps it to `filteredIndex` at render time.
- **Noise eviction order** — when MAX_EVENTS exceeded, oldest noise (`/_next/*`, `favicon`) is removed before real requests.
- **Type imports required** — `import type { Foo }` enforced by ESLint; plain import of type-only symbols will fail lint.
- **ESM only** — `"type": "module"`, all imports need `.js` extensions, no `require()`.
- **Never `git push` autonomously** — commit is fine, but push must be explicitly requested by the user.

## CLI Commands

All subcommands are Ink components in `src/commands/`. Shared output primitives (`Header`, `Section`, `Check`, `Row`) in `src/cli/output.tsx`. Shared config I/O and port allocation in `src/cli/config-io.ts`. Routing in `src/cli.ts` (process.argv, no framework). Unknown commands suggest closest match via Levenshtein distance.

`worktree create/destroy` — full lifecycle (git worktree + multi-port allocation + .env.local generation + hooks). `worktree add/remove` — manual single-port registration only. `worktreeConfig.services` maps subdomains to env variable names; `worktree create` allocates one port per service and writes `.env.local`. Worktree entry type is `{ ports: Record<string, number> }` (multi) or `{ port: number }` (legacy). Use `getServicePort(entry, service)` for routing, `getEntryPorts(entry)` for all ports.

To add a new command: create `src/commands/<name>.tsx`, add case to `src/cli.ts`, update help.tsx.

## Testing

Tests co-located with source: `foo.ts` → `foo.test.ts`. Store exposes `__testing` namespace for test access to internals. UI components and CLI commands are tested manually in terminal.
