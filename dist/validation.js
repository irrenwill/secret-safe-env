import path from 'node:path';
const KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
export function validateKey(key) {
    return KEY_RE.test(key);
}
export function resolveEnvPath(envPath) {
    if (envPath === undefined) {
        // A runner-launched MCP server's cwd is NOT the user's project; prefer the workspace env var.
        const base = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
        return path.resolve(base, '.env');
    }
    if (envPath.startsWith('-'))
        throw new Error('PATH_INVALID');
    return path.resolve(envPath);
}
