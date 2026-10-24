#!/usr/bin/env bun
/**
 * QA browser CLI - the guaranteed agent interface.
 *
 *   bun /workspaces/studiq/.worktrees/qa-env/dashboard/browser-cli.ts <op> [args]
 *
 * The env is resolved from --env, QA_ENV_ID, qa/env.json in cwd (or a parent),
 * or the current .worktrees/qa-env-N path. Every operation targets the same
 * Chromium the dashboard streams in tile N.
 *
 * Output is machine-readable JSON on stdout. Screenshot paths are absolute.
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
  pruneShots,
  resolveEnv,
  screenshot,
  scroll,
  selectTab,
  typeText,
  waitForCondition,
} from './browser-core';
import { browserStatus } from './browsers';
import { type EnvConfig, envByName } from './config';

type Flags = Record<string, string | boolean>;
type Parsed = { positional: string[]; flags: Flags };

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--no-')) {
      flags[arg.slice(5)] = false;
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 2) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}

function str(flags: Flags, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function bool(flags: Flags, ...names: string[]): boolean {
  for (const name of names) {
    const value = flags[name];
    if (value === true || value === 'true' || value === '1') return true;
  }
  return false;
}

function num(flags: Flags, ...names: string[]): number | undefined {
  const value = str(flags, ...names);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function envFromArgs(flags: Flags): EnvConfig {
  const raw = str(flags, 'env', 'env-id', 'envId');
  if (raw) {
    const env = envByName(raw);
    if (!env) throw new Error(`unknown env: ${raw} (expected qa-env-1..4 or 1..4)`);
    return env;
  }
  return resolveEnv();
}

function requireText(positional: string[], flags: Flags, ...names: string[]): string {
  const fromFlag = str(flags, ...names);
  if (fromFlag !== undefined && fromFlag !== true && String(fromFlag).length > 0)
    return String(fromFlag);
  const text = positional.join(' ');
  if (!text) throw new Error(`missing text (pass it positionally or as --${names[0]})`);
  return text;
}

const HELP = `QA browser CLI

Usage: bun dashboard/browser-cli.ts <op> [args] [--env qa-env-N]

Env:
  navigate <url>                 navigate (waits for load, prints response headers incl. x-trace-id)
  state | url | title            current page state (url/title)
  back | forward | reload

Interaction:
  click --selector <css>         click an element (scrolls it into view)
  click --text <label>           click the smallest visible element containing text
  click --x <px> --y <px>        click viewport coordinates (1920x1080 space)
      [--double] [--button left|right|middle]
  type <text> [--selector <css>] focus an element and insert text [--clear]
  press <key> [--selector <css>] key combo, e.g. Enter, Tab, Escape, Control+a, ArrowDown
  scroll [--x px --y px] [--dy 600] [--dx 0] [--selector css]
  wait --selector <css> | --text <text> | --url <part> | --expression <js>
      [--timeout 15000] [--gone]

Inspection:
  eval <js expression>           evaluate DOM JS, returns JSON value
  screenshot [--name label] [--full]   saves dashboard/shots/qa-env-N-<ts>.png
  network [--limit 40] [--filter <url part>]   recent response log (status + trace id)
  console [--limit 40]           recent console/exceptions

Tabs:
  tabs | list-tabs
  new-tab [url]
  select-tab <id|prefix|index|url-part>
  close-tab [id|prefix|index|url-part]

Diagnostics:
  prune [--max N]                delete the oldest screenshots beyond the cap (default 500)
  status                         browser + page + viewport state
  browsers                       all four browsers
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);
  const op = (positional.shift() ?? 'help').toLowerCase();

  if (op === 'help' || flags.help === true) {
    console.log(HELP);
    return;
  }

  // prune is the one op that needs no env: it only walks dashboard/shots
  if (op === 'prune') {
    const max = num(flags, 'max', 'keep');
    console.log(JSON.stringify(pruneShots(max), null, 2));
    return;
  }

  const env = envFromArgs(flags);
  let result: any;

  switch (op) {
    case 'navigate':
    case 'goto':
    case 'open': {
      const url = requireText(positional, flags, 'url');
      result = await navigate(env, url, { timeoutMs: num(flags, 'timeout') });
      break;
    }
    case 'state':
    case 'info':
      result = await getState(env);
      break;
    case 'url': {
      const state = await getState(env);
      result = { env: env.name, url: state.url, title: state.title };
      break;
    }
    case 'title': {
      const state = await getState(env);
      result = { env: env.name, title: state.title, url: state.url };
      break;
    }
    case 'click': {
      result = await click(env, {
        selector: str(flags, 'selector', 'css'),
        text: str(flags, 'text', 'label'),
        x: num(flags, 'x'),
        y: num(flags, 'y'),
        double: bool(flags, 'double', 'dbl'),
        button: (str(flags, 'button') as any) ?? 'left',
      });
      break;
    }
    case 'type':
    case 'fill': {
      const text = requireText(positional, flags, 'text', 'value');
      result = await typeText(env, text, {
        selector: str(flags, 'selector', 'css'),
        clear: bool(flags, 'clear'),
      });
      break;
    }
    case 'press':
    case 'key': {
      const combo = requireText(positional, flags, 'key', 'combo');
      result = await press(env, combo, { selector: str(flags, 'selector', 'css') });
      break;
    }
    case 'scroll': {
      result = await scroll(env, {
        x: num(flags, 'x'),
        y: num(flags, 'y'),
        deltaX: num(flags, 'dx', 'delta-x', 'deltaX'),
        deltaY: num(flags, 'dy', 'delta-y', 'deltaY'),
        selector: str(flags, 'selector', 'css'),
      });
      break;
    }
    case 'wait':
    case 'wait-for':
    case 'waitfor': {
      result = await waitForCondition(env, {
        selector: str(flags, 'selector', 'css'),
        text: str(flags, 'text'),
        url: str(flags, 'url'),
        expression: str(flags, 'expression', 'expr'),
        gone: bool(flags, 'gone'),
        timeoutMs: num(flags, 'timeout') ?? 15_000,
      });
      break;
    }
    case 'eval':
    case 'evaluate':
    case 'js': {
      const expression = requireText(positional, flags, 'expression', 'expr');
      result = await evaluateExpression(env, expression);
      break;
    }
    case 'screenshot':
    case 'shot': {
      result = await screenshot(env, {
        name: str(flags, 'name', 'label'),
        fullPage: bool(flags, 'full', 'full-page', 'fullPage'),
      });
      break;
    }
    case 'tabs':
    case 'list-tabs':
      result = await listTabs(env);
      break;
    case 'new-tab':
    case 'newtab': {
      const url = positional.join(' ') || str(flags, 'url');
      result = await newTab(env, url);
      break;
    }
    case 'select-tab':
    case 'selecttab': {
      const ref = requireText(positional, flags, 'tab', 'id');
      result = await selectTab(env, ref);
      break;
    }
    case 'close-tab':
    case 'closetab': {
      const ref = positional.join(' ') || str(flags, 'tab', 'id') || undefined;
      result = await closeTab(env, ref);
      break;
    }
    case 'back':
      result = await navigateHistory(env, -1);
      break;
    case 'forward':
      result = await navigateHistory(env, 1);
      break;
    case 'reload':
      result = await reload(env);
      break;
    case 'network': {
      const limit = num(flags, 'limit') ?? 40;
      result = {
        env: env.name,
        entries: readNetworkLog(env, limit, str(flags, 'filter')),
      };
      break;
    }
    case 'console': {
      const limit = num(flags, 'limit') ?? 40;
      result = { env: env.name, entries: readConsoleLog(env, limit) };
      break;
    }
    case 'status': {
      const state = await getState(env).catch((err) => ({ error: (err as Error).message }));
      result = { env: env.name, ...state };
      break;
    }
    case 'browsers': {
      result = { browsers: await browserStatus(bool(flags, 'deep')) };
      break;
    }
    default:
      throw new Error(`unknown operation: ${op} (run with --help)`);
  }

  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2));
  process.exit(1);
});
