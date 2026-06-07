# secret-safe-env — Specification

> Status: implemented and published (`secret-safe-env` on npm; `io.github.irrenwill/secret-safe-env` on the MCP Registry).

## 1. Purpose

Let an AI agent place a secret (API key, token, password, connection string) into a project's `.env` file **without the value ever entering the agent/model context** or any audited Windows logging channel. The agent supplies only the variable name; the human supplies the value through a native masked dialog; a local helper writes it to `.env`.

## 2. The core guarantee

> From the moment the user types the value into the masked dialog until the value lands in `.env`, the secret crosses **no** audited Windows or agent channel, and **never** enters the Node/agent process.

Concretely, the value:

- is captured only inside the PowerShell dialog process (`$script:SecretValue`);
- is **never** passed as a PowerShell parameter (so PowerShell Module Logging / event 4103 cannot record it);
- is written **only** via `[System.IO.File]::WriteAllText` — never through a cmdlet, pipeline, or output stream;
- is **never** used as a regex *pattern* (only ever the left-hand input of a match against a literal pattern);
- never reaches the Node process: Node spawns PowerShell, passes only the key + path, and reads back **one fixed status token**.

## 3. Tool contracts

### `set_env_secret({ key, env_path? })`

- **key** — required, `^[A-Z_][A-Z0-9_]*$` (UPPER_SNAKE_CASE).
- **env_path** — optional absolute path; defaults to `<CLAUDE_PROJECT_DIR or process.cwd()>/.env`. Agents should pass it explicitly (a runner's cwd is not the workspace). A leading `-` is rejected.
- **Behaviour** — opens the masked dialog for `key`; on confirm, upserts `key=value` into `.env` (replacing an existing line for `key` in place, else appending). Values are **single-line**.
- **Returns** — `content: [{ type: "text", text }]` + `isError`. No `outputSchema`. The text encodes the outcome and the agent's next step. Possible outcomes: wrote (`OK`), user cancelled (`CANCEL`), or a fixed error code (`ERR:<CODE>`). The value is never in the result.
- **Annotations** — `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: false`.

### `env_key_exists({ key, env_path? })`

- **key**, **env_path** — as above.
- **Behaviour** — reports whether `key` is present in `.env`. An empty value (`KEY=`) counts as present; a missing file is `false` (not an error).
- **Returns** — `structuredContent: { exists: boolean }` (+ a text mirror) on success; `isError: true` with generic text otherwise. Never returns the value or file contents.
- **Annotations** — `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.

Both tools, and the server's `instructions`, guide a zero-context ("cold") agent: pass the name only, never request paste-in-chat, never write the value/placeholder, never `cat` `.env` (use `env_key_exists`).

## 4. Status tokens (PowerShell → Node)

The PowerShell helpers emit exactly one fixed token on stdout; Node maps it to agent text and never echoes raw child output. stderr is discarded.

| Token | Meaning |
|---|---|
| `OK` | value written to `.env` |
| `CANCEL` | user cancelled / empty (all-whitespace) input |
| `EXISTS` / `ABSENT` | `env_key_exists` result |
| `ERR:<CODE>` | `CODE` ∈ `BAD_KEY`, `PATH_INVALID`, `WRITE_DENIED`, `IO`, `NO_DESKTOP`, `NO_SESSION`, `INTERNAL`, `UNSUPPORTED_PLATFORM` |

Any unrecognised token collapses to a generic `INTERNAL` error — the child's output is never reflected back.

## 5. Platform & runtime

- **OS:** Windows 10/11 only. On any other platform both tools return `UNSUPPORTED_PLATFORM` and refuse (no dialog, no write). The npm package installs everywhere but only functions on Windows.
- **Shell:** Windows PowerShell 5.1, launched from the pinned path `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`. PowerShell 7+ is never PATH-resolved or used.
- **Node:** 18+.
- **Transport:** MCP stdio.

## 6. Threat model

**In scope** — no audited channel records the value between paste and `.env` landing:

| Channel | Why it's clean |
|---|---|
| PSReadLine history | value is never typed at a console prompt |
| 4688 / Sysmon (process cmdline) | value is never a process argument |
| 4103 Module Logging (param binding) | value is never a cmdlet/function parameter |
| 4104 Script Block Logging | value is data in a variable, not script text |
| PowerShell Transcription | value never reaches an output stream |
| AMSI | no value-bearing script is submitted to AMSI |
| MCP / agent context, OTEL, mcp-debug | Node only sees the key, path, and status token |

**Out of scope** — once the value is in `.env`, the user owns: cloud sync / OneDrive, VSS / backup snapshots, antivirus scanning, file ACLs, and the agent (or anything else) reading `.env` afterward. A pre-existing value already on disk before the write is also out of scope.

## 7. Non-goals (YAGNI)

- No cross-platform UI (non-Windows gets a clear error, not a fallback).
- No multi-line secrets (PEM/JSON blobs → user edits `.env` manually).
- No `outputSchema` on `set_env_secret` (rich text + `isError` instead).
- No reading of `.env` contents into Node (existence checks run in PowerShell).

## 8. Enforcement

- **`npm run lint:ps`** — static AST lint over the value-path scripts, forbidding cmdlets/members that could leak the value.
- **`npm run test:ps`** — Pester tests including transcript-based "sentinel" tests asserting a known value never appears on any stream/transcript.
- **`npm test`** — Node unit tests for the handlers, validation, the pinned-PowerShell spawn options, and the status-token mapping.
