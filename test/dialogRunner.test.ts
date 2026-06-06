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
  it('hides the PowerShell console window (windowsHide: true)', () => {
    expect(buildSpawnOptions().windowsHide).toBe(true);
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
