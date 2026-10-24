/**
 * Shared browser operations for the QA agent interfaces (CLI + MCP).
 *
 * Every operation talks to the Chromium that the dashboard is streaming, so
 * what the agent does is exactly what a human sees in the corresponding tile.
 */

import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { activeTargetId, clearActiveTarget, setActiveTarget, sleep } from './browser-state';
import { ensureBrowser } from './browsers';
import {
  applyViewport,
  CdpClient,
  type CdpTarget,
  closeTarget,
  connectToPage,
  evaluate,
  listTargets,
  navigateTo,
  newTarget,
  pageState,
  waitFor,
  waitForLoad,
  waitForNavigation,
} from './cdp';
import {
  BROWSER_HEIGHT,
  BROWSER_WIDTH,
  type EnvConfig,
  ensureDirs,
  envByName,
  LOGS_DIR,
  SHOTS_DIR,
} from './config';

const LOG_ROTATE_BYTES = 2_000_000;

/**
 * Hard cap on dashboard/shots: every capture prunes the oldest images past it.
 * The dir is dedicated to evidence, so any .png counts (older naming included);
 * non-images are left alone.
 */
const SHOTS_MAX = Number(process.env.SHOTS_MAX ?? 1000);
const SHOT_NAME = /\.png$/i;

export function pruneShots(max = SHOTS_MAX): { removed: number; kept: number } {
  try {
    const files = readdirSync(SHOTS_DIR)
      .filter((name) => SHOT_NAME.test(name))
      .map((name) => {
        const path = join(SHOTS_DIR, name);
        try {
          return { path, mtime: statSync(path).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { path: string; mtime: number } => entry !== null)
      .sort((a, b) => a.mtime - b.mtime);
    let removed = 0;
    while (files.length > Math.max(1, max)) {
      const oldest = files.shift();
      if (!oldest) break;
      try {
        unlinkSync(oldest.path);
        removed += 1;
      } catch {
        break;
      }
    }
    return { removed, kept: files.length };
  } catch {
    return { removed: 0, kept: 0 };
  }
}

/* --------------------------------------------------------------- env lookup */

function envFromJsonFile(dir: string): EnvConfig | null {
  const file = join(dir, 'qa', 'env.json');
  if (!existsSync(file)) return null;
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof json.envId === 'string') {
      const env = envByName(json.envId);
      if (env) return env;
    }
    if (typeof json.appUrl === 'string') {
      const port = Number(new URL(json.appUrl).port);
      const env = envByName(String(port - 3009));
      if (env) return env;
    }
  } catch {}
  return null;
}

/**
 * Resolve the env from (in order): an explicit argument, QA_ENV_ID, a
 * `qa/env.json` in cwd or a parent, or a `.worktrees/qa-env-N` path segment.
 */
export function resolveEnv(explicit?: string | number | null): EnvConfig {
  if (explicit !== undefined && explicit !== null && String(explicit).length > 0) {
    const env = envByName(String(explicit));
    if (!env) throw new Error(`unknown env: ${explicit} (expected qa-env-1..8 or 1..8)`);
    return env;
  }

  const fromVar = process.env.QA_ENV_ID;
  if (fromVar) {
    const env = envByName(fromVar);
    if (env) return env;
  }

  let dir = process.cwd();
  for (;;) {
    const env = envFromJsonFile(dir);
    if (env) return env;
    const norm = dir.replaceAll('\\', '/');
    const match = /(?:^|\/)(qa-env-[1-8])(?:\/|$)/.exec(norm);
    if (match) {
      const byPath = envByName(match[1]!);
      if (byPath) return byPath;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    'cannot determine QA env. Run from a qa-env-N worktree or pass --env qa-env-N / set QA_ENV_ID.',
  );
}

/* ------------------------------------------------------------------- logging */

function appendJsonLine(file: string, value: unknown): void {
  try {
    ensureDirs();
    if (existsSync(file) && statSync(file).size > LOG_ROTATE_BYTES) {
      try {
        renameSync(file, `${file}.1`);
      } catch {}
    }
    appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
  } catch {}
}

function logFile(env: EnvConfig, kind: string): string {
  return join(LOGS_DIR, `${env.name}-${kind}.jsonl`);
}

export function recordNetwork(env: EnvConfig, entry: any): void {
  appendJsonLine(logFile(env, 'network'), { ts: new Date().toISOString(), ...entry });
}

export function recordConsole(env: EnvConfig, entry: any): void {
  appendJsonLine(logFile(env, 'console'), { ts: new Date().toISOString(), ...entry });
}

function readLog(file: string, limit: number): any[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  const slice = lines.slice(Math.max(0, lines.length - limit));
  const out: any[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

export function readNetworkLog(env: EnvConfig, limit = 60, filter?: string): any[] {
  const entries = readLog(logFile(env, 'network'), Math.max(limit * 4, 200));
  const filtered = filter
    ? entries.filter((entry) => String(entry.url ?? '').includes(filter))
    : entries;
  return filtered.slice(-limit);
}

export function readConsoleLog(env: EnvConfig, limit = 60): any[] {
  return readLog(logFile(env, 'console'), limit);
}

/* --------------------------------------------------------------- connection */

async function withPage<T>(
  env: EnvConfig,
  fn: (cdp: CdpClient, target: CdpTarget) => Promise<T>,
): Promise<T> {
  // Guarantees the browser is up and the page is 1920x1080 even after a
  // restart. Cheap enough for a one-shot CLI call.
  await ensureBrowser(env);
  const { cdp, target } = await connectToPage(env.cdpPort, {
    preferredId: activeTargetId(env.name) ?? undefined,
    createUrl: env.startUrl,
  });
  try {
    await applyViewport(cdp, BROWSER_WIDTH, BROWSER_HEIGHT);
    return await fn(cdp, target);
  } finally {
    cdp.close();
  }
}

function normalizeUrl(input: string, base?: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('empty URL');
  if (/^[a-z]+:\/\//i.test(raw) || raw.startsWith('about:') || raw.startsWith('data:')) {
    return raw;
  }
  if (raw.startsWith('/') && base) return new URL(raw, base).toString();
  if (/^localhost(?::\d+)?(?:\/|$)/i.test(raw) || /^\d+\.\d+\.\d+\.\d+/.test(raw)) {
    return `http://${raw}`;
  }
  if (/^[^\s/]+\.[^\s/]+/.test(raw)) return `https://${raw}`;
  return new URL(raw, base ?? envBase()).toString();
}

let currentEnvBase = 'http://localhost:3010';
function envBase(): string {
  return currentEnvBase;
}

export function setEnvBase(env: EnvConfig): void {
  currentEnvBase = env.startUrl;
}

/* --------------------------------------------------------------- operations */

export type NavigateResult = {
  env: string;
  url: string;
  title: string;
  readyState: string;
  responses: Array<{
    url: string;
    status: number;
    type?: string;
    mimeType?: string;
    traceId?: string | null;
    location?: string | null;
  }>;
};

export async function navigate(
  env: EnvConfig,
  input: string,
  options: { timeoutMs?: number } = {},
): Promise<NavigateResult> {
  setEnvBase(env);
  const url = normalizeUrl(input);
  return withPage(env, async (cdp) => {
    const responses: NavigateResult['responses'] = [];
    const seen = new Set<string>();
    await cdp.send('Network.enable').catch(() => {});
    const off = cdp.on('Network.responseReceived', (params) => {
      const response = params.response ?? {};
      const key = `${params.requestId}:${response.status}`;
      if (seen.has(key)) return;
      seen.add(key);
      const headers = response.headers ?? {};
      const lower: Record<string, string> = {};
      for (const [key2, value] of Object.entries(headers))
        lower[key2.toLowerCase()] = String(value);
      const entry = {
        url: String(response.url ?? ''),
        status: Number(response.status ?? 0),
        type: params.type,
        mimeType: response.mimeType,
        traceId: lower['x-trace-id'] ?? null,
        location: lower['location'] ?? null,
      };
      responses.push(entry);
      recordNetwork(env, entry);
    });
    try {
      await navigateTo(cdp, url, options.timeoutMs ?? 20_000);
      await waitForLoad(cdp, 5000);
      await new Promise((resolve) => setTimeout(resolve, 350));
      const state = await pageState(cdp);
      return {
        env: env.name,
        url: state.url,
        title: state.title,
        readyState: state.readyState,
        responses: responses.slice(-40),
      };
    } finally {
      off();
    }
  });
}

export async function getState(env: EnvConfig): Promise<any> {
  return withPage(env, async (cdp) => {
    const state = await pageState(cdp);
    const viewport = await evaluate(
      cdp,
      '({innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY, scrollWidth: document.documentElement?.scrollWidth ?? null, scrollHeight: document.documentElement?.scrollHeight ?? null})',
    );
    return { env: env.name, ...state, viewport };
  });
}

function elementInfoExpression(selector?: string, text?: string): string {
  if (selector) {
    return `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: "selector not found" };
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { ok: true, tag: el.tagName, text: (el.innerText || el.value || "").slice(0, 120),
               x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
    })()`;
  }
  if (text) {
    return `(() => {
      const needle = ${JSON.stringify(text)};
      const all = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"],label,li,summary,span,div'));
      let best = null;
      for (const el of all) {
        const value = (el.innerText || el.value || "").trim();
        if (!value) continue;
        if (!value.toLowerCase().includes(needle.toLowerCase())) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const area = r.width * r.height;
        if (!best || area < best.area) best = { el, area };
      }
      if (!best) return { ok: false, reason: "text not found" };
      const el = best.el;
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { ok: true, tag: el.tagName, text: (el.innerText || el.value || "").slice(0, 120),
               x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
    })()`;
  }
  return '';
}

export type ClickOptions = {
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  double?: boolean;
};

export async function click(env: EnvConfig, options: ClickOptions): Promise<any> {
  setEnvBase(env);
  return withPage(env, async (cdp) => {
    let x = options.x ?? 0;
    let y = options.y ?? 0;
    let info: any = null;

    if (options.selector || options.text) {
      const expression = elementInfoExpression(options.selector, options.text);
      info = await evaluate(cdp, expression);
      if (!info?.ok) throw new Error(info?.reason ?? 'element not found');
      await new Promise((resolve) => setTimeout(resolve, 120));
      info = await evaluate(cdp, expression);
      if (!info?.ok) throw new Error(info?.reason ?? 'element not found after scroll');
      x = info.x;
      y = info.y;
    }

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      (x === 0 && y === 0 && !options.selector && !options.text)
    ) {
      throw new Error('click needs --selector, --text, or --x/--y');
    }

    x = Math.max(0, Math.min(BROWSER_WIDTH - 1, Math.round(x)));
    y = Math.max(0, Math.min(BROWSER_HEIGHT - 1, Math.round(y)));
    const button = options.button ?? 'left';
    const buttons = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
    const baseCount = options.double ? 2 : (options.clickCount ?? 1);

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
    });

    const sequence = options.double ? [1, 2] : [baseCount];
    for (const clickCount of sequence) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button,
        buttons,
        clickCount,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button,
        buttons: 0,
        clickCount,
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
    return { env: env.name, clicked: { x, y, button, clickCount: baseCount }, element: info };
  });
}

export async function typeText(
  env: EnvConfig,
  text: string,
  options: { selector?: string; clear?: boolean } = {},
): Promise<any> {
  setEnvBase(env);
  return withPage(env, async (cdp) => {
    if (options.selector) {
      const focused = await evaluate(
        cdp,
        `(() => {
          const el = document.querySelector(${JSON.stringify(options.selector)});
          if (!el) return { ok: false };
          el.focus();
          if (typeof el.click === "function") el.click();
          return { ok: true, tag: el.tagName, value: el.value ?? null };
        })()`,
      );
      if (!focused?.ok) throw new Error(`selector not found: ${options.selector}`);
    }

    if (options.clear) {
      await pressKey(cdp, 'Control+A');
      await pressKey(cdp, 'Backspace');
    }

    await cdp.send('Input.insertText', { text });
    await new Promise((resolve) => setTimeout(resolve, 120));

    let value: any = null;
    if (options.selector) {
      value = await evaluate(
        cdp,
        `(() => { const el = document.querySelector(${JSON.stringify(options.selector)});
          return el ? (el.value ?? el.innerText ?? null) : null; })()`,
      );
    }
    return { env: env.name, typed: text.length, selector: options.selector ?? null, value };
  });
}

type KeySpec = {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
  modifiers: number;
};

const NAMED_KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  return: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};

for (let i = 1; i <= 12; i++) {
  NAMED_KEYS[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };
}

function parseCombo(combo: string): KeySpec {
  const raw = combo.trim();
  if (!raw) throw new Error('empty key');

  // A bare "+" is the plus key, not an empty modifier split.
  const parts = raw === '+' ? ['+'] : raw.split('+').filter((p) => p.length > 0);
  let modifiers = 0;
  const modNames = new Set<string>();
  while (parts.length > 1) {
    const mod = parts[0]!.toLowerCase();
    if (mod === 'ctrl' || mod === 'control') {
      modifiers |= 2;
      modNames.add('ctrl');
    } else if (mod === 'alt' || mod === 'option') {
      modifiers |= 1;
      modNames.add('alt');
    } else if (mod === 'meta' || mod === 'cmd' || mod === 'command' || mod === 'super') {
      modifiers |= 4;
      modNames.add('meta');
    } else if (mod === 'shift') {
      modifiers |= 8;
      modNames.add('shift');
    } else if (mod === 'controlormeta') {
      modifiers |= 2;
      modNames.add('ctrl');
    } else {
      break;
    }
    parts.shift();
  }

  const keyName = parts.join('+') || raw;
  const named = NAMED_KEYS[keyName.toLowerCase()];
  if (named) {
    return {
      key: named.key,
      code: named.code,
      keyCode: named.keyCode,
      text: named.text,
      modifiers,
    };
  }

  if (keyName.length === 1) {
    const upper = keyName.toUpperCase();
    const isLetter = /^[a-z]$/i.test(keyName);
    const isDigit = /^[0-9]$/.test(keyName);
    const code = isLetter ? `Key${upper}` : isDigit ? `Digit${keyName}` : '';
    const keyCode = isLetter
      ? upper.charCodeAt(0)
      : isDigit
        ? keyName.charCodeAt(0)
        : keyName.charCodeAt(0);
    const shiftApplied = (modifiers & 8) !== 0 && isLetter;
    const plainKey =
      (modifiers & (2 | 4)) !== 0 && !shiftApplied && isLetter ? keyName.toLowerCase() : keyName;
    const text = modifiers & (2 | 4 | 1) ? undefined : shiftApplied ? upper : keyName;
    return {
      key: shiftApplied ? upper : plainKey,
      code: code || `Key${upper}`,
      keyCode,
      text,
      modifiers,
    };
  }

  throw new Error(`unsupported key: ${combo}`);
}

async function pressKey(cdp: CdpClient, combo: string): Promise<void> {
  const spec = parseCombo(combo);
  const common = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.keyCode,
    nativeVirtualKeyCode: spec.keyCode,
    modifiers: spec.modifiers,
  };
  const hasText =
    typeof spec.text === 'string' && spec.text.length > 0 && !(spec.modifiers & (1 | 2 | 4));
  await cdp.send('Input.dispatchKeyEvent', {
    type: hasText ? 'keyDown' : 'rawKeyDown',
    ...common,
    ...(hasText ? { text: spec.text, unmodifiedText: spec.text } : {}),
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

export async function press(
  env: EnvConfig,
  combo: string,
  options: { selector?: string } = {},
): Promise<any> {
  setEnvBase(env);
  return withPage(env, async (cdp) => {
    if (options.selector) {
      const focused = await evaluate(
        cdp,
        `(() => { const el = document.querySelector(${JSON.stringify(options.selector)});
          if (!el) return false; el.focus(); return true; })()`,
      );
      if (!focused) throw new Error(`selector not found: ${options.selector}`);
    }
    await pressKey(cdp, combo);
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { env: env.name, pressed: combo, selector: options.selector ?? null };
  });
}

export async function scroll(
  env: EnvConfig,
  options: { x?: number; y?: number; deltaX?: number; deltaY?: number; selector?: string } = {},
): Promise<any> {
  setEnvBase(env);
  return withPage(env, async (cdp) => {
    let x = options.x ?? BROWSER_WIDTH / 2;
    let y = options.y ?? BROWSER_HEIGHT / 2;
    if (options.selector) {
      const rect = await evaluate(
        cdp,
        `(() => { const el = document.querySelector(${JSON.stringify(options.selector)});
          if (!el) return null; el.scrollIntoView({block:"center"}); const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      if (!rect) throw new Error(`selector not found: ${options.selector}`);
      x = rect.x;
      y = rect.y;
    }
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(x),
      y: Math.round(y),
      deltaX: options.deltaX ?? 0,
      deltaY: options.deltaY ?? 600,
      modifiers: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const position = await evaluate(cdp, '({scrollX, scrollY})');
    return {
      env: env.name,
      scrolled: { x, y, deltaX: options.deltaX ?? 0, deltaY: options.deltaY ?? 600 },
      position,
    };
  });
}

export type WaitOptions = {
  selector?: string;
  text?: string;
  url?: string;
  expression?: string;
  gone?: boolean;
  timeoutMs?: number;
  intervalMs?: number;
};

export async function waitForCondition(env: EnvConfig, options: WaitOptions): Promise<any> {
  setEnvBase(env);
  return withPage(env, async (cdp) => {
    let predicate = options.expression;
    if (!predicate && options.selector) {
      predicate = `!!document.querySelector(${JSON.stringify(options.selector)})`;
    } else if (!predicate && options.text) {
      predicate = `(document.body?.innerText ?? "").includes(${JSON.stringify(options.text)})`;
    } else if (!predicate && options.url) {
      predicate = `location.href.includes(${JSON.stringify(options.url)})`;
    }
    if (!predicate) throw new Error('wait needs --selector, --text, --url, or --expression');
    if (options.gone) predicate = `!(${predicate})`;

    const value = await waitFor(
      cdp,
      predicate,
      options.timeoutMs ?? 15_000,
      options.intervalMs ?? 150,
    );
    return { env: env.name, matched: value, waited: { ...options } };
  });
}

export async function evaluateExpression(env: EnvConfig, expression: string): Promise<any> {
  setEnvBase(env);
  return withPage(env, async (cdp) => {
    let value: any;
    try {
      value = await evaluate(cdp, expression);
    } catch (err) {
      throw new Error((err as Error).message);
    }
    return { env: env.name, value, type: typeof value };
  });
}

export async function screenshot(
  env: EnvConfig,
  options: { name?: string; fullPage?: boolean } = {},
): Promise<any> {
  setEnvBase(env);
  ensureDirs();
  return withPage(env, async (cdp) => {
    const params: any = { format: 'png', fromSurface: true, captureBeyondViewport: false };
    let clip: any = null;
    if (options.fullPage) {
      const metrics: any = await cdp.send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize ?? metrics.contentSize;
      if (size) {
        clip = {
          x: 0,
          y: 0,
          width: Math.ceil(size.width),
          height: Math.min(Math.ceil(size.height), 10000),
          scale: 1,
        };
        params.captureBeyondViewport = true;
        params.clip = clip;
      }
    }
    const result: any = await cdp.send('Page.captureScreenshot', params, 30_000);
    const data = Buffer.from(result.data, 'base64');
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-');
    const safeName = (options.name ?? '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    const filename = `${env.name}-${stamp}${safeName ? `-${safeName}` : ''}.png`;
    const path = join(SHOTS_DIR, filename);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, data);
    pruneShots();
    return {
      env: env.name,
      path,
      bytes: data.byteLength,
      width: clip?.width ?? BROWSER_WIDTH,
      height: clip?.height ?? BROWSER_HEIGHT,
      fullPage: Boolean(options.fullPage),
      url: (await pageState(cdp)).url,
    };
  });
}

/* ------------------------------------------------------------------- tabs */

export async function listTabs(env: EnvConfig): Promise<any> {
  await ensureBrowser(env);
  const targets = await listTargets(env.cdpPort);
  const active = activeTargetId(env.name);
  return {
    env: env.name,
    tabs: targets.map((target, index) => ({
      index,
      id: target.id,
      url: target.url,
      title: target.title,
      active: target.id === active || (!active && index === 0),
    })),
  };
}

function pickTab(env: EnvConfig, targets: CdpTarget[], ref?: string): CdpTarget {
  const active = activeTargetId(env.name);
  if (!ref) {
    const target = targets.find((t) => t.id === active) ?? targets[0];
    if (!target) throw new Error('no tabs open');
    return target;
  }
  const byId = targets.find((t) => t.id === ref);
  if (byId) return byId;
  const byPrefix = targets.find((t) => t.id.startsWith(ref));
  if (byPrefix) return byPrefix;
  if (/^\d+$/.test(ref)) {
    const target = targets[Number(ref)];
    if (target) return target;
  }
  const byUrl = targets.find((t) => t.url.includes(ref) || t.title.includes(ref));
  if (byUrl) return byUrl;
  throw new Error(`tab not found: ${ref}`);
}

export async function newTab(env: EnvConfig, url?: string): Promise<any> {
  setEnvBase(env);
  await ensureBrowser(env);
  const target = await newTarget(env.cdpPort, url ? normalizeUrl(url) : env.startUrl);
  const { cdp } = await connectToPage(env.cdpPort, { preferredId: target.id });
  try {
    await applyViewport(cdp);
    await waitFor(
      cdp,
      "document.readyState === 'complete' && location.href !== 'about:blank'",
      15_000,
    ).catch(() => {});
  } finally {
    cdp.close();
  }
  setActiveTarget(env.name, target.id);
  return {
    env: env.name,
    tab: { id: target.id, url: target.url, title: target.title },
    active: true,
  };
}

export async function selectTab(env: EnvConfig, ref: string): Promise<any> {
  await ensureBrowser(env);
  const targets = await listTargets(env.cdpPort);
  const target = pickTab(env, targets, ref);
  const { cdp } = await connectToPage(env.cdpPort, { preferredId: target.id });
  try {
    await applyViewport(cdp);
    await cdp.send('Page.bringToFront').catch(() => {});
  } finally {
    cdp.close();
  }
  setActiveTarget(env.name, target.id);
  return { env: env.name, activeTab: { id: target.id, url: target.url, title: target.title } };
}

export async function closeTab(env: EnvConfig, ref?: string): Promise<any> {
  await ensureBrowser(env);
  const targets = await listTargets(env.cdpPort);
  const target = pickTab(env, targets, ref);
  const wasActive = (activeTargetId(env.name) ?? targets[0]?.id) === target.id;
  await closeTarget(env.cdpPort, target.id);
  await sleep(250);
  let next: CdpTarget | undefined;
  if (wasActive) {
    const remaining = await listTargets(env.cdpPort);
    next = remaining[0];
    if (next) setActiveTarget(env.name, next.id);
    else clearActiveTarget(env.name);
  }
  return {
    env: env.name,
    closed: { id: target.id, url: target.url },
    activeTab: next ? { id: next.id, url: next.url, title: next.title } : null,
  };
}

/* --------------------------------------------------------------- history */

export async function navigateHistory(env: EnvConfig, delta: -1 | 1): Promise<any> {
  setEnvBase(env);
  return withPage(env, async (cdp) => {
    const history: any = await cdp.send('Page.getNavigationHistory');
    const index = history.currentIndex + delta;
    const entry = history.entries?.[index];
    if (!entry) throw new Error(`cannot go ${delta < 0 ? 'back' : 'forward'}: no history entry`);
    await waitForNavigation(
      cdp,
      () => cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id }),
      15_000,
    );
    await waitForLoad(cdp, 5000);
    const state = await pageState(cdp);
    return { env: env.name, url: state.url, title: state.title };
  });
}

export async function reload(env: EnvConfig): Promise<any> {
  setEnvBase(env);
  return withPage(env, async (cdp) => {
    await applyViewport(cdp);
    await waitForNavigation(cdp, () => cdp.send('Page.reload', { ignoreCache: false }), 20_000);
    await waitForLoad(cdp, 5000);
    const state = await pageState(cdp);
    return { env: env.name, url: state.url, title: state.title, reloaded: true };
  });
}
