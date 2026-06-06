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
 *  dialog is a separate top-level window and still shows). Returned as its own unit so a test can
 *  assert these invariants. */
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
