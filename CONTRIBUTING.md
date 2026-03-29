# Contributing to dev-proxy

dev-proxy에 기여해 주셔서 감사합니다.

## Development Setup

```bash
git clone https://github.com/reopt-ai/dev-proxy.git
cd dev-proxy
pnpm install
```

## Scripts

| Command           | Description                                       |
| ----------------- | ------------------------------------------------- |
| `pnpm proxy`      | Build and run the proxy                           |
| `pnpm proxy:src`  | Run directly from source (tsx)                    |
| `pnpm check`      | Run all checks (typecheck + lint + format + test) |
| `pnpm test`       | Run tests                                         |
| `pnpm test:watch` | Run tests in watch mode                           |
| `pnpm lint:fix`   | Auto-fix lint issues                              |
| `pnpm format`     | Format all files                                  |

## Before Submitting a PR

Run the full check suite:

```bash
pnpm check
```

This runs `typecheck`, `eslint`, `prettier --check`, and `vitest` in sequence. All must pass.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/). This is enforced by a `commit-msg` hook via lefthook. Commit types directly drive **automated releases** via [semantic-release](https://github.com/semantic-release/semantic-release):

- `fix` → **patch** release (1.0.0 → 1.0.1)
- `feat` → **minor** release (1.0.0 → 1.1.0)
- `feat!` or `BREAKING CHANGE` footer → **major** release (1.0.0 → 2.0.0)
- `docs`, `chore`, `ci`, `test`, `style`, `refactor` → no release

```
<type>(<scope>): <subject>
```

- **Types**: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- **Scope** (optional): module name — `proxy`, `store`, `ui`, `config`, `certs`, `routes`
- **Subject**: imperative mood, lowercase, no period, max 72 chars total
- **Breaking changes**: append `!` after type/scope — `feat!: drop Node 18 support`

Examples:

```
feat(proxy): add request body capture for replay
fix(store): prevent stale detail after LRU eviction
test(routes): add getTarget fallback coverage
docs: translate README to English
chore: update dependencies
```

## Code Style

- TypeScript strict mode — no `any`, no implicit returns
- Prettier for formatting (config in `.prettierrc`)
- ESLint with `typescript-eslint` strict type-checked (config in `eslint.config.js`)
- No runtime dependencies beyond `ink` and `react`
- Comments in English — code, commit messages, and PR descriptions are all in English
- Comments explain **why**, not what — don't restate the code
- No dead code, no `TODO` without a linked issue

## Architecture

See the [Architecture section in README.md](README.md#architecture) for an overview of the codebase.

Key principles:

- **Slim events** (~200 bytes) for the list view, heavy detail in a separate LRU cache
- **Throttled rendering** (~10fps) to keep the terminal responsive under traffic
- **useSyncExternalStore** for React integration without external state libraries
- **No client request mutation** — the proxy must not add, remove, or reorder code that changes `clientReq` stream lifecycle (pipe, on("close"), etc.) without a verified reproduction test

## Testing

- Tests live next to source files: `foo.ts` → `foo.test.ts`
- Use `vitest` — `describe`/`it`/`expect` style
- UI components are tested manually in terminal; core logic (store, routes, config) has unit tests
- When fixing a bug, add a regression test first

### Writing Tests

**Setup**: All tests share a global setup (`src/__test-utils__/setup.ts`) that silences `console.log/error/warn` and calls `vi.restoreAllMocks()` after each test. You don't need to add these yourself.

**Mocking external modules**:

```typescript
// Define mock before imports (vi.mock is hoisted)
vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(), readFileSync: vi.fn() },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Import after mocks
const { myFunction } = await import("./my-module.js");
```

**Resetting mocks between tests**: Use `.mockReset()` on individual mocks in `beforeEach`. Do NOT use `vi.resetAllMocks()` or `vi.restoreAllMocks()` — the global setup handles restoration.

```typescript
beforeEach(() => {
  fsMock.existsSync.mockReset();
  fsMock.readFileSync.mockReset();
});
```

**Testing internal functions**: If a module has `__testing`, import it:

```typescript
const { __testing } = await import("./module.js");
const { internalFn } = __testing;
```

## Releases

Releases are fully automated. When commits are pushed to `main`, [semantic-release](https://github.com/semantic-release/semantic-release) runs in CI and:

1. Determines the next version from commit messages
2. Updates `CHANGELOG.md` and `package.json`
3. Publishes to npm
4. Creates a GitHub Release with release notes

**Do not** manually edit `package.json` version, create git tags, edit `CHANGELOG.md`, or run `npm publish`. The CI pipeline owns all of these.

## Reporting Issues

Use [GitHub Issues](https://github.com/reopt-ai/dev-proxy/issues). Include:

- Node.js version (`node -v`)
- Terminal emulator and OS
- Steps to reproduce
