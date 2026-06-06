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

  it('maps ERR:CODE (in enum) to an error mentioning the code', async () => {
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

  it('does NOT echo an ERR code outside the fixed enum (spec fixed enum)', async () => {
    const r = await handleSetEnvSecret({ key: 'K' }, deps({ runDialog: async () => 'ERR:ABC_DEF' }));
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain('ABC_DEF');
    expect(r.text).toContain('INTERNAL');
  });
});
