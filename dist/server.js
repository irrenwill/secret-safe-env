#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateKey, resolveEnvPath } from './validation.js';
import { runDialog } from './dialogRunner.js';
import { handleSetEnvSecret } from './handler.js';
import { runKeyExists, handleKeyExists } from './keyExists.js';
const server = new McpServer({ name: 'secret-safe-env', version: '0.1.0' }, {
    instructions: 'This server lets you (the agent) put a secret/API key/token/password into a project .env file WITHOUT ever seeing the value. ' +
        'When a task needs a secret in .env, call set_env_secret with ONLY the variable NAME; the user types the value into a local masked dialog and a local helper writes it straight to .env. ' +
        'NEVER ask the user to paste a secret into the chat; NEVER write the value or a placeholder yourself; NEVER cat/read .env to verify (that exposes it) - use env_key_exists to confirm. ' +
        'Pass the absolute project .env path as env_path. Values are single-line. Windows + PowerShell 5.1 only.',
});
server.registerTool('set_env_secret', {
    title: 'Set an .env secret (value never seen by the agent)',
    description: 'Use this WHENEVER a task needs a secret/API key/token/password/connection string/credential written to a project .env file - ' +
        'e.g. "add my OpenAI key", "set DATABASE_URL", "configure my .env", "save this API token". ' +
        'You pass ONLY the variable NAME; the user types the value into a local masked dialog and it is written straight to .env - you never see or handle the value. ' +
        'DO NOT ask the user to paste the secret into the chat; DO NOT write the value or a placeholder yourself; DO NOT cat/read .env to verify (use env_key_exists). ' +
        'The value must be single-line (not for multi-line PEM keys / JSON blobs - for those, tell the user to edit .env manually).',
    inputSchema: {
        key: z.string().describe('The env var NAME in UPPER_SNAKE_CASE, e.g. OPENAI_API_KEY, DATABASE_URL, STRIPE_SECRET_KEY.'),
        env_path: z.string().optional().describe('Absolute path to the project .env. Pass the project-root .env path explicitly; if omitted it defaults to <CLAUDE_PROJECT_DIR or cwd>/.env, which may NOT be your workspace when launched via a runner.'),
    },
    annotations: { title: 'Set an .env secret (value never seen by the agent)', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ key, env_path }) => {
    const r = await handleSetEnvSecret({ key, env_path }, { validateKey, resolveEnvPath, runDialog });
    return { content: [{ type: 'text', text: r.text }], isError: r.isError };
});
server.registerTool('env_key_exists', {
    title: 'Check if a key exists in .env',
    description: 'Check whether an environment variable NAME already exists in a project .env file. Returns ONLY true/false - never the value. ' +
        'Use this to verify set_env_secret worked, INSTEAD of reading/cat-ing .env (which would expose the secret).',
    inputSchema: {
        key: z.string().describe('The env var NAME to check, e.g. OPENAI_API_KEY.'),
        env_path: z.string().optional().describe('Absolute path to the project .env (same as set_env_secret). Defaults to <CLAUDE_PROJECT_DIR or cwd>/.env.'),
    },
    outputSchema: { exists: z.boolean() },
    annotations: { title: 'Check if a key exists in .env', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async ({ key, env_path }) => {
    const r = await handleKeyExists({ key, env_path }, { validateKey, resolveEnvPath, runKeyExists });
    if (r.isError)
        return { content: [{ type: 'text', text: r.text }], isError: true };
    return { content: [{ type: 'text', text: r.text }], structuredContent: { exists: r.exists }, isError: false };
});
const transport = new StdioServerTransport();
await server.connect(transport);
