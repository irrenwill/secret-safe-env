export interface HandlerDeps {
  validateKey: (key: string) => boolean;
  resolveEnvPath: (envPath: string | undefined) => string;
  runDialog: (key: string, envPath: string) => Promise<string>;
}

export interface HandlerResult {
  isError: boolean;
  text: string;
}

// Fixed status enum — the ONLY ERR codes that may be reflected back.
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
  // Echo a code ONLY if it is in the fixed enum; ANY other token collapses to a generic INTERNAL.
  if (token.startsWith('ERR:') && ERR_CODES.has(token.slice(4))) {
    return { isError: true, text: `Secret was not written (${token.slice(4)}).` };
  }
  return { isError: true, text: 'Secret was not written (INTERNAL).' };
}
