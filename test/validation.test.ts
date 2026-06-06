import { describe, it, expect, afterEach } from 'vitest';
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
  const ORIG = process.env.CLAUDE_PROJECT_DIR;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = ORIG;
  });

  it('defaults to .env under CLAUDE_PROJECT_DIR when set', () => {
    process.env.CLAUDE_PROJECT_DIR = 'C:\\proj';
    expect(resolveEnvPath(undefined)).toBe(path.resolve('C:\\proj', '.env'));
  });
  it('falls back to <cwd>/.env when CLAUDE_PROJECT_DIR is unset', () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    expect(resolveEnvPath(undefined)).toBe(path.resolve(process.cwd(), '.env'));
  });
  it('resolves an explicit relative path to absolute', () => {
    expect(resolveEnvPath('sub/.env')).toBe(path.resolve('sub/.env'));
  });
  it('throws on a path starting with "-" (flag injection)', () => {
    expect(() => resolveEnvPath('-rf')).toThrow();
  });
});
