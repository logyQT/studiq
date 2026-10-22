/**
 * Chromium supervisor for the four QA environments.
 *
 *   bun dashboard/browsers.ts start [all|1 2 ...] [--force]
 *   bun dashboard/browsers.ts stop  [all|1 2 ...]
 *   bun dashboard/browsers.ts restart
 *   bun dashboard/browsers.ts status [--deep]
 *
 * One persistent headless Chromium per env, listening on 9221-9224 with a
 * profile under dashboard/.profiles/qa-env-N. The supervisor is idempotent:
 * it adopts a healthy browser, reaps a stale one by pid/port, and always
 * leaves exactly one 1920x1080 page target per env. It exits after writing
 * dashboard/browsers.json - the browsers themselves keep running detached.
 */

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  activeTargetId,
  type BrowserMap,
  type BrowserRecord,
  clearActiveTarget,
  getBrowserRecord,
  listenerPid,
  pidAlive,
  pidCmdline,
  readBrowsers,
  removeBrowserRecord,
  setActiveTarget,
  sleep,
  stopPid,
  writeBrowsers,
} from './browser-state';
import {
  applyViewport,
  cdpUp,
  closeTarget,
  connectToPage,
  listTargets,
  navigateTo,
  pageState,
  waitFor,
  waitForLoad,
} from './cdp';
import {
  BROWSER_HEIGHT,
  BROWSER_WIDTH,
  CHROME_PATH,
  ENVS,
  type EnvConfig,
  ensureDirs,
  envByN,
  LOGS_DIR,
} from './config';

const LAUNCH_TIMEOUT_MS = 25_000;

function chromeArgs(env: EnvConfig): string[] {
  return [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--noerrdialogs',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-session-crashed-bubble',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--disable-blink-features=AutomationControlled',
    '--metrics-recording-only',
    '--mute-audio',
    '--hide-crash-restore-bubble',
    '--window-size=1920,1080',
    '--window-position=0,0',
    '--force-device-scale-factor=1',
    '--lang=en-US',
    '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    `--user-data-dir=${env.profileDir}`,
    `--remote-debugging-port=${env.cdpPort}`,
    '--remote-allow-origins=*',
    'about:blank',
  ];
}

function logPath(env: EnvConfig): string {
  return join(LOGS_DIR, `chrome-${env.name}.log`);
}

function ownsPort(port: number, env: EnvConfig): boolean {
  const pid = listenerPid(port);
  if (!pid) return false;
  const cmd = pidCmdline(pid);
  return (
    cmd.includes(`--remote-debugging-port=${port}`) ||
    cmd.includes(`--user-data-dir=${env.profileDir}`)
  );
}

async function waitForCdp(port: number, timeoutMs = LAUNCH_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpUp(port, 800)) return;
    await sleep(180);
  }
  throw new Error(`Chromium on port ${port} did not expose CDP within ${timeoutMs}ms`);
}

async function ensureDefaultPage(env: EnvConfig): Promise<{
  targetId: string;
  url: string;
  title: string;
  readyState: string;
}> {
  // Chrome exposes CDP slightly before its first page target exists. Wait for
  // it instead of creating a second tab that would race the startup page.
  const deadline = Date.now() + 5000;
  while ((await listTargets(env.cdpPort).catch(() => [])).length === 0 && Date.now() < deadline) {
    await sleep(150);
  }
  const preferredId = activeTargetId(env.name) ?? undefined;
  const { cdp, target } = await connectToPage(env.cdpPort, {
    preferredId,
    createUrl: env.startUrl,
  });
  try {
    let state = await pageState(cdp).catch(() => ({
      url: target.url,
      title: target.title,
      readyState: 'unknown',
    }));
    if (state.url === 'about:blank' || state.url.startsWith('chrome://')) {
      await navigateTo(cdp, env.startUrl, 20_000);
    }
    try {
      await waitFor(
        cdp,
        "document.readyState === 'complete' && location.href !== 'about:blank'",
        20_000,
      );
    } catch {
      // The startup navigation may have been superseded; (re)issue it once.
      await navigateTo(cdp, env.startUrl, 20_000);
    }
    await waitForLoad(cdp, 5000);
    state = await pageState(cdp);
    await applyViewport(cdp, BROWSER_WIDTH, BROWSER_HEIGHT);
    setActiveTarget(env.name, target.id);
    return {
      targetId: target.id,
      url: state.url,
      title: state.title,
      readyState: state.readyState,
    };
  } finally {
    cdp.close();
  }
}

async function pruneDuplicatePages(env: EnvConfig, keepId: string): Promise<number> {
  try {
    const targets = await listTargets(env.cdpPort);
    const keep = targets.find((target) => target.id === keepId);
    if (!keep) return 0;
    let closed = 0;
    for (const target of targets) {
      if (target.id === keepId) continue;
      const junk =
        target.url === 'about:blank' ||
        target.url.startsWith('chrome://') ||
        target.url === keep.url;
      if (junk) {
        await closeTarget(env.cdpPort, target.id).catch(() => {});
        closed++;
      }
    }
    return closed;
  } catch {
    return 0;
  }
}

function launch(env: EnvConfig): number {
  mkdirSync(env.profileDir, { recursive: true });
  ensureDirs();
  // Do not let Chromium restore tabs from an unclean previous shutdown: the
  // supervisor owns the single page target and stale about:blank tabs would
  // otherwise accumulate in /json/list after every restart.
  const defaultDir = join(env.profileDir, 'Default');
  for (const name of ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
    rmSync(join(defaultDir, name), { force: true });
  }
  rmSync(join(defaultDir, 'Sessions'), { recursive: true, force: true });
  const out = openSync(logPath(env), 'a');
  const child = spawn(CHROME_PATH, chromeArgs(env), {
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  closeSync(out);
  if (!child.pid) throw new Error(`failed to spawn Chromium for ${env.name}`);
  return child.pid;
}

function recordFor(env: EnvConfig, pid: number): BrowserRecord {
  return {
    name: env.name,
    cdp: env.cdpUrl,
    port: env.cdpPort,
    pid,
    profile: env.profileDir,
    chrome: CHROME_PATH,
    startedAt: new Date().toISOString(),
  };
}

async function reapStale(env: EnvConfig): Promise<void> {
  const record = getBrowserRecord(env.name);
  if (record?.pid) {
    if (pidAlive(record.pid)) {
      const cmd = pidCmdline(record.pid);
      if (cmd.includes('chrome') || cmd.includes('chromium')) {
        await stopPid(record.pid, { needle: env.profileDir });
      }
    }
    removeBrowserRecord(env.name);
    clearActiveTarget(env.name);
  }

  if (await cdpUp(env.cdpPort, 600)) {
    const pid = listenerPid(env.cdpPort);
    if (pid) {
      // Only kill a process we can identify as a Chromium debugging instance.
      const cmd = pidCmdline(pid);
      if (cmd.includes('chrome') && cmd.includes('remote-debugging-port')) {
        await stopPid(pid, { needle: 'remote-debugging-port' });
      }
    }
  }
}

export async function ensureBrowser(
  env: EnvConfig,
  options: { force?: boolean } = {},
): Promise<{
  ok: true;
  reused: boolean;
  record: BrowserRecord;
  page: { targetId: string; url: string; title: string; readyState: string };
}> {
  ensureDirs();

  if (options.force) {
    await reapStale(env);
  }

  const existing = getBrowserRecord(env.name);
  const up = await cdpUp(env.cdpPort, 1000);

  if (up) {
    const listener = listenerPid(env.cdpPort);
    const cmd = listener ? pidCmdline(listener) : '';
    const looksOurs =
      (listener && cmd.includes(`--remote-debugging-port=${env.cdpPort}`)) ||
      (existing && listener === existing.pid);
    if (looksOurs && listener) {
      const page = await ensureDefaultPage(env);
      const record = recordFor(env, listener);
      const map = readBrowsers();
      map[env.name] = record;
      writeBrowsers(map);
      return { ok: true, reused: true, record, page };
    }
    if (!looksOurs) {
      throw new Error(
        `port ${env.cdpPort} is held by an unknown process (pid ${listener ?? '?'}); refusing to adopt it`,
      );
    }
  }

  // Not reachable: clean up any stale pid/listener first.
  if (existing?.pid && pidAlive(existing.pid)) {
    const cmd = pidCmdline(existing.pid);
    if (cmd.includes(env.profileDir) || cmd.includes('chrome')) {
      await stopPid(existing.pid, { needle: 'chrome' });
    }
    removeBrowserRecord(env.name);
  }
  if (await cdpUp(env.cdpPort, 500)) {
    const pid = listenerPid(env.cdpPort);
    if (pid && ownsPort(env.cdpPort, env)) {
      await stopPid(pid, { needle: 'remote-debugging-port' });
    }
  }

  const pid = launch(env);
  const map = readBrowsers();
  map[env.name] = recordFor(env, pid);
  writeBrowsers(map);

  try {
    await waitForCdp(env.cdpPort);
    const page = await ensureDefaultPage(env);
    const record = recordFor(env, pid);
    const after = readBrowsers();
    after[env.name] = record;
    writeBrowsers(after);
    return { ok: true, reused: false, record, page };
  } catch (err) {
    // Leave a record for diagnostics, but report the failure.
    throw new Error(`failed to start ${env.name}: ${(err as Error).message}. See ${logPath(env)}`);
  }
}

export async function stopBrowser(env: EnvConfig): Promise<boolean> {
  let stopped = false;
  const record = getBrowserRecord(env.name);
  if (record?.pid && pidAlive(record.pid)) {
    try {
      stopped = await stopPid(record.pid, { needle: env.profileDir });
    } catch {
      try {
        stopped = await stopPid(record.pid, { needle: 'chrome' });
      } catch {}
    }
  }
  // Also reap a listener that no longer matches browsers.json (e.g. the pid was
  // recycled after a crash). Only touch a Chromium debugging instance.
  const pid = listenerPid(env.cdpPort);
  if (pid) {
    const cmd = pidCmdline(pid);
    if (cmd.includes(`--remote-debugging-port=${env.cdpPort}`)) {
      try {
        stopped = (await stopPid(pid, { needle: 'remote-debugging-port' })) || stopped;
      } catch {}
    }
  }
  removeBrowserRecord(env.name);
  clearActiveTarget(env.name);
  return stopped;
}

export async function browserStatus(deep = false): Promise<any[]> {
  const out: any[] = [];
  for (const env of ENVS) {
    const record = getBrowserRecord(env.name);
    const up = await cdpUp(env.cdpPort, 700);
    const entry: any = {
      name: env.name,
      port: env.cdpPort,
      cdp: env.cdpUrl,
      up,
      pid: record?.pid ?? listenerPid(env.cdpPort),
      pidAlive: record?.pid ? pidAlive(record.pid) : false,
      activeTargetId: activeTargetId(env.name),
      page: null,
      viewport: null,
    };
    if (up) {
      try {
        const targets = await listTargets(env.cdpPort);
        entry.targets = targets.length;
        const target =
          targets.find((t) => t.id === activeTargetId(env.name)) ??
          targets.find((t) => /^https?:/i.test(t.url)) ??
          targets[0];
        if (target) {
          entry.page = { id: target.id, url: target.url, title: target.title };
        }
        if (deep && target) {
          const { cdp } = await connectToPage(env.cdpPort, { preferredId: target.id });
          try {
            entry.viewport = await cdp
              .send<any>('Runtime.evaluate', {
                expression:
                  '({innerWidth, innerHeight, devicePixelRatio, url: location.href, title: document.title, readyState: document.readyState})',
                returnByValue: true,
              })
              .then((r) => r?.result?.value ?? null);
          } finally {
            cdp.close();
          }
        }
      } catch (err) {
        entry.error = (err as Error).message;
      }
    }
    out.push(entry);
  }
  return out;
}

function parseTargets(args: string[]): EnvConfig[] {
  const nums = args.filter((arg) => !arg.startsWith('--'));
  if (nums.length === 0 || nums.includes('all')) return ENVS;
  const envs: EnvConfig[] = [];
  for (const raw of nums) {
    const env = envByN(Number(raw.replace(/^qa-env-?/i, '')));
    if (!env) throw new Error(`unknown env: ${raw}`);
    envs.push(env);
  }
  return envs;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'status';
  const rest = argv.slice(1);
  const deep = rest.includes('--deep');
  const force = rest.includes('--force');

  if (command === 'start') {
    const envs = parseTargets(rest);
    const results = await Promise.all(
      envs.map(async (env) => {
        try {
          const result = await ensureBrowser(env, { force });
          const pruned = await pruneDuplicatePages(env, result.page.targetId);
          await sleep(1500);
          const prunedLate = await pruneDuplicatePages(env, result.page.targetId);
          return { ok: true, ...result, pruned: pruned + prunedLate };
        } catch (err) {
          return { ok: false, name: env.name, error: (err as Error).message };
        }
      }),
    );
    const map: BrowserMap = readBrowsers();
    console.log(
      JSON.stringify({ ok: results.every((r) => r.ok), browsers: results, map }, null, 2),
    );
    if (results.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }

  if (command === 'stop') {
    const envs = parseTargets(rest);
    const results = await Promise.all(
      envs.map(async (env) => ({ name: env.name, stopped: await stopBrowser(env) })),
    );
    console.log(JSON.stringify({ ok: true, stopped: results }, null, 2));
    return;
  }

  if (command === 'restart') {
    const envs = parseTargets(rest);
    await Promise.all(envs.map((env) => stopBrowser(env)));
    await sleep(300);
    const results = await Promise.all(
      envs.map(async (env) => {
        try {
          const result = await ensureBrowser(env);
          const pruned = await pruneDuplicatePages(env, result.page.targetId);
          await sleep(1500);
          const prunedLate = await pruneDuplicatePages(env, result.page.targetId);
          return { ok: true, ...result, pruned: pruned + prunedLate };
        } catch (err) {
          return { ok: false, name: env.name, error: (err as Error).message };
        }
      }),
    );
    console.log(JSON.stringify({ ok: results.every((r) => r.ok), browsers: results }, null, 2));
    if (results.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }

  if (command === 'status') {
    console.log(JSON.stringify({ ok: true, browsers: await browserStatus(deep) }, null, 2));
    return;
  }

  console.error(
    'usage: bun dashboard/browsers.ts <start|stop|restart|status> [all|N ...] [--force] [--deep]',
  );
  process.exit(2);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2));
    process.exit(1);
  });
}
