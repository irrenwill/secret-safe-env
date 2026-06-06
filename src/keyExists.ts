import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolvePowershell, buildSpawnArgs, buildSpawnOptions } from './dialogRunner.js';

/** Path to scripts/KeyExists.ps1 (sibling of dist/, resolved via import.meta.url — cwd-independent). */
export function keyExistsScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url)); // .../dist
  return path.resolve(here, '..', 'scripts', 'KeyExists.ps1');
}

/** Spawns KeyExists.ps1; returns the raw status token. Reuses the pinned PS 5.1 + shell:false + stderr-ignore spawn. */
export function runKeyExists(key: string, envPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePowershell(), buildSpawnArgs(keyExistsScriptPath(), key, envPath), buildSpawnOptions());
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

export interface KeyExistsDeps {
  validateKey: (key: string) => boolean;
  resolveEnvPath: (envPath: string | undefined) => string;
  runKeyExists: (key: string, envPath: string) => Promise<string>;
  platform?: string;
}

export interface KeyExistsResult {
  isError: boolean;
  text: string;
  exists?: boolean;
}

export async function handleKeyExists(
  args: { key: string; env_path?: string },
  deps: KeyExistsDeps,
): Promise<KeyExistsResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') {
    return { isError: true, text: `This tool requires Windows + Windows PowerShell 5.1; current platform is ${platform}.` };
  }
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
    token = (await deps.runKeyExists(args.key, envPath)).trim();
  } catch {
    return { isError: true, text: 'Could not check the key (INTERNAL).' };
  }
  if (token === 'EXISTS') return { isError: false, text: `${args.key} exists in ${envPath}.`, exists: true };
  if (token === 'ABSENT') return { isError: false, text: `${args.key} is not set in ${envPath}.`, exists: false };
  // Any other token (incl. ERR or stray output) -> generic error, never echoed.
  return { isError: true, text: 'Could not check the key (INTERNAL).' };
}
