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
