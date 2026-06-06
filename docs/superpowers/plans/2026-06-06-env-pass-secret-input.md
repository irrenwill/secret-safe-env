# env-pass Secret Input Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local MCP server that lets the agent trigger a native masked dialog into which the user pastes a secret; a PowerShell helper writes it directly to `.env`, and the agent never sees the value.

**Architecture:** A Node/TypeScript stdio MCP server exposes one tool `set_env_secret({key, env_path?})`. The agent passes only the key NAME. The server spawns Windows PowerShell 5.1 (pinned absolute path, `shell:false`, arg array) running `dialog.ps1`, which shows a WinForms masked input box and writes `KEY=value` to `.env` itself via `[System.IO.File]::WriteAllText`. The child prints ONLY a status token (`OK`/`CANCEL`/`ERR:<CODE>`); the server discards child stderr and allowlist-validates stdout. The secret value lives only in the PowerShell process memory and the `.env` file — never in the agent/Node/model context.

**Tech Stack:** TypeScript (ESM, NodeNext) · `@modelcontextprotocol/sdk` ^1.12 · `zod` ^3 · `vitest` (Node unit tests) · Windows PowerShell 5.1 + WinForms (`dialog.ps1`) · Pester 5 (PowerShell tests).

**Spec:** `docs/superpowers/specs/2026-06-06-env-pass-secret-input-design.md`. The §9 MUST/MUST-NOT security clauses are the load-bearing requirements; the Pester tests in Task 5 are their enforcement.

---

## File Structure

| File | Responsibility | Holds secret? |
|---|---|---|
| `src/validation.ts` | `validateKey`, `resolveEnvPath` (pure) | no |
| `src/handler.ts` | `handleSetEnvSecret(args, deps)` — validate, run dialog, map status token → result | no |
| `src/dialogRunner.ts` | `resolvePowershell`, `dialogScriptPath`, `buildSpawnArgs`, `runDialog` (spawn) | no |
| `src/server.ts` | MCP bootstrap: `McpServer` + `registerTool` + `StdioServerTransport` wiring | no |
| `scripts/EnvUpsert.ps1` | `.env` transform + status emission: `Find-KeyLineIndex`, `Render-CurrentLine`, `Write-EnvFile`, `Get-ErrorCode`, `Emit`, `Invoke-EnvWrite`. Reads the secret ONLY from `$script:SecretValue` (never a parameter). Sourceable for tests without launching the GUI. | yes (in-process) |
| `scripts/dialog.ps1` | WinForms masked dialog + hold-to-reveal; dot-sources `EnvUpsert.ps1`; prints status token | yes (in-process) |
| `scripts/lint-value-path.ps1` | Static check: fail if forbidden cmdlets/constructs appear on the value path | no |
| `test/validation.test.ts` | unit tests for validation | no |
| `test/handler.test.ts` | unit tests for handler (fake `runDialog`) | no |
| `test/dialogRunner.test.ts` | unit tests for arg building | no |
| `test/EnvUpsert.Tests.ps1` | Pester: upsert correctness + no-leak proof | dummy values only |

---

## Task 0: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1: Initialize git (the folder is not yet a repo)**

Run:
```bash
git init
```
Expected: `Initialized empty Git repository in d:/WorkSpace/env-pass/.git/`

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "env-pass",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "env-pass": "dist/server.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:ps": "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-Pester -Path ./test/EnvUpsert.Tests.ps1 -Output Detailed\"",
    "lint:ps": "powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/lint-value-path.ps1"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 5: Create `.gitignore`**

```gitignore
node_modules/
dist/
.env
*.env
*.log
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
npm install
```
Expected: `node_modules/` created, no errors. (If `@modelcontextprotocol/sdk@^1.12.0` cannot resolve, run `npm view @modelcontextprotocol/sdk version` and pin the printed 1.x version.)

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore package-lock.json
git commit -m "chore: scaffold env-pass MCP project"
```

---

## Task 1: Input validation (`validation.ts`)

**Files:**
- Create: `src/validation.ts`
- Test: `test/validation.test.ts`

- [ ] **Step 1: Write the failing test**

`test/validation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { validateKey, resolveEnvPath } from '../src/validation.js';

describe('validateKey', () => {
  it('accepts UPPER_SNAKE names', () => {
    expect(validateKey('OPENAI_API_KEY')).toBe(true);
    expect(validateKey('_X')).toBe(true);
    expect(validateKey('A1_B2')).toBe(true);
  });
  it('rejects invalid names', () => {
    for (const bad of ['lower', '1LEAD', 'HAS-DASH', 'HAS SPACE', '', 'a;b']) {
      expect(validateKey(bad)).toBe(false);
    }
  });
});

describe('resolveEnvPath', () => {
  it('defaults to .env in cwd', () => {
    expect(resolveEnvPath(undefined)).toBe(path.resolve(process.cwd(), '.env'));
  });
  it('resolves a relative path to absolute', () => {
    expect(resolveEnvPath('sub/.env')).toBe(path.resolve(process.cwd(), 'sub/.env'));
  });
  it('throws on a path starting with "-" (flag injection)', () => {
    expect(() => resolveEnvPath('-rf')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/validation.js"` / `validateKey is not a function`.

- [ ] **Step 3: Write minimal implementation**

`src/validation.ts`:
```ts
import path from 'node:path';

const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

export function validateKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function resolveEnvPath(envPath: string | undefined): string {
  if (envPath === undefined) return path.resolve(process.cwd(), '.env');
  if (envPath.startsWith('-')) throw new Error('PATH_INVALID');
  return path.resolve(envPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all `validation` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/validation.ts test/validation.test.ts
git commit -m "feat: key + env_path validation"
```

---

## Task 2: Status-token handler (`handler.ts`)

**Files:**
- Create: `src/handler.ts`
- Test: `test/handler.test.ts`

This is where the agent-facing result is built. It must NEVER echo unrecognized child output (audit clause A2).

- [ ] **Step 1: Write the failing test**

`test/handler.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { handleSetEnvSecret, type HandlerDeps } from '../src/handler.js';

function deps(over: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    validateKey: () => true,
    resolveEnvPath: () => 'C:\\proj\\.env',
    runDialog: async () => 'OK',
    ...over,
  };
}

describe('handleSetEnvSecret', () => {
  it('maps OK to a success message naming key + path, no value', async () => {
    const r = await handleSetEnvSecret({ key: 'OPENAI_API_KEY' }, deps());
    expect(r.isError).toBe(false);
    expect(r.text).toContain('OPENAI_API_KEY');
    expect(r.text).toContain('C:\\proj\\.env');
  });

  it('rejects an invalid key BEFORE running the dialog', async () => {
    let ran = false;
    const r = await handleSetEnvSecret(
      { key: 'bad-key' },
      deps({ validateKey: () => false, runDialog: async () => { ran = true; return 'OK'; } }),
    );
    expect(r.isError).toBe(true);
    expect(ran).toBe(false);
  });

  it('maps a rejected env_path to an error', async () => {
    const r = await handleSetEnvSecret(
      { key: 'K', env_path: '-rf' },
      deps({ resolveEnvPath: () => { throw new Error('PATH_INVALID'); } }),
    );
    expect(r.isError).toBe(true);
  });

  it('maps CANCEL to a non-error cancelled message', async () => {
    const r = await handleSetEnvSecret({ key: 'K' }, deps({ runDialog: async () => 'CANCEL' }));
    expect(r.isError).toBe(false);
    expect(r.text.toLowerCase()).toContain('cancel');
  });

  it('maps ERR:CODE to an error mentioning the code', async () => {
    const r = await handleSetEnvSecret({ key: 'K' }, deps({ runDialog: async () => 'ERR:WRITE_DENIED' }));
    expect(r.isError).toBe(true);
    expect(r.text).toContain('WRITE_DENIED');
  });

  it('treats unrecognized child output as generic INTERNAL error, never echoing it', async () => {
    const leak = 'sk-secret-leaked-1234';
    const r = await handleSetEnvSecret({ key: 'K' }, deps({ runDialog: async () => leak }));
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain(leak);
    expect(r.text).toContain('INTERNAL');
  });

  it('handles a dialog launch failure without leaking', async () => {
    const r = await handleSetEnvSecret(
      { key: 'K' },
      deps({ runDialog: async () => { throw new Error('boom'); } }),
    );
    expect(r.isError).toBe(true);
    expect(r.text).toContain('INTERNAL');
  });

  it('does NOT echo an ERR code outside the fixed enum (spec §8 fixed enum)', async () => {
    const r = await handleSetEnvSecret({ key: 'K' }, deps({ runDialog: async () => 'ERR:ABC_DEF' }));
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain('ABC_DEF');
    expect(r.text).toContain('INTERNAL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot import `../src/handler.js`.

- [ ] **Step 3: Write minimal implementation**

`src/handler.ts`:
```ts
export interface HandlerDeps {
  validateKey: (key: string) => boolean;
  resolveEnvPath: (envPath: string | undefined) => string;
  runDialog: (key: string, envPath: string) => Promise<string>;
}

export interface HandlerResult {
  isError: boolean;
  text: string;
}

// Fixed status enum — the ONLY ERR codes that may be reflected back (spec §8 / audit A1+A2).
const ERR_CODES = new Set([
  'BAD_KEY', 'PATH_INVALID', 'WRITE_DENIED', 'IO', 'NO_DESKTOP', 'NO_SESSION', 'INTERNAL',
]);

export async function handleSetEnvSecret(
  args: { key: string; env_path?: string },
  deps: HandlerDeps,
): Promise<HandlerResult> {
  if (!deps.validateKey(args.key)) {
    return { isError: true, text: 'Invalid key name: must match ^[A-Z_][A-Z0-9_]*$' };
  }

  let envPath: string;
  try {
    envPath = deps.resolveEnvPath(args.env_path);
  } catch {
    return { isError: true, text: 'Invalid env_path (rejected).' };
  }

  let token: string;
  try {
    token = (await deps.runDialog(args.key, envPath)).trim();
  } catch {
    return { isError: true, text: 'Secret was not written (INTERNAL).' };
  }

  if (token === 'OK') {
    return {
      isError: false,
      text: `✓ wrote ${args.key} to ${envPath} (value hidden — never seen by the agent).`,
    };
  }
  if (token === 'CANCEL') {
    return { isError: false, text: `Cancelled by user; nothing written to ${envPath}.` };
  }
  // Echo a code ONLY if it is in the fixed enum; ANY other token (a valid-looking ERR:<arbitrary>
  // or stray child output) collapses to a generic INTERNAL and is never echoed (audit A1+A2).
  if (token.startsWith('ERR:') && ERR_CODES.has(token.slice(4))) {
    return { isError: true, text: `Secret was not written (${token.slice(4)}).` };
  }
  return { isError: true, text: 'Secret was not written (INTERNAL).' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all `handler` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/handler.ts test/handler.test.ts
git commit -m "feat: status-token handler that never echoes child output"
```

---

## Task 3: Dialog runner (`dialogRunner.ts`)

**Files:**
- Create: `src/dialogRunner.ts`
- Test: `test/dialogRunner.test.ts`

The `spawn` itself is verified by manual e2e (Task 8). Here we unit-test the pure arg/path builders that enforce audit clauses E1/E2 (pinned interpreter, `-File` not `-Command`, value never an argv element).

- [ ] **Step 1: Write the failing test**

`test/dialogRunner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildSpawnArgs, buildSpawnOptions, resolvePowershell } from '../src/dialogRunner.js';

describe('buildSpawnArgs', () => {
  it('passes key and path as separate array elements', () => {
    const args = buildSpawnArgs('C:\\p\\dialog.ps1', 'OPENAI_API_KEY', 'C:\\proj\\.env');
    expect(args).toEqual([
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', 'C:\\p\\dialog.ps1',
      '-Key', 'OPENAI_API_KEY',
      '-EnvPath', 'C:\\proj\\.env',
    ]);
  });

  it('uses -File (script) form, never -Command (no string interpolation surface)', () => {
    const args = buildSpawnArgs('s', 'K', 'p');
    expect(args).toContain('-File');
    expect(args).not.toContain('-Command');
  });
});

describe('buildSpawnOptions (audit E2/B2 invariants)', () => {
  it('never uses a shell', () => {
    expect(buildSpawnOptions().shell).toBe(false);
  });
  it('discards child stderr (stdio = ignore, pipe, ignore)', () => {
    expect(buildSpawnOptions().stdio).toEqual(['ignore', 'pipe', 'ignore']);
  });
});

describe('resolvePowershell (audit E1: pinned PS 5.1, never PATH-resolved)', () => {
  it('returns the pinned Windows PowerShell 5.1 path under System32', () => {
    const p = resolvePowershell('C:\\Windows', () => true);
    expect(p).toBe(path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  });
  it('throws when that exact path is missing (never falls back to pwsh)', () => {
    expect(() => resolvePowershell('C:\\Windows', () => false)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot import `buildSpawnArgs`.

- [ ] **Step 3: Write minimal implementation**

`src/dialogRunner.ts`:
```ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PS_SUFFIX = path.join('System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** Pinned Windows PowerShell 5.1 — NEVER PATH-resolved (could find pwsh 7.3+ which feeds .NET args
 *  to AMSI). `root`/`exists` are injectable so the pinned-path + missing-binary behaviour is unit-testable. */
export function resolvePowershell(
  root: string = process.env.SystemRoot ?? 'C:\\Windows',
  exists: (p: string) => boolean = fs.existsSync,
): string {
  const p = path.join(root, PS_SUFFIX);
  if (!exists(p)) {
    throw new Error('Windows PowerShell 5.1 not found at the pinned path');
  }
  return p;
}

export function dialogScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url)); // .../dist
  return path.resolve(here, '..', 'scripts', 'dialog.ps1');
}

export function buildSpawnArgs(scriptPath: string, key: string, envPath: string): string[] {
  return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Key', key, '-EnvPath', envPath];
}

/** shell:false (no shell parsing) and stderr discarded ('ignore') so a stray diagnostic line can
 *  never be captured (audit B2). windowsHide hides the PowerShell console window (the WinForms
 *  dialog is a separate top-level window and still shows). Returned as its own unit for testing. */
export function buildSpawnOptions(): { shell: false; windowsHide: boolean; stdio: ('ignore' | 'pipe')[] } {
  return { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] };
}

/** Spawns the dialog. The secret is NEVER passed in; the child returns only a status token on stdout. */
export function runDialog(key: string, envPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePowershell(), buildSpawnArgs(dialogScriptPath(), key, envPath), buildSpawnOptions());
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dialogRunner.ts test/dialogRunner.test.ts
git commit -m "feat: dialog runner with pinned PS5.1, shell:false, stderr discarded"
```

---

## Task 4: MCP server bootstrap (`server.ts`)

**Files:**
- Create: `src/server.ts`

Bootstrap wiring only (no unit test — exercised by the manual smoke test below and the e2e in Task 8).

- [ ] **Step 1: Write the server**

`src/server.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateKey, resolveEnvPath } from './validation.js';
import { runDialog } from './dialogRunner.js';
import { handleSetEnvSecret } from './handler.js';

const server = new McpServer({ name: 'env-pass', version: '0.1.0' });

server.registerTool(
  'set_env_secret',
  {
    title: 'Set an .env secret (value never seen by the agent)',
    description:
      'Prompt the user, via a native masked dialog, to paste a secret that is written directly to .env by a local helper. ' +
      'You pass ONLY the key NAME (UPPER_SNAKE, e.g. OPENAI_API_KEY) and never receive the value. ' +
      'Use this whenever a secret or API key must be placed into a .env file.',
    inputSchema: {
      key: z.string().describe('The env var NAME, e.g. OPENAI_API_KEY (UPPER_SNAKE).'),
      env_path: z.string().optional().describe('Optional path to the .env file; defaults to ./.env.'),
    },
  },
  async ({ key, env_path }) => {
    const r = await handleSetEnvSecret({ key, env_path }, { validateKey, resolveEnvPath, runDialog });
    return { content: [{ type: 'text', text: r.text }], isError: r.isError };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS — `dist/server.js` and the other `dist/*.js` exist, no TypeScript errors.

- [ ] **Step 3: Smoke-test that the server starts and lists the tool**

Run (PowerShell):
```powershell
$req = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
$req | node dist/server.js
```
Expected: a JSON-RPC line whose `result.tools[0].name` is `set_env_secret`. (Press Ctrl+C to stop; the server reads stdio.)

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: MCP server bootstrap exposing set_env_secret"
```

---

## Task 5: `.env` transform + no-leak proof (`EnvUpsert.ps1`)

**Files:**
- Create: `scripts/EnvUpsert.ps1`
- Test: `test/EnvUpsert.Tests.ps1`

This file enforces the heart of the security spec: the secret flows ONLY through `$script:SecretValue` (never a parameter → no 4103 ParameterBinding capture), is written ONLY via `[System.IO.File]::WriteAllText` (no cmdlet → no 4103), is never a regex pattern (D1), and is never written to any output stream (B1).

> **Prerequisite:** Pester 5 must be installed. Run once: `powershell -Command "Install-Module Pester -MinimumVersion 5.0 -Scope CurrentUser -Force"`.

- [ ] **Step 1: Write the failing Pester test**

`test/EnvUpsert.Tests.ps1`:
```powershell
BeforeAll {
    . "$PSScriptRoot/../scripts/EnvUpsert.ps1"
    $script:TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("envpass-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $script:TmpDir | Out-Null
}
AfterAll {
    Remove-Item -Recurse -Force $script:TmpDir
}

Describe 'Render-CurrentLine' {
    It 'renders a simple value unquoted' {
        $script:SecretValue = 'abc123'
        Render-CurrentLine -Key 'K' | Should -Be 'K=abc123'
    }
    It 'quotes and escapes values with space, hash, quote, backslash' {
        $script:SecretValue = 'a b"c\#d'
        Render-CurrentLine -Key 'K' | Should -Be 'K="a b\"c\\#d"'
    }
}

Describe 'Find-KeyLineIndex' {
    It 'finds an existing key, allowing optional export prefix' {
        Find-KeyLineIndex -Lines @('# c', 'A=1', 'export B=2') -Key 'B' | Should -Be 2
    }
    It 'returns -1 when the key is absent' {
        Find-KeyLineIndex -Lines @('A=1') -Key 'B' | Should -Be -1
    }
}

Describe 'Write-EnvFile' {
    It 'creates a new file containing the key' {
        $p = Join-Path $script:TmpDir 'new.env'
        $script:SecretValue = 'v1'
        Write-EnvFile -EnvPath $p -Key 'K'
        [System.IO.File]::ReadAllText($p) | Should -Be "K=v1`n"
    }
    It 'replaces an existing key, preserving other lines, comments and order' {
        $p = Join-Path $script:TmpDir 'rep.env'
        [System.IO.File]::WriteAllText($p, "# top`nA=1`nK=old`nB=2`n")
        $script:SecretValue = 'new'
        Write-EnvFile -EnvPath $p -Key 'K'
        [System.IO.File]::ReadAllText($p) | Should -Be "# top`nA=1`nK=new`nB=2`n"
    }
    It 'appends a new key to an existing file' {
        $p = Join-Path $script:TmpDir 'app.env'
        [System.IO.File]::WriteAllText($p, "A=1`n")
        $script:SecretValue = 'v'
        Write-EnvFile -EnvPath $p -Key 'K'
        [System.IO.File]::ReadAllText($p) | Should -Be "A=1`nK=v`n"
    }
    It 'writes UTF-8 with NO BOM' {
        $p = Join-Path $script:TmpDir 'bom.env'
        $script:SecretValue = 'v'
        Write-EnvFile -EnvPath $p -Key 'K'
        $bytes = [System.IO.File]::ReadAllBytes($p)
        $bytes[0] | Should -Be 0x4B  # 'K', not 0xEF (BOM)
    }
    It 'round-trips a value full of regex metacharacters without throwing' {
        $p = Join-Path $script:TmpDir 'meta.env'
        $script:SecretValue = 'a()[]$1\."#b'
        { Write-EnvFile -EnvPath $p -Key 'K' } | Should -Not -Throw
        [System.IO.File]::ReadAllText($p) | Should -BeLike 'K="*"*'
    }
    It 'creates no secondary files (.bak/.tmp)' {
        $dir = Join-Path $script:TmpDir 'nosec'
        New-Item -ItemType Directory -Path $dir | Out-Null
        $p = Join-Path $dir '.env'
        $script:SecretValue = 'v'
        Write-EnvFile -EnvPath $p -Key 'K'
        (Get-ChildItem -Force $dir).Count | Should -Be 1
    }
}

Describe 'Get-ErrorCode' {
    It 'maps UnauthorizedAccessException to WRITE_DENIED' {
        $rec = [System.Management.Automation.ErrorRecord]::new(
            [System.UnauthorizedAccessException]::new('x'), 'id', 'NotSpecified', $null)
        Get-ErrorCode -ErrRecord $rec | Should -Be 'WRITE_DENIED'
    }
    It 'maps an unknown exception to INTERNAL' {
        $rec = [System.Management.Automation.ErrorRecord]::new(
            [System.Exception]::new('x'), 'id', 'NotSpecified', $null)
        Get-ErrorCode -ErrRecord $rec | Should -Be 'INTERNAL'
    }
}

Describe 'No-leak: value never reaches stdout or the transcript' {
    It 'writes the value ONLY to the .env file, not to any output stream or transcript' {
        $sentinel = 'SENTINEL-NEVER-LOG-9f3c2a'
        $p  = Join-Path $script:TmpDir 'leak.env'
        $tr = Join-Path $script:TmpDir 'transcript.txt'
        $script:SecretValue = $sentinel          # set BEFORE transcript (literal not under test)
        Start-Transcript -Path $tr -Force | Out-Null
        $out = Write-EnvFile -EnvPath $p -Key 'K' *>&1   # merge ALL streams
        Stop-Transcript | Out-Null
        ($out | Out-String)                | Should -Not -Match $sentinel  # nothing on any stream
        [System.IO.File]::ReadAllText($tr) | Should -Not -Match $sentinel  # not transcribed
        [System.IO.File]::ReadAllText($p)  | Should -Match $sentinel       # but IS in the .env
    }
}

# Covers the dialog.ps1 STATUS path (Emit / Get-ErrorCode / catch — audit A1+B1) WITHOUT the GUI.
# Only the live Show-SecretDialog (interactive) is left to manual e2e.
Describe 'Invoke-EnvWrite: fixed status token + no value on any stream' {
    BeforeEach {
        $script:OrigOut = [Console]::Out
        $script:Sw = New-Object System.IO.StringWriter
        [Console]::SetOut($script:Sw)
    }
    AfterEach { [Console]::SetOut($script:OrigOut) }

    It 'emits OK; value goes ONLY to the file, never to stdout or transcript' {
        $sentinel = 'SENTINEL-OK-9f3c2a'
        $p  = Join-Path $script:TmpDir 'iew-ok.env'
        $tr = Join-Path $script:TmpDir 'iew-ok-transcript.txt'
        $script:SecretValue = $sentinel                 # set BEFORE transcript
        Start-Transcript -Path $tr -Force | Out-Null
        Invoke-EnvWrite -EnvPath $p -Key 'K'
        Stop-Transcript | Out-Null
        $script:Sw.ToString().Trim()       | Should -Be 'OK'
        $script:Sw.ToString()              | Should -Not -Match $sentinel
        [System.IO.File]::ReadAllText($tr) | Should -Not -Match $sentinel
        [System.IO.File]::ReadAllText($p)  | Should -Match $sentinel
    }

    It 'on a write failure emits a fixed ERR:<CODE> and never the value' {
        $sentinel = 'SENTINEL-FAIL-7b1d'
        # Non-existent directory -> WriteAllText throws DirectoryNotFoundException -> PATH_INVALID
        $p  = Join-Path $script:TmpDir 'no\such\dir\.env'
        $tr = Join-Path $script:TmpDir 'iew-fail-transcript.txt'
        $script:SecretValue = $sentinel
        Start-Transcript -Path $tr -Force | Out-Null
        Invoke-EnvWrite -EnvPath $p -Key 'K'
        Stop-Transcript | Out-Null
        $script:Sw.ToString().Trim()       | Should -Match '^ERR:(PATH_INVALID|IO|WRITE_DENIED|INTERNAL)$'
        $script:Sw.ToString()              | Should -Not -Match $sentinel
        [System.IO.File]::ReadAllText($tr) | Should -Not -Match $sentinel
    }
}
```

- [ ] **Step 2: Run the Pester tests to verify they fail**

Run: `npm run test:ps`
Expected: FAIL — `EnvUpsert.ps1` not found / functions undefined.

- [ ] **Step 3: Write the implementation**

`scripts/EnvUpsert.ps1`:
```powershell
# EnvUpsert.ps1 — pure .env transform. SECURITY: the secret value flows ONLY through
# $script:SecretValue (NEVER a parameter), so it never crosses a PowerShell parameter-binding
# boundary that Module Logging (4103) would record. It is written ONLY via [System.IO.File]
# (never a cmdlet), and is never used as a regex PATTERN or written to any output stream.

$script:SecretValue = $null

function Find-KeyLineIndex {
    param([string[]]$Lines, [string]$Key)
    $pattern = '^\s*(export\s+)?' + [regex]::Escape($Key) + '\s*='
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match $pattern) { return $i }
    }
    return -1
}

function Render-CurrentLine {
    param([string]$Key)
    # $v is the INPUT (left) of -match against a LITERAL pattern; the value is never the pattern.
    # Quoting uses .NET String.Replace (literal, no regex, no parameter binding).
    $v = $script:SecretValue
    if ($v -match '[\s#"'']') {
        $escaped = $v.Replace('\', '\\').Replace('"', '\"')
        return "$Key=`"$escaped`""
    }
    return "$Key=$v"
}

function Write-EnvFile {
    param([string]$EnvPath, [string]$Key)
    $existing = ''
    if (Test-Path -LiteralPath $EnvPath) {
        $existing = [System.IO.File]::ReadAllText($EnvPath)
    }
    $newline = if ($existing -match "`r`n") { "`r`n" } else { "`n" }

    # PS 5.1: build a resizable ArrayList explicitly (a cast wrapper is fixed-size; RemoveAt throws).
    $lines = New-Object System.Collections.ArrayList
    if ($existing.Length -gt 0) { foreach ($ln in ($existing -split "`r?`n")) { [void]$lines.Add($ln) } }
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }

    # PS 5.1: .ToArray() with no type arg unrolls to $null on an empty list — use a typed array + guard.
    $linesArr = if ($lines.Count -gt 0) { $lines.ToArray([string]) } else { [string[]]@() }
    # NOTE: $linesArr holds EXISTING .env lines (a prior value, if any) — passed by parameter here. The
    # NEW value never crosses a parameter boundary (it stays in $script:SecretValue); a prior value on
    # disk is out of scope (§13); and a [string[]] arg is logged by TYPE, not by element, in 4103.
    $idx = Find-KeyLineIndex -Lines $linesArr -Key $Key
    $rendered = Render-CurrentLine -Key $Key   # value injected internally via $script:SecretValue
    if ($idx -ge 0) { $lines[$idx] = $rendered } else { [void]$lines.Add($rendered) }

    $outArr = if ($lines.Count -gt 0) { $lines.ToArray([string]) } else { [string[]]@() }
    $content = ($outArr -join $newline) + $newline
    $enc = New-Object System.Text.UTF8Encoding($false)   # UTF-8, no BOM
    [System.IO.File]::WriteAllText($EnvPath, $content, $enc)
}

function Get-ErrorCode {
    param([System.Management.Automation.ErrorRecord]$ErrRecord)
    $ex = $ErrRecord.Exception
    if ($ex -is [System.UnauthorizedAccessException])  { return 'WRITE_DENIED' }
    if ($ex -is [System.IO.DirectoryNotFoundException]) { return 'PATH_INVALID' }
    if ($ex -is [System.IO.IOException])               { return 'IO' }
    return 'INTERNAL'
}

# Status emission lives here (not in dialog.ps1) so it can be unit-tested without the GUI.
# Emit uses [Console]::Out (a .NET call, not Write-Output/Write-Host) — the value path stays clean.
function Emit { param([string]$Token) [Console]::Out.WriteLine($Token) }

function Invoke-EnvWrite {
    # Writes $script:SecretValue to .env and emits EXACTLY ONE fixed status token. The catch maps the
    # exception TYPE to a fixed code (audit A1) and NEVER references the exception message or the value
    # (audit B1); the value is never written to any output stream.
    param([string]$EnvPath, [string]$Key)
    try {
        Write-EnvFile -EnvPath $EnvPath -Key $Key
        $script:SecretValue = $null
        Emit 'OK'
    } catch {
        $code = Get-ErrorCode -ErrRecord $_
        $script:SecretValue = $null
        Emit "ERR:$code"
    }
}
```

- [ ] **Step 4: Run the Pester tests to verify they pass**

Run: `npm run test:ps`
Expected: PASS — every `It` green, including the no-leak test.

- [ ] **Step 5: Commit**

```bash
git add scripts/EnvUpsert.ps1 test/EnvUpsert.Tests.ps1
git commit -m "feat: .env upsert via .NET write + Pester no-leak proof"
```

---

## Task 6: WinForms dialog (`dialog.ps1`)

**Files:**
- Create: `scripts/dialog.ps1`

GUI + main flow. Verified by manual e2e (Task 8); the value-handling logic it calls is already proven in Task 5. Status tokens are emitted via `[Console]::Out.WriteLine` (a .NET call, not `Write-Output`/`Write-Host`) so the value path stays clean and the lint in Task 7 passes.

- [ ] **Step 1: Write the dialog script**

`scripts/dialog.ps1`:
```powershell
param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$EnvPath
)
$ErrorActionPreference   = 'Stop'
$VerbosePreference       = 'SilentlyContinue'
$DebugPreference         = 'SilentlyContinue'
$InformationPreference   = 'SilentlyContinue'

. "$PSScriptRoot/EnvUpsert.ps1"   # provides Emit, Invoke-EnvWrite, Write-EnvFile, Get-ErrorCode

if (-not [System.Environment]::UserInteractive) { Emit 'ERR:NO_SESSION'; exit 0 }

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
} catch {
    Emit 'ERR:NO_DESKTOP'; exit 0
}

function Show-SecretDialog {
    param([string]$Key, [string]$EnvPath)
    # Returns $true and sets $script:SecretValue on confirm; $false on cancel/empty.
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'env-pass'            # NEVER the value
    $form.TopMost = $true
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false; $form.MinimizeBox = $false
    $form.ClientSize = New-Object System.Drawing.Size(452, 170)

    $label = New-Object System.Windows.Forms.Label
    $label.Text = "Paste value for $Key`r`n-> $EnvPath"
    $label.SetBounds(12, 10, 428, 44)
    $form.Controls.Add($label)

    $txt = New-Object System.Windows.Forms.TextBox
    $txt.UseSystemPasswordChar = $true
    $txt.SetBounds(12, 58, 320, 24)
    $form.Controls.Add($txt)

    # Hold-to-reveal: owner-draw the plaintext as PIXELS only (no UIA-readable control Text).
    $revealPanel = New-Object System.Windows.Forms.Panel
    $revealPanel.SetBounds(12, 88, 428, 24)
    $script:Revealing = $false
    $revealPanel.Add_Paint({
        param($s, $e)
        if ($script:Revealing) {
            $e.Graphics.DrawString($txt.Text, $form.Font, [System.Drawing.Brushes]::Black, 0, 0)
        }
    })
    $form.Controls.Add($revealPanel)

    $eye = New-Object System.Windows.Forms.Button
    $eye.Text = 'Hold to reveal'; $eye.SetBounds(338, 57, 102, 26); $eye.TabStop = $false
    $eye.Add_MouseDown({ $script:Revealing = $true;  $revealPanel.Invalidate() })
    $eye.Add_MouseUp(  { $script:Revealing = $false; $revealPanel.Invalidate() })
    $eye.Add_MouseLeave({ $script:Revealing = $false; $revealPanel.Invalidate() })  # re-mask if pointer leaves while held
    $form.Controls.Add($eye)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = 'OK'; $ok.SetBounds(254, 124, 86, 30)
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.Controls.Add($ok); $form.AcceptButton = $ok

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancel'; $cancel.SetBounds(346, 124, 86, 30)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($cancel); $form.CancelButton = $cancel

    $form.Add_Deactivate({ $script:Revealing = $false; $revealPanel.Invalidate() })  # auto re-mask on focus loss (spec §9 F1)
    $form.Add_Shown({ $form.Activate(); $txt.Focus() })
    $result = $form.ShowDialog()

    $confirmed = ($result -eq [System.Windows.Forms.DialogResult]::OK -and $txt.Text.Length -gt 0)
    if ($confirmed) { $script:SecretValue = $txt.Text }
    $txt.Text = ''            # shorten plaintext residency in the control
    $form.Dispose()
    return $confirmed
}

try {
    if (Show-SecretDialog -Key $Key -EnvPath $EnvPath) {
        Invoke-EnvWrite -EnvPath $EnvPath -Key $Key   # write + emit OK/ERR:<CODE> (unit-tested in EnvUpsert.Tests.ps1)
    } else {
        Emit 'CANCEL'
    }
} catch {
    Emit 'ERR:INTERNAL'
}
```

- [ ] **Step 2: Manually verify the dialog runs and writes the file**

Run (PowerShell, in the project root):
```powershell
$tmp = Join-Path $env:TEMP 'envpass-manual.env'
Remove-Item $tmp -ErrorAction SilentlyContinue
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File .\scripts\dialog.ps1 -Key TEST_KEY -EnvPath $tmp
Get-Content $tmp
```
Expected: the masked dialog appears; paste `hello world#x`, click OK; the console prints `OK`; `Get-Content` shows `TEST_KEY="hello world#x"`. Re-run, click Cancel → prints `CANCEL`, file unchanged.

- [ ] **Step 3: Commit**

```bash
git add scripts/dialog.ps1
git commit -m "feat: WinForms masked dialog with hold-to-reveal"
```

---

## Task 7: Static value-path lint (`lint-value-path.ps1`)

**Files:**
- Create: `scripts/lint-value-path.ps1`

Build-time guard (audit C1/D2): fails if any forbidden cmdlet/construct appears in the PowerShell value path, so a future "simpler" refactor (e.g. `Set-Content -Value`) cannot silently reintroduce a leak.

- [ ] **Step 1: Write the linter**

`scripts/lint-value-path.ps1`:
```powershell
# Fails (exit 1) if the secret value path uses a forbidden construct (spec §9 B1/C1/D2/F2/F3).
# AST-based: matches REAL invocations regardless of formatting, ignores comments/strings, and uses
# EXACT command names (a Write-* wildcard would wrongly flag our own Write-EnvFile).
$ErrorActionPreference = 'Stop'
$targets = @("$PSScriptRoot/dialog.ps1", "$PSScriptRoot/EnvUpsert.ps1")

$forbiddenCmds = @(
    'Set-Content','Add-Content','Out-File','Tee-Object','Export-Csv','Export-Clixml',
    'Write-Host','Write-Output','Write-Error','Write-Verbose','Write-Debug','Write-Information',
    'ConvertTo-SecureString','Set-Clipboard','Invoke-Expression','iex'
)
# Members the value must never flow into ($txt.Text — the masked input — is intentionally allowed).
$forbiddenMembers = @('AccessibleName','AccessibleDescription','Tag','Create','SetText','Clipboard')
$violations = New-Object System.Collections.Generic.List[string]

foreach ($t in $targets) {
    $tk = $null; $er = $null
    $ast  = [System.Management.Automation.Language.Parser]::ParseFile($t, [ref]$tk, [ref]$er)
    $name = [System.IO.Path]::GetFileName($t)

    foreach ($c in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
        $cmd = $c.GetCommandName()
        if ($cmd -and ($forbiddenCmds -contains $cmd)) { $violations.Add("${name}: forbidden command '$cmd'") }
        if ($c.InvocationOperator -eq 'Dot') {
            $first = $c.CommandElements[0]
            if (-not ($first -is [System.Management.Automation.Language.StringConstantExpressionAst])) {
                $violations.Add("${name}: dynamic dot-source of a non-literal")
            }
        }
    }
    foreach ($m in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.MemberExpressionAst] }, $true)) {
        $member = "$($m.Member)"
        if ($forbiddenMembers -contains $member) { $violations.Add("${name}: forbidden member '$member'") }
    }
    foreach ($ty in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.TypeExpressionAst] }, $true)) {
        if ("$($ty.TypeName)" -match 'Clipboard') { $violations.Add("${name}: forbidden Clipboard type usage") }
    }
}

if ($violations.Count -gt 0) {
    ($violations | Select-Object -Unique) | ForEach-Object { [Console]::Error.WriteLine($_) }
    exit 1
}
[Console]::Out.WriteLine('lint-value-path: OK')
exit 0
```

- [ ] **Step 2: Run the linter against the real scripts**

Run: `npm run lint:ps`
Expected: prints `lint-value-path: OK`, exit code 0. (Verify in PowerShell with `npm run lint:ps; $LASTEXITCODE` → `0`.)

- [ ] **Step 3: Verify it actually catches violations**

Temporarily add each line below to the bottom of `scripts/EnvUpsert.ps1`, run `npm run lint:ps` after each, confirm a non-zero exit with the matching message, then **remove the line**:
- `Write-Error $script:SecretValue` → `forbidden command 'Write-Error'`
- `$x = Set-Content` → `forbidden command 'Set-Content'`
- `$d = New-Object System.Windows.Forms.Label; $d.AccessibleName = 'x'` → `forbidden member 'AccessibleName'`

After removing all of them, re-run → back to `lint-value-path: OK` (exit 0). Verify in PowerShell with `npm run lint:ps; $LASTEXITCODE` → `0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/lint-value-path.ps1
git commit -m "test: static lint forbidding cmdlets/iex on the value path"
```

---

## Task 8: README, registration, and full e2e

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
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
Protected: from the moment you paste until the value lands in `.env` — no audited Windows/agent
channel records the value. Out of scope (your responsibility): what happens to `.env` after it is
on disk (cloud sync / OneDrive, VSS/backup snapshots, AV scanning, file ACLs, the agent later
reading `.env`). See `docs/superpowers/specs/2026-06-06-env-pass-secret-input-design.md`.
````

- [ ] **Step 2: Full end-to-end through the MCP server**

Build, then drive the tool the way the agent will. In PowerShell:
```powershell
npm run build
$tmp = Join-Path $env:TEMP 'envpass-e2e.env'
Remove-Item $tmp -ErrorAction SilentlyContinue
$call = @{ jsonrpc='2.0'; id=1; method='tools/call'; params=@{ name='set_env_secret'; arguments=@{ key='OPENAI_API_KEY'; env_path=$tmp } } } | ConvertTo-Json -Compress -Depth 6
# Send initialize + the tool call:
@(
  '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual","version":"0"}}}'
  '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  $call
) | node dist/server.js
```
Expected: the masked dialog appears; paste a value, click OK; the JSON-RPC response's `result.content[0].text` is `✓ wrote OPENAI_API_KEY to <tmp> (value hidden ...)` and the response contains NO secret value. `Get-Content $tmp` shows `OPENAI_API_KEY=...`.

- [ ] **Step 3: Confirm the agent transcript never holds the value**

Confirm by inspection: the only thing returned to the caller is the status text above; the value exists solely in `$tmp`. (The Pester no-leak test in Task 5 is the automated counterpart.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with registration + scope guarantee"
```

---

## Self-Review

**1. Spec coverage**
- §2 threat model / boundary → handler returns only key+path+status (Task 2); §13 boundary documented in README (Task 8). ✓
- §4 data flow / §5 components → Tasks 1-6 implement exactly the server→PS→.env path. ✓
- §8 status protocol (`OK`/`CANCEL`/`ERR:<CODE>` enum) → `Emit` + `Get-ErrorCode` (Tasks 5-6), allowlist in handler (Task 2). ✓
- §9 MUST/MUST-NOT: A1 fixed enum (`Get-ErrorCode` Task 5 + `Invoke-EnvWrite` failure test Task 5; handler enum-allowlist test `ERR:ABC_DEF` Task 2); A2 allowlist + never echo (Task 2 tests); B1 preferences + `[Console]::Out` proven by `Invoke-EnvWrite` transcript test (Task 5); B2 `stdio` stderr `ignore` (`buildSpawnOptions` test Task 3); C1 `WriteAllText` only + AST lint (Tasks 5,7); C2 value via `$script:SecretValue` not a param (Task 5); C3 no secondary file (Task 5 test); D1 value never a regex pattern (Task 5); D2 no iex/scriptblock + AST lint (Task 7); D3 null after write (Tasks 5,6); E1 pinned PS5.1 path + `resolvePowershell` test (Task 3); E2 `shell:false`+arg array (`buildSpawnArgs`/`buildSpawnOptions` tests Task 3) + reject `-` (Task 1); F1 hold-to-reveal + `MouseLeave`/`Deactivate` re-mask (Task 6); F2/F3 owner-draw reveal + AST lint blocking value→`AccessibleName`/`Tag`/`Clipboard` (Tasks 6,7). ✓
- §11 tests → vitest validation/handler/dialogRunner (Tasks 1-3), Pester incl. `Write-EnvFile` no-leak + `Invoke-EnvWrite` status/transcript/failure (Task 5), AST lint (Task 7), manual e2e (Tasks 6,8). ✓
- §12 structure → matches the File Structure table (the `src/` split into validation/handler/dialogRunner/server, and the `EnvUpsert.ps1` Emit/Invoke-EnvWrite split, are the noted refinements that make the security rules testable). ✓

**Coverage limits (honest scoping):** Two things are NOT covered by automated tests and rely on the manual e2e in Tasks 6 & 8: (a) the live interactive `Show-SecretDialog` GUI (ShowDialog blocks on user input — cannot run headless), and (b) the `McpServer`/`StdioServerTransport` transport wiring in `server.ts`. Every other MUST is backed by a vitest test, the Pester no-leak/status tests, or the AST lint.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step shows expected output. ✓

**3. Type/name consistency:** `HandlerDeps`/`handleSetEnvSecret` (Task 2) match `server.ts` usage (Task 4); `runDialog(key, envPath)` signature matches across Tasks 2-4; `$script:SecretValue`, `Render-CurrentLine`, `Find-KeyLineIndex`, `Write-EnvFile`, `Get-ErrorCode` names consistent across Tasks 5-7; status tokens `OK`/`CANCEL`/`ERR:<CODE>` consistent between `dialog.ps1` (Task 6) and the handler allowlist (Task 2). ✓
