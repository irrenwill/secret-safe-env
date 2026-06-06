import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateKey, resolveEnvPath } from './validation.js';
import { runDialog } from './dialogRunner.js';
import { handleSetEnvSecret } from './handler.js';

const server = new McpServer({ name: 'secret-safe-env', version: '0.1.0' });

server.registerTool(
  'set_env_secret',
  {
    title: 'Set an .env secret (value never seen by the agent)',
    description:
      'Prompt the user, via a native masked dialog, to paste a secret that is written directly to .env by a local helper. ' +
      'You pass ONLY the key NAME (UPPER_SNAKE, e.g. OPENAI_API_KEY) and never receive the value. ' +
      'Use this whenever a secret or API key must be placed into a .env file.',
    inputSchema: {
      key: z.string().describe('The env var NAME, e.g. OPENAI_API_KEY (UPPER_SNAKE).'),
      env_path: z.string().optional().describe('Optional path to the .env file; defaults to ./.env.'),
    },
  },
  async ({ key, env_path }) => {
    const r = await handleSetEnvSecret({ key, env_path }, { validateKey, resolveEnvPath, runDialog });
    return { content: [{ type: 'text', text: r.text }], isError: r.isError };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
