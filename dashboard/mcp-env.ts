#!/usr/bin/env bun
/**
 * MCP stdio server: env-scoped QA operations for agents.
 *
 * Deliberately has no env/path argument. The tool runs `qa-env` from the
 * session cwd; that helper finds qa/env.json, proves the worktree matches the
 * slot, and applies its own locks. An agent cannot name another environment.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP stdio).
 */

const QA_ENV = '/workspaces/studiq/.worktrees/qa-env/qa/tools/qa-env';

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'studiq-qa-env', version: '1.0.0' };

function tool(name: string, description: string) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  };
}

const TOOLS = [
  tool(
    'status',
    'Current state of YOUR QA env: app pid/http, admin pid/http and lock owner, Supabase health, op lock. No arguments.',
  ),
  tool(
    'reset',
    'DESTRUCTIVE: reset the database of YOUR QA env and re-seed it. Serialized by the env lock. Use only after confirming the finding and capturing evidence.',
  ),
  tool('reseed', 'Alias for reset: reset the database of YOUR QA env and re-seed it.'),
  tool(
    'restart_app',
    'Restart the web app of YOUR QA env and wait until it answers. Serialized by the env lock.',
  ),
  tool(
    'restart_browser',
    'Restart the Chromium instance of YOUR QA env (the dashboard tile reconnects).',
  ),
  tool(
    'admin_up',
    'Start the admin panel of YOUR QA env. Exclusive across all envs: fails with the current holder if another slot owns it.',
  ),
  tool(
    'admin_down',
    'Stop the admin panel of YOUR QA env and release the admin lock if you own it.',
  ),
  tool('lock', 'Show the op lock and admin lock for YOUR QA env.'),
];

async function run(action: string): Promise<any> {
  const proc = Bun.spawn(['python3', QA_ENV, action], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let parsed: any;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    parsed = { ok: false, error: (stdout || stderr || `qa-env exited ${code}`).trim() };
  }
  if (code !== 0 || parsed?.ok === false) {
    throw new Error(parsed?.error ?? stderr.trim() ?? `qa-env exited ${code}`);
  }
  return parsed;
}

function send(message: any): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: string | number | null | undefined, result: any): void {
  if (id === undefined) return;
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id: string | number | null | undefined, code: number, message: string): void {
  if (id === undefined) return;
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(message: JsonRpc): Promise<void> {
  const { id, method, params } = message;
  if (!method) return;

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Env-scoped QA operations. Tools act on the environment of the current session; there is no env or path argument.',
      });
      return;
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
      return;
    case 'ping':
      reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;
    case 'tools/call': {
      const name = String(params?.name ?? '');
      if (!TOOLS.some((entry) => entry.name === name)) {
        replyError(id, -32602, `unknown tool: ${name}`);
        return;
      }
      try {
        const result = await run(name);
        reply(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (err) {
        reply(id, {
          content: [
            { type: 'text', text: JSON.stringify({ ok: false, error: (err as Error).message }) },
          ],
          isError: true,
        });
      }
      return;
    }
    case 'resources/list':
      reply(id, { resources: [] });
      return;
    case 'resources/templates/list':
      reply(id, { resourceTemplates: [] });
      return;
    case 'prompts/list':
      reply(id, { prompts: [] });
      return;
    case 'logging/setLevel':
      reply(id, {});
      return;
    default:
      if (id !== undefined) replyError(id, -32601, `method not found: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message: JsonRpc;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message).catch((err) => {
      replyError(message.id, -32603, (err as Error).message);
    });
  }
});

process.stdin.on('end', () => process.exit(0));
