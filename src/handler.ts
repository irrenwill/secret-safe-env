export interface HandlerDeps {
  platform?: string;
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
  'UNSUPPORTED_PLATFORM',
]);

export async function handleSetEnvSecret(
  args: { key: string; env_path?: string },
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'win32') {
    return {
      isError: true,
      text: `This tool requires Windows + Windows PowerShell 5.1; current platform is ${platform}. ` +
            `Do NOT write the secret yourself - tell the user this machine is unsupported.`,
    };
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
    token = (await deps.runDialog(args.key, envPath)).trim();
  } catch {
    return { isError: true, text: `Could not launch the secret dialog (INTERNAL); the value was not exposed. Tell the user and do not retry more than once.` };
  }

  if (token === 'OK') {
    return {
      isError: false,
      text: `Wrote ${args.key} to ${envPath}. Value hidden, never sent to you. ` +
            `Confirm with env_key_exists if needed; do NOT cat or read .env (that would expose the secret).`,
    };
  }
  if (token === 'CANCEL') {
    return {
      isError: false,
      text: `User cancelled; nothing written to ${envPath}. Ask the user whether to retry or skip. ` +
            `Never ask them to paste the secret into chat; never write a placeholder yourself. After a 2nd cancel, stop and ask how to proceed.`,
    };
  }
  if (token.startsWith('ERR:') && ERR_CODES.has(token.slice(4))) {
    return {
      isError: true,
      text: `Could not write ${args.key} (${token.slice(4)}); the value was not exposed. ` +
            `Tell the user the secret dialog failed; do not auto-retry more than once.`,
    };
  }
  return { isError: true, text: `Could not write ${args.key} (INTERNAL); the value was not exposed.` };
}
