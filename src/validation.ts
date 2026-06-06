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
