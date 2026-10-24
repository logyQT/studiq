#!/usr/bin/env bun
/**
 * MCP stdio server exposing the QA browser to opencode agents.
 *
 * Tools are exposed by OpenCode as qa_browser_* (server name + tool name) and
 * drive the same Chromium instances that the dashboard streams. The env is resolved per call from the optional `env`
 * argument, QA_ENV_ID, qa/env.json in cwd (or a parent), or the cwd path.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP stdio).
 */

import {
  click,
  closeTab,
  evaluateExpression,
  getState,
  listTabs,
  navigate,
  navigateHistory,
  newTab,
  press,
  readConsoleLog,
  readNetworkLog,
  reload,
  resolveEnv,
  screenshot,
  scroll,
  selectTab,
  typeText,
  waitForCondition,
} from './browser-core';

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
};

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'studiq-qa-browser', version: '1.0.0' };

const envProperty = {
  type: 'string',
  description:
    'QA environment, e.g. qa-env-3 (or 3). Defaults to QA_ENV_ID / qa/env.json in the current directory.',
};

function tool(
  name: string,
  description: string,
  properties: Record<string, any> = {},
  required: string[] = [],
) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: { ...properties, env: envProperty },
      required,
      additionalProperties: false,
    },
  };
}

const TOOLS = [
  tool(
    'navigate',
    'Navigate the live QA browser to a URL and wait for the page to load. Returns the final URL/title and recent HTTP responses (status, x-trace-id).',
    { url: { type: 'string', description: 'Absolute or relative URL.' } },
    ['url'],
  ),
  tool('state', 'Return the current URL, title and viewport of the live QA browser.'),
  tool(
    'click',
    'Click in the live QA browser. Prefer `selector`; `text` clicks the smallest visible element containing the label; `x`/`y` use 1920x1080 viewport coordinates.',
    {
      selector: { type: 'string', description: 'CSS selector.' },
      text: { type: 'string', description: 'Visible text to search for.' },
      x: { type: 'number' },
      y: { type: 'number' },
      double: { type: 'boolean' },
      button: { type: 'string', enum: ['left', 'right', 'middle'] },
    },
  ),
  tool(
    'type',
    'Focus an input (optional selector) and insert text. Set clear=true to select-all + delete first.',
    {
      text: { type: 'string' },
      selector: { type: 'string' },
      clear: { type: 'boolean' },
    },
    ['text'],
  ),
  tool(
    'press',
    'Press a key or key combo, e.g. Enter, Tab, Escape, Control+a, ArrowDown, PageDown. Optionally focuses a selector first.',
    { key: { type: 'string' }, selector: { type: 'string' } },
    ['key'],
  ),
  tool(
    'scroll',
    'Scroll the page with a real mouse-wheel event. Optionally centre on a selector.',
    {
      x: { type: 'number' },
      y: { type: 'number' },
      delta_x: { type: 'number' },
      delta_y: { type: 'number' },
      selector: { type: 'string' },
    },
  ),
  tool(
    'wait_for',
    'Wait until a selector exists, text appears, URL contains a string, or a JS expression is truthy. Set gone=true to wait for absence.',
    {
      selector: { type: 'string' },
      text: { type: 'string' },
      url: { type: 'string' },
      expression: { type: 'string' },
      gone: { type: 'boolean' },
      timeout_ms: { type: 'number' },
    },
  ),
  tool(
    'evaluate',
    'Evaluate a JavaScript expression in the page and return its JSON value (DOM queries, app state, fetch).',
    { expression: { type: 'string' } },
    ['expression'],
  ),
  tool(
    'screenshot',
    'Capture a PNG of the live page. Saved to dashboard/shots/qa-env-N-<timestamp>.png; returns the absolute path for `gh issue create --attach`.',
    { name: { type: 'string' }, full_page: { type: 'boolean' } },
  ),
  tool('tabs', "List page tabs in this env's browser and show the active one."),
  tool('new_tab', "Open a new tab (defaults to the env's app URL) and make it active.", {
    url: { type: 'string' },
  }),
  tool(
    'select_tab',
    'Select a tab by id, id prefix, index, or URL/title substring.',
    {
      tab: { type: 'string' },
    },
    ['tab'],
  ),
  tool('close_tab', 'Close a tab by id/prefix/index/URL substring (default: active tab).', {
    tab: { type: 'string' },
  }),
  tool('back', "Go back in the active tab's history."),
  tool('forward', "Go forward in the active tab's history."),
  tool('reload', 'Reload the active tab.'),
  tool(
    'network',
    'Read recent HTTP responses captured from the live page (URL, status, x-trace-id). Useful for correlating a failure with Tempo.',
    { limit: { type: 'number' }, filter: { type: 'string' } },
  ),
  tool('console', 'Read recent console messages and uncaught exceptions from the live page.', {
    limit: { type: 'number' },
  }),
];

async function dispatch(name: string, args: any): Promise<any> {
  const env = resolveEnv(args?.env);

  switch (name) {
    case 'navigate':
      return navigate(env, String(args.url));
    case 'state':
      return getState(env);
    case 'click':
      return click(env, {
        selector: args.selector,
        text: args.text,
        x: args.x,
        y: args.y,
        double: args.double,
        button: args.button,
      });
    case 'type':
      return typeText(env, String(args.text ?? ''), {
        selector: args.selector,
        clear: Boolean(args.clear),
      });
    case 'press':
      return press(env, String(args.key), { selector: args.selector });
    case 'scroll':
      return scroll(env, {
        x: args.x,
        y: args.y,
        deltaX: args.delta_x,
        deltaY: args.delta_y,
        selector: args.selector,
      });
    case 'wait_for':
      return waitForCondition(env, {
        selector: args.selector,
        text: args.text,
        url: args.url,
        expression: args.expression,
        gone: Boolean(args.gone),
        timeoutMs: args.timeout_ms,
      });
    case 'evaluate':
      return evaluateExpression(env, String(args.expression));
    case 'screenshot':
      return screenshot(env, { name: args.name, fullPage: Boolean(args.full_page) });
    case 'tabs':
      return listTabs(env);
    case 'new_tab':
      return newTab(env, args.url);
    case 'select_tab':
      return selectTab(env, String(args.tab));
    case 'close_tab':
      return closeTab(env, args.tab ? String(args.tab) : undefined);
    case 'back':
      return navigateHistory(env, -1);
    case 'forward':
      return navigateHistory(env, 1);
    case 'reload':
      return reload(env);
    case 'network':
      return {
        env: env.name,
        entries: readNetworkLog(env, Number(args.limit) || 40, args.filter),
      };
    case 'console':
      return { env: env.name, entries: readConsoleLog(env, Number(args.limit) || 40) };
    default:
      throw new Error(`unknown tool: ${name}`);
  }
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
          'Drives the live Chromium for the current QA environment (the same browser shown in the dashboard tile). Pass env=qa-env-N when running outside that worktree.',
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
        const result = await dispatch(name, params?.arguments ?? {});
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
