---
name: dev-proxy-publish
description: |
  Publish @reopt-ai/dev-proxy to npm with pre-flight checks, version bump,
  changelog generation, and post-publish verification.
  Triggers on: "dev-proxy publish", "release dev-proxy", "npm publish",
  "publish", "release".
metadata:
  version: 1.0.0
---

# dev-proxy-publish Skill

Publish `@reopt-ai/dev-proxy` to the public npm registry with a comprehensive
pre-flight checklist. Every step must pass before proceeding to the next phase.

> **CRITICAL**: Never skip a check. If any step fails, stop and fix before continuing.
> Never `git push` or `npm publish` without explicit user confirmation.

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

Must print the current version from package.json (e.g., `dev-proxy v1.0.0`).
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

## Phase 2: Version & Changelog

### 2.1 Determine release type

Ask the user:

> What type of release is this? **patch** (bug fixes), **minor** (new features), or **major** (breaking changes)?

### 2.2 Read current version

```bash
node -e "console.log(require('./package.json').version)"
```

### 2.3 Compute next version

Apply semver bump to the current version:

- patch: `1.0.0` → `1.0.1`
- minor: `1.0.0` → `1.1.0`
- major: `1.0.0` → `2.0.0`

### 2.4 Update package.json

Edit the `"version"` field in `package.json` to the new version. Do not change any other field.

### 2.5 Generate changelog entry

Get commits since last tag:

```bash
git log $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~20)..HEAD --oneline --no-decorate
```

Group commits by conventional commit type:

- `feat` → **Features**
- `fix` → **Bug Fixes**
- `refactor` → **Refactoring**
- `docs` → **Documentation**
- `chore`, `build`, `ci` → **Maintenance**
- `test` → **Tests**
- `perf` → **Performance**

### 2.6 Write CHANGELOG.md

Read the existing CHANGELOG.md. Insert a new section at the top (below the `# Changelog` heading) with this format:

```markdown
## X.Y.Z (YYYY-MM-DD)

### Features

- commit message here
- commit message here

### Bug Fixes

- commit message here
```

Only include sections that have commits. Omit empty sections.
Use today's date in YYYY-MM-DD format.

---

## Phase 3: Documentation Sync

Read each file and verify it matches the current code. Fix any discrepancies before proceeding.

### 3.1 CLAUDE.md

Read `CLAUDE.md`. Verify:

- Architecture section describes the actual directory structure in `src/`
- CLI Commands section mentions all commands that exist in `src/commands/`
- Critical Invariants are still accurate

### 3.2 README.md CLI Reference

Read the CLI Reference table in `README.md`. Cross-reference with:

```bash
ls src/commands/*.tsx
```

Every command file must have a corresponding row in the table.
Every row in the table must have a corresponding command file.

### 3.3 README_KO.md CLI Reference

Same check as 3.2 but for the Korean README. The command names and options must match exactly (descriptions are translated).

### 3.4 Installation guide

Read `docs/guide/installation.md`. Verify:

- Config JSON examples match the `RawGlobalConfig` and `RawProjectConfig` interfaces in `src/cli/config-io.ts`
- `worktreeConfig` example matches the `WorktreeConfig` interface
- All CLI commands referenced actually exist

### 3.5 Help text

Read `src/commands/help.tsx`. Verify every command listed there exists in `src/commands/` and is routed in `src/cli.ts`.

If any documentation is outdated, fix it and commit before proceeding.

---

## Phase 4: Commit, Tag, Push, Publish

### 4.1 Commit release

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release vX.Y.Z"
```

If documentation was updated in Phase 3, include those files in the commit:

```bash
git add package.json CHANGELOG.md CLAUDE.md README.md README_KO.md docs/guide/installation.md
git commit -m "chore: release vX.Y.Z"
```

### 4.2 Create git tag

```bash
git tag vX.Y.Z
```

### 4.3 Request push confirmation

Ask the user:

> Ready to push vX.Y.Z to origin and publish to npm?

**Do NOT proceed without explicit "yes" from the user.**

### 4.4 Push to origin

```bash
git push origin main
git push origin vX.Y.Z
```

### 4.5 Wait for CI

```bash
gh run list --branch main --limit 1 --json status,conclusion,name
```

The latest run must show `"conclusion": "success"`. If it shows `"status": "in_progress"`, wait and re-check:

```bash
gh run watch
```

**Do NOT publish if CI has not passed.**

### 4.6 Publish to npm

```bash
npm publish --access public
```

The `prepublishOnly` script runs `pnpm build` automatically. Verify the output shows:

```
+ @reopt-ai/dev-proxy@X.Y.Z
```

### 4.7 Create GitHub Release

Extract the changelog section for this version and use it as release notes:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(cat <<'NOTES'
<paste the changelog section for this version here, including ### headers>
NOTES
)"
```

Use the exact content written to CHANGELOG.md in step 2.6. Do not invent or paraphrase.

---

## Phase 5: Post-publish Verification

### 5.1 Verify npm package

```bash
npm view @reopt-ai/dev-proxy version
```

Must print `X.Y.Z`.

### 5.2 Verify executable

```bash
npx @reopt-ai/dev-proxy@X.Y.Z --version
```

Must print `dev-proxy vX.Y.Z`.

### 5.3 Verify GitHub Release

```bash
gh release view vX.Y.Z --json tagName,name,url
```

Must show the correct tag and URL.

### 5.4 Print summary

Output:

```
Published @reopt-ai/dev-proxy@X.Y.Z

  npm:     https://www.npmjs.com/package/@reopt-ai/dev-proxy
  release: https://github.com/reopt-ai/dev-proxy/releases/tag/vX.Y.Z
```

---

## Rollback

If something goes wrong after publish:

### Unpublish npm package (within 72 hours only)

```bash
npm unpublish @reopt-ai/dev-proxy@X.Y.Z
```

### Remove git tag

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

### Delete GitHub Release

```bash
gh release delete vX.Y.Z --yes
```

### Revert version commit

```bash
git revert HEAD
git push origin main
```

---

## Rules

- Never skip phases or reorder steps
- Never push or publish without explicit user confirmation
- If any check fails, stop and fix before moving to the next step
- Release commit must use: `chore: release vX.Y.Z`
- Changelog must be based on actual git commits, never invented
- Package version in package.json, git tag, and npm version must all match
