---
name: dev-proxy-review
description: |
  Pre-release review for @reopt-ai/dev-proxy. Validates code quality,
  build output, package contents, documentation sync, and commit history
  before pushing to main (which triggers semantic-release automatically).
  Triggers on: "dev-proxy review", "release review", "pre-release check",
  "review", "publish review".
metadata:
  version: 2.0.0
  internal: true
---

# dev-proxy-review Skill

Pre-release review checklist for `@reopt-ai/dev-proxy`. This project uses
**semantic-release** — pushing to `main` automatically handles versioning,
changelog, npm publish, git tag, and GitHub release based on conventional
commits. This skill validates everything is ready before that push.

> **CRITICAL**: Never skip a check. If any step fails, stop and fix before continuing.
> Never `git push` without explicit user confirmation.

---

## Phase 1: Code Quality

Run each command sequentially. If any fails, stop and resolve before continuing.

### 1.1 Run full check suite

```bash
pnpm check
```

This runs `typecheck → lint → format:check → test` in sequence. All must pass with 0 errors.
Warnings are acceptable; errors are not.

### 1.2 Build

```bash
pnpm build
```

Verify `dist/` directory is created with compiled JavaScript files.

### 1.3 Verify binary execution

```bash
node dist/cli.js --version
```

Must print the current version from package.json (e.g., `dev-proxy v1.1.0`).
If it crashes or prints nothing, the build is broken.

### 1.4 Verify package contents

```bash
npm pack --dry-run
```

Confirm the output includes exactly these entries:

- `bin/dev-proxy.js`
- `dist/**/*.js` (compiled source)
- `LICENSE`
- `README.md`
- `README_KO.md`
- `package.json`

It must NOT include: `src/`, `node_modules/`, `.github/`, test files, `tsconfig*.json`.
Check the total package size is reasonable (under 150 kB).

### 1.5 Clean working tree

```bash
git status
```

Working tree must be clean. If there are uncommitted changes:

- If they should be included in this release: commit them first.
- If they are unrelated: stash with `git stash`.

Do NOT proceed with uncommitted changes.

---

## Phase 2: Documentation Sync

Read each file and verify it matches the current code. Fix any discrepancies before proceeding.

### 2.1 CLAUDE.md

Read `CLAUDE.md`. Verify:

- Architecture section describes the actual directory structure in `src/`
- CLI Commands section mentions all commands that exist in `src/commands/`
- Critical Invariants are still accurate

### 2.2 README.md CLI Reference

Read the CLI Reference table in `README.md`. Cross-reference with:

```bash
ls src/commands/*.tsx
```

Every command file must have a corresponding row in the table.
Every row in the table must have a corresponding command file.

### 2.3 README_KO.md CLI Reference

Same check as 2.2 but for the Korean README. The command names and options must match exactly (descriptions are translated).

### 2.4 Installation guide

Read `docs/guide/installation.md`. Verify:

- Config JSON examples match the `RawGlobalConfig` and `RawProjectConfig` interfaces in `src/cli/config-io.ts`
- `worktreeConfig` example matches the `WorktreeConfig` interface
- All CLI commands referenced actually exist

### 2.5 Help text

Read `src/commands/help.tsx`. Verify every command listed there exists in `src/commands/` and is routed in `src/cli.ts`.

If any documentation is outdated, fix it and commit before proceeding.

---

## Phase 3: Commit Review

### 3.1 Review pending commits

Show commits that will trigger semantic-release:

```bash
git log $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~20)..HEAD --oneline --no-decorate
```

### 3.2 Verify conventional commit format

Every commit must follow `<type>(<scope>): <subject>`. Verify:

- All commits use valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Breaking changes use `!` suffix (e.g., `feat!: ...`)
- No commits violate the convention (semantic-release ignores non-conforming commits)

### 3.3 Preview release impact

Based on commit types, inform the user what semantic-release will do:

- `feat` commits → **minor** version bump
- `fix` commits → **patch** version bump
- `feat!` or `BREAKING CHANGE` → **major** version bump
- Only `docs`, `chore`, `ci`, `test`, `style`, `refactor` → **no release** (no releasable commits)

Tell the user:

> These commits will trigger a **[patch|minor|major]** release (current: vX.Y.Z → vX.Y.Z).
> If no `feat` or `fix` commits exist, semantic-release will skip the release.

---

## Phase 4: Push & Verify

### 4.1 Request push confirmation

Ask the user:

> Ready to push to main? semantic-release will automatically handle versioning, changelog, npm publish, and GitHub release.

**Do NOT proceed without explicit "yes" from the user.**

### 4.2 Push to origin

```bash
git push origin main
```

### 4.3 Wait for CI

```bash
gh run list --branch main --limit 1 --json status,conclusion,name
```

The latest run must show `"conclusion": "success"`. If it shows `"status": "in_progress"`, wait and re-check:

```bash
gh run watch
```

**If CI fails, investigate the failure before retrying.**

### 4.4 Verify release was created

If releasable commits were present:

```bash
npm view @reopt-ai/dev-proxy version
gh release list --limit 1
```

Confirm the new version matches the expected bump from step 3.3.

### 4.5 Print summary

Output:

```
Release verified for @reopt-ai/dev-proxy@X.Y.Z

  npm:     https://www.npmjs.com/package/@reopt-ai/dev-proxy
  release: https://github.com/reopt-ai/dev-proxy/releases/tag/vX.Y.Z
```

If no release was triggered (no releasable commits):

```
Push complete. No releasable commits — semantic-release skipped.
```

---

## Rollback

If something goes wrong after release:

### Unpublish npm package (within 72 hours only)

```bash
npm unpublish @reopt-ai/dev-proxy@X.Y.Z
```

### Delete GitHub Release and tag

```bash
gh release delete vX.Y.Z --yes --cleanup-tag
```

### Revert and re-release

```bash
git revert HEAD
git push origin main
```

This will trigger a new semantic-release with the revert commit.

---

## Rules

- Never skip phases or reorder steps
- Never push without explicit user confirmation
- If any check fails, stop and fix before moving to the next step
- Do not manually edit package.json version — semantic-release owns versioning
- Do not manually create git tags — semantic-release owns tagging
- Do not run `npm publish` manually — CI handles this
- Changelog must be based on actual git commits, never invented
- Do not manually edit CHANGELOG.md — semantic-release generates it; manual edits cause merge conflicts on next release
- Do not force push to main — breaks semantic-release tag history and can cause duplicate or skipped releases
- Do not use `--no-verify` on push — bypasses pre-push hooks (test suite)
- Do not rebase or amend commits already pushed to main — can cause duplicate releases or orphaned tags
