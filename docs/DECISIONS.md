# secret-safe-env — Design decisions

A log of the load-bearing decisions and *why* they are the way they are. Format: **Decision → Rationale → Consequence**.

## Security model

### D1. The secret value never enters the Node/agent process
**Rationale:** the whole point is that the agent (and the model's context/transcripts) never holds the secret. **Consequence:** Node only spawns PowerShell with the key + path and reads a fixed status token; everything value-bearing lives in PowerShell. This shapes every other decision below.

### D2. The value never crosses a PowerShell parameter boundary
**Rationale:** PowerShell Module Logging (event 4103) records parameter binding; a value passed as a parameter would be logged. **Consequence:** the value lives in `$script:SecretValue` and is consumed internally by `Render-CurrentLine`/`Write-EnvFile`, never passed as an argument. Existing `.env` lines (which may contain a *prior* value) are passed by type as `[string[]]` — recorded by type, not expanded — and a pre-existing on-disk value is explicitly out of scope.

### D3. The value is written only via `[System.IO.File]`, never a cmdlet; never used as a regex pattern
**Rationale:** cmdlets/pipelines/output streams are auditable (Transcription, 4104); using the value as a regex *pattern* would surface it in script-block logs. **Consequence:** writes go through `[System.IO.File]::WriteAllText`; key matching uses the value only as the *input* of `-match` against a literal, escaped pattern. A static AST lint (`lint-value-path.ps1`) and Pester sentinel tests enforce both.

### D4. Fixed status-token enum; child stdout never echoed; stderr discarded
**Rationale:** any free-form passthrough of child output could leak a value or diagnostic. **Consequence:** PowerShell emits exactly one of `OK` / `CANCEL` / `EXISTS` / `ABSENT` / `ERR:<CODE>`; Node validates against an allow-list and maps unrecognised output to a generic `INTERNAL`. The spawn uses `stdio: ['ignore','pipe','ignore']`.

## Platform

### D5. Windows-only, by design
**Rationale:** the trust anchor is a native masked dialog + Windows PowerShell; there is no equivalent we trust cross-platform. **Consequence:** non-Windows returns `UNSUPPORTED_PLATFORM` and refuses. We deliberately did **not** add an `os: ["win32"]` field to `package.json`, so the package still installs everywhere (e.g. for inspection) and fails with a clear *runtime* message rather than a hard `EBADPLATFORM` install error.

### D6. Pin Windows PowerShell 5.1 by absolute path; never use `pwsh`/PATH
**Rationale:** a `pwsh` 7+ on `PATH` has a different execution/logging surface; PATH resolution is non-deterministic. **Consequence:** PowerShell is launched only from `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`; if it is missing, the spawn throws (surfaced as an error, not a silent fallback).

### D7. `windowsHide: false` for the dialog spawn
**Rationale:** Node's `windowsHide` sets `SW_HIDE` on the child's `STARTUPINFO`; a console process's **first GUI window** inherits that state — making the dialog itself invisible (a real bug we hit). **Consequence:** the child is spawned visible, and `dialog.ps1` hides only its *own console window* by handle, leaving the dialog on-screen.

## MCP shape

### D8. `set_env_secret` has no `outputSchema`; `env_key_exists` does
**Rationale:** the MCP SDK requires schema-valid `structuredContent` on every non-error return when `outputSchema` is set — clumsy for a tool whose "output" is guidance text. `env_key_exists`, by contrast, has a clean typed result. **Consequence:** `set_env_secret` returns rich `text` + `isError`; `env_key_exists` returns `{ exists: boolean }`.

### D9. `env_key_exists` is PowerShell-backed, not "Node reads `.env`"
**Rationale:** keep the property that **Node never reads `.env` contents**. **Consequence:** existence checks run in `KeyExists.ps1`/`Test-KeyExists`; only a boolean crosses to Node. It exists so the agent has a safe verify channel instead of `cat .env`.

### D10. Trigger-first, anti-pattern-explicit guidance for cold agents
**Rationale:** a zero-context agent must know *when* to reach for this and *what not to do*. **Consequence:** the server `instructions` and each tool `description` lead with natural-language triggers ("add my OpenAI key"…) and forbid paste-in-chat / writing the value / `cat .env`. Result text includes the next step.

### D11. `env_path` defaults to `CLAUDE_PROJECT_DIR ?? cwd`, but agents should pass it
**Rationale:** a runner-launched MCP server's `cwd` is the runner sandbox, not the user's project, so a bare `./.env` default would write to the wrong place. **Consequence:** the default prefers `CLAUDE_PROJECT_DIR`; the schema tells the agent to pass the absolute project `.env` path explicitly.

### D12. Single-line values only
**Rationale:** the masked dialog is a single-line field; multi-line PEM/JSON would complicate the UI and the `.env` quoting rules. **Consequence:** values are single-line; for blobs the agent tells the user to edit `.env` manually.

## Distribution

### D13. Distribute via `npm publish`, not a GitHub git-dependency
**Rationale:** `npm i -g github:...` runs `prepare` but does **not** install devDependencies on Node 24 (so `tsc` is unavailable) and leaves a broken reparse-point clone. **Consequence:** ship a prebuilt package: `dist/` is gitignored and built by `prepublishOnly`; the tarball ships via `files: ["dist","scripts"]`. Install is `npm i -g secret-safe-env`.

### D14. Token-free CI publishing (npm Trusted Publishing + MCP Registry OIDC)
**Rationale:** the npm account cannot produce a TOTP OTP and long-lived tokens are a liability. **Consequence:** one tag-triggered GitHub Actions workflow publishes to npm (Trusted Publishing / OIDC) and to the MCP Registry (`mcp-publisher login github-oidc`). The registry namespace `io.github.irrenwill/*` is authorized by the OIDC `repository_owner` claim, so it works regardless of who triggers it. The workflow is tags-only, asserts `tag == package.json version`, and waits for npm to propagate the version (carrying `mcpName`) before the registry step.

### D15. List on the official MCP Registry (discovery), package stays on npm (artifact)
**Rationale:** the registry hosts metadata only and points at the npm package; it broadens discovery (and downstream aggregators sync from it). **Consequence:** `package.json` carries `mcpName`, a root `server.json` is the registry manifest, and the server is listed as `io.github.irrenwill/secret-safe-env`. Note: as of 2026-06 Claude Code does not yet install *from* the registry, so install still resolves to the npm package.
