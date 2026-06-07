# Contributing to secret-safe-env

Thanks for your interest! This is a small, security-focused project, so the bar for changes is "does it keep the guarantee intact and is it tested."

> **The one rule that matters most:** the secret value must never leave the local PowerShell dialog process — not into Node, not into the agent, not into any audited log. If a change could weaken that, it needs a very good reason and new tests proving the value still doesn't leak. See [docs/SPEC.md](./docs/SPEC.md) §2 and [docs/DECISIONS.md](./docs/DECISIONS.md) D1–D4.

## Prerequisites

- **Windows 10/11** — required to run the PowerShell tests and to exercise the dialog. You can edit the TypeScript and run the Node tests on any OS, but `npm run test:ps` / the dialog need Windows.
- **Node.js 18+**.
- **Pester 5** for the PowerShell tests: `Install-Module Pester -MinimumVersion 5.0 -Scope CurrentUser`.

## Setup

```bash
git clone https://github.com/irrenwill/secret-safe-env.git
cd secret-safe-env
npm install
npm run build
```

## Tests & lint — all must pass

```bash
npm test            # Node unit tests (vitest) — handlers, validation, spawn options, token mapping
npm run test:ps     # PowerShell upsert + no-leak tests (Pester 5) — Windows only
npm run lint:ps     # static AST lint over the value-path scripts
```

`npm run test:ps` includes **sentinel** tests that write a known value and assert it never appears on any stream or transcript. `npm run lint:ps` statically forbids cmdlets/members that could route the value to a logged channel. **Do not bypass or weaken these** — they are the proof that the guarantee holds.

## The security invariant (read before touching the value path)

If you modify any of `scripts/dialog.ps1`, `scripts/EnvUpsert.ps1`, `scripts/KeyExists.ps1`, `src/dialogRunner.ts`, `src/keyExists.ts`, or `src/handler.ts`, preserve all of these:

1. The value lives only in `$script:SecretValue` inside the dialog process — **never** a function/cmdlet parameter (event 4103), **never** an output stream (Transcription / 4104).
2. The value is written **only** via `[System.IO.File]`, never a cmdlet/pipeline.
3. The value is **never** used as a regex *pattern* (only the input of a match against a literal pattern).
4. Node passes only the key + path and reads back exactly one fixed status token (`OK` / `CANCEL` / `EXISTS` / `ABSENT` / `ERR:<CODE>`); raw child output is never echoed and stderr is discarded.
5. PowerShell is launched only from the pinned 5.1 path, and the dialog is spawned with `windowsHide: false` (see [docs/DECISIONS.md](./docs/DECISIONS.md) D6–D7).

When in doubt, add a test that proves a value cannot leak through the channel you touched.

## Pull requests

- Branch off `master`; keep each PR focused on one change.
- Run `npm test`, `npm run test:ps`, and `npm run lint:ps` and make sure they pass before opening the PR.
- Describe **what** changed and **why**; if you touched the value path, say how the guarantee is preserved.
- Update the relevant doc (`README*.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`) when behavior or design changes.
- Commit messages: short imperative summary; a `type: subject` prefix (e.g. `fix:`, `feat:`, `docs:`, `ci:`) is appreciated but not required.

## Releases (maintainers)

Releases are automated and token-free, and **go through a pull request** — direct pushes to `master` are blocked by a branch ruleset, and `v*` tags can only be created by maintainers (a tag ruleset).

```bash
# 1. Branch and bump the version (keeps package-lock.json in sync)
git checkout -b release/v<x.y.z>
npm version <x.y.z> --no-git-tag-version
git commit -am "chore: release v<x.y.z>"
git push -u origin release/v<x.y.z>

# 2. Open a PR and merge it into master — this is the review gate
gh pr create --title "chore: release v<x.y.z>" --body "Release v<x.y.z>"
#    ...review, then merge via the UI or: gh pr merge --merge

# 3. Tag the merged commit to trigger publishing (tags cannot go through a PR;
#    the version bump must already be on master, and the tag must match it)
git checkout master && git pull
git tag v<x.y.z> && git push origin v<x.y.z>
```

Step 3's tag push runs `.github/workflows/publish.yml`, which publishes to npm (Trusted Publishing / OIDC) and lists on the MCP Registry (`mcp-publisher` / OIDC). The workflow asserts the tag equals `package.json`'s version. The same version cannot be re-published — if a run half-fails, start a new patch version rather than re-running the tag. Details in [docs/DECISIONS.md](./docs/DECISIONS.md) D13–D16.

## Reporting a security issue

If you find a way for the secret value to leak through any channel, please report it privately to the maintainer (or open a minimal issue describing the channel without including a real secret) rather than posting a working leak publicly.
