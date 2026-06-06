import { describe, it, expect } from 'vitest';
import { handleKeyExists, type KeyExistsDeps } from '../src/keyExists.js';

function deps(over: Partial<KeyExistsDeps> = {}): KeyExistsDeps {
  return {
    platform: 'win32',
    validateKey: () => true,
    resolveEnvPath: () => 'C:\\proj\\.env',
    runKeyExists: async () => 'EXISTS',
    ...over,
  };
}

describe('handleKeyExists', () => {
  it('EXISTS token -> exists:true, no error', async () => {
    const r = await handleKeyExists({ key: 'K' }, deps());
    expect(r.isError).toBe(false);
    expect(r.exists).toBe(true);
  });
  it('ABSENT token -> exists:false', async () => {
    const r = await handleKeyExists({ key: 'K' }, deps({ runKeyExists: async () => 'ABSENT' }));
    expect(r.isError).toBe(false);
    expect(r.exists).toBe(false);
  });
  it('unrecognized token -> error, never echoed, exists undefined', async () => {
    const leak = 'K=SENTINEL-leak-123';
    const r = await handleKeyExists({ key: 'K' }, deps({ runKeyExists: async () => leak }));
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain('SENTINEL');
    expect(r.exists).toBeUndefined();
  });
  it('non-Windows -> error, PS not run', async () => {
    let ran = false;
    const r = await handleKeyExists({ key: 'K' }, deps({ platform: 'darwin', runKeyExists: async () => { ran = true; return 'EXISTS'; } }));
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Windows');
    expect(ran).toBe(false);
  });
  it('invalid key -> error before running', async () => {
    let ran = false;
    const r = await handleKeyExists({ key: 'bad-key' }, deps({ validateKey: () => false, runKeyExists: async () => { ran = true; return 'EXISTS'; } }));
    expect(r.isError).toBe(true);
    expect(ran).toBe(false);
  });
});
