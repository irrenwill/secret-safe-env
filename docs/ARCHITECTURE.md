# secret-safe-env — Architecture

Two layers: a small **Node/TypeScript MCP server** that never touches the secret, and **PowerShell scripts** that own the value end-to-end (capture → write → status). The boundary between them carries only a key name, a path, and a fixed status token.

## Module map

### Node (`src/` → `dist/`)

| Module | Responsibility |
|---|---|
| `server.ts` | MCP entrypoint (`#!/usr/bin/env node`). Creates `McpServer` with `instructions`; registers `set_env_secret` (no `outputSchema`) and `env_key_exists` (`outputSchema: { exists }`); connects stdio transport. Holds the agent-facing schemas, descriptions, and annotations. |
| `handler.ts` | `handleSetEnvSecret`: platform guard → `validateKey` → `resolveEnvPath` → `runDialog` → map the status token to agent text + `isError`. Owns the fixed `ERR_CODES` allow-list; never echoes raw child output. Dependency-injected (`HandlerDeps`) for testing. |
| `keyExists.ts` | `runKeyExists` (spawns `KeyExists.ps1` reusing the pinned-PowerShell spawn) and `handleKeyExists`: same guard/validate/resolve pipeline, maps `EXISTS`/`ABSENT` → `{ exists }`, anything else → generic `INTERNAL`. |
| `validation.ts` | `validateKey` (`^[A-Z_][A-Z0-9_]*$`) and `resolveEnvPath` (`CLAUDE_PROJECT_DIR ?? cwd`, reject leading `-`, return absolute). |
| `dialogRunner.ts` | `resolvePowershell` (pinned PS 5.1 path, **never** PATH-resolved; injectable for tests), `dialogScriptPath`, `buildSpawnArgs`, `buildSpawnOptions` (`shell:false`, `windowsHide:false`, `stdio:['ignore','pipe','ignore']`), `runDialog`. The secret is never passed in; only a status token comes back on stdout. |

### PowerShell (`scripts/`)

| Script | Responsibility |
|---|---|
| `dialog.ps1` | The masked WinForms dialog (Traditional Chinese UI, title `secret-safe-env`, hold-to-reveal owner-draw, auto re-mask on focus loss). Hides only its **own console window** by handle (keeps the dialog visible). Captures the entered value into `$script:SecretValue`, then calls `Invoke-EnvWrite`. Bails with `ERR:NO_SESSION` / `ERR:NO_DESKTOP` when there is no interactive desktop. |
| `EnvUpsert.ps1` | The value-path core (no GUI, so it is unit-testable). `Find-KeyLineIndex`, `Render-CurrentLine` (quoting via .NET `String.Replace`, never regex), `Write-EnvFile` (UTF-8 no BOM, preserves newline style, upsert in place), `Get-ErrorCode` (exception **type** → fixed code), `Emit` (`[Console]::Out`), `Test-KeyExists`, `Invoke-EnvWrite` (writes then emits exactly one fixed token; the catch never references the exception message or the value). |
| `KeyExists.ps1` | Thin wrapper: dot-sources `EnvUpsert.ps1`, runs `Test-KeyExists`, emits `EXISTS`/`ABSENT` (or `ERR:IO`). |
| `lint-value-path.ps1` | Static AST lint over `dialog.ps1`, `EnvUpsert.ps1`, `KeyExists.ps1`, forbidding cmdlets/members that could route the value to a logged channel. |

## Data flow — `set_env_secret`

```
agent ── set_env_secret({ key, env_path? }) ──► server.ts
                                                  │
                                       handler.ts │  platform==win32? validateKey? resolveEnvPath?
                                                  ▼
                                      dialogRunner.runDialog(key, envPath)
                                                  │  spawn pinned PS 5.1  (no value passed)
                                                  │  windowsHide:false, shell:false, stderr ignored
                                                  ▼
                                            dialog.ps1  ── masked dialog ──► USER types value
                                                  │                              │
                                                  │  $script:SecretValue ◄───────┘  (never a param, never stdout)
                                                  ▼
                                     EnvUpsert.Invoke-EnvWrite
                                                  │  [System.IO.File]::WriteAllText(.env, ...)
                                                  ▼
                                            Emit "OK" | "ERR:<CODE>"   (stdout)
                                                  │
                                       handler.ts │  map token → agent text + isError
                                                  ▼
agent ◄──────────── "Wrote OPENAI_API_KEY to ... Value hidden, never sent to you."
```

The value lives only in the dotted box (the PowerShell dialog process). Node sees the key, the path, and the token — never the value.

## Data flow — `env_key_exists`

```
agent ── env_key_exists({ key }) ──► keyExists.handleKeyExists
                                         │  guard / validate / resolve
                                         ▼
                                runKeyExists ──► KeyExists.ps1 ──► Test-KeyExists
                                         │            reads .env via [System.IO.File], matches key
                                         ▼
                                  "EXISTS" | "ABSENT"  ──►  { exists: boolean }
```

`.env` contents are read and matched inside PowerShell; only a boolean crosses back. This is the agent's safe alternative to `cat .env`.

## Why the boundary is shaped this way

- **Pinned PowerShell path** keeps the execution/logging surface deterministic (never accidentally `pwsh` 7+).
- **`windowsHide:false`** is required: Node's `windowsHide` sets `SW_HIDE` on the child's `STARTUPINFO`, which the process's first GUI window (the dialog) would inherit — making it invisible. `dialog.ps1` hides its own console window by handle instead.
- **stderr discarded + fixed token allow-list** means a stray diagnostic line can never be captured or reflected to the agent.
- **Status emission lives in `EnvUpsert.ps1`, not `dialog.ps1`**, so the value-path and its error mapping can be unit-tested without the GUI.

See [DECISIONS.md](./DECISIONS.md) for the rationale behind each choice and [SPEC.md](./SPEC.md) for the guarantees.
