/**
 * Small helpers for the hierarchical state files shared by the supervisor,
 * the dashboard server and the agent CLI.
 *
 *   browsers.json  { "qa-env-1": { cdp, port, pid, ... } }
 *   tabs.json      { "qa-env-1": { targetId } }  // active tab per env
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { BROWSERS_FILE, ensureDirs, TABS_FILE } from './config';

export type BrowserRecord = {
  name: string;
  cdp: string;
  port: number;
  pid: number;
  profile: string;
  chrome: string;
  startedAt: string;
};

export type BrowserMap = Record<string, BrowserRecord>;
export type TabsMap = Record<string, { targetId: string; updated: number }>;

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  ensureDirs();
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export function readBrowsers(): BrowserMap {
  const raw = readJson<BrowserMap>(BROWSERS_FILE, {});
  const out: BrowserMap = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as BrowserRecord).port === 'number' &&
      typeof (value as BrowserRecord).pid === 'number'
    ) {
      out[name] = value as BrowserRecord;
    }
  }
  return out;
}

export function writeBrowsers(map: BrowserMap): void {
  writeJsonAtomic(BROWSERS_FILE, map);
}

export function getBrowserRecord(name: string): BrowserRecord | null {
  return readBrowsers()[name] ?? null;
}

export function updateBrowserRecord(name: string, patch: Partial<BrowserRecord>): void {
  const map = readBrowsers();
  const current = map[name];
  if (!current) return;
  map[name] = { ...current, ...patch };
  writeBrowsers(map);
}

export function removeBrowserRecord(name: string): void {
  const map = readBrowsers();
  if (!(name in map)) return;
  delete map[name];
  writeBrowsers(map);
}

export function readTabs(): TabsMap {
  return readJson<TabsMap>(TABS_FILE, {});
}

export function activeTargetId(name: string): string | null {
  return readTabs()[name]?.targetId ?? null;
}

export function setActiveTarget(name: string, targetId: string): void {
  const tabs = readTabs();
  tabs[name] = { targetId, updated: Date.now() };
  writeJsonAtomic(TABS_FILE, tabs);
}

export function clearActiveTarget(name: string): void {
  const tabs = readTabs();
  if (!(name in tabs)) return;
  delete tabs[name];
  writeJsonAtomic(TABS_FILE, tabs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function pidCmdline(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
  } catch {
    return '';
  }
}

/** PID listening on a TCP port, using `ss` (available in the dev image). */
export function listenerPid(port: number): number | null {
  try {
    const out = execFileSync('ss', ['-ltnp', `sport = :${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = /pid=(\d+)/.exec(out);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export async function stopPid(
  pid: number,
  options: { needle?: string; graceMs?: number } = {},
): Promise<boolean> {
  if (!pidAlive(pid)) return false;
  if (options.needle && !pidCmdline(pid).includes(options.needle)) {
    throw new Error(`refusing to kill pid ${pid}: command line does not contain ${options.needle}`);
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }
  const deadline = Date.now() + (options.graceMs ?? 3500);
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await sleep(100);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
  await sleep(150);
  return !pidAlive(pid);
}
