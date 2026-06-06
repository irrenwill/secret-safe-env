# env-pass

A local MCP tool that lets an agent place a secret into `.env` **without ever seeing the value**.
The agent calls `set_env_secret({ key })`; a native masked dialog opens; you paste the secret; a
PowerShell helper writes it straight to `.env`. The agent receives only `OK`/`CANCEL`/`ERR:<CODE>`.

## Requirements
- Windows + Windows PowerShell 5.1 (used at the pinned path `System32\WindowsPowerShell\v1.0`)
- Node 18+
- Pester 5 for the PowerShell tests: `Install-Module Pester -MinimumVersion 5.0 -Scope CurrentUser`

## Build & test
```bash
npm install
npm run build
npm test          # Node unit tests
npm run test:ps   # PowerShell upsert + no-leak tests
npm run lint:ps   # value-path lint
```

## Register with Claude Code
Add to your project `.mcp.json` (use an ABSOLUTE path):
```json
{
  "mcpServers": {
    "env-pass": {
      "command": "node",
      "args": ["C:/absolute/path/to/env-pass/dist/server.js"]
    }
  }
}
```
Reload Claude Code; the `set_env_secret` tool becomes available.

## Scope / guarantee
Protected: from the moment you paste until the value lands in `.env`, no audited Windows/agent
channel records the value. Out of scope (your responsibility): what happens to `.env` after it is
on disk (cloud sync / OneDrive, VSS/backup snapshots, AV scanning, file ACLs, the agent later
reading `.env`). See `docs/superpowers/specs/2026-06-06-env-pass-secret-input-design.md`.
