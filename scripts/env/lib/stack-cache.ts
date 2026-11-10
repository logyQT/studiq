import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './repo';
import type { StackStatus } from './stack';
import { DEV_DIR, ensureDevDir } from './state';

/**
 * The warm path's stack record: the last status this checkout observed, kept
 * only long enough to skip `supabase stack status` on a warm `ensure`.
 *
 * Spec §6: the warm path is "one probe per requested capability + one schema
 * read … no `stack status` when the heartbeat is fresh". `stack status` alone is
 * ~650 ms (Node CLI startup), so it dominates the ≤1 s budget; every warm-path
 * decision below is still proven by an independent probe or an ownership check.
 *
 * **No keys, no secrets.** `StackStatus` is credential-free by contract (its
 * `dbUrl` strips userinfo), and only rates/fingerprints are stored besides it.
 * The record lives in this checkout's mode-700 `.dev/` and is discarded by
 * `down --all`; it is evidence a stack *was* observed here, never authority to
 * start, stop or adopt one.
 *
 * The TTL is anchored to the last **authoritative** observation: a warm run
 * (which skips `stack status`) never rewrites the record, so it cannot extend
 * the heartbeat of an observation that is never re-proven.
 */
const CACHE_FILE = join(DEV_DIR, 'stack-cache.json');

/**
 * How long a recorded status may stand in for `stack status` without a fresh
 * observation. Short enough that an externally moved stack is re-discovered
 * quickly, long enough to cover the agent loop of back-to-back `ensure`s.
 */
const STACK_CACHE_TTL_MS = 120_000;

export interface CachedStack {
  /** The stack name the observation was made for (`''` = branch default). */
  stackName: string;
  status: StackStatus;
  /** Running service names from `composition.members`. */
  services: string[];
  /** Build environment hash for this stack, so the build check needs no keys. */
  envHash: string;
  /** The app URL the hash was computed with; a moved lease invalidates it. */
  appUrl: string;
  /** `Date.now()` when the record was written. */
  heartbeatAt: number;
}

function atomicWrite(path: string, contents: string): void {
  ensureDevDir();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  chmodSync(path, 0o600);
}

function isStatus(value: unknown): value is StackStatus {
  if (value === null || typeof value !== 'object') return false;
  const status = value as Record<string, unknown>;
  const ports = status.ports as Record<string, unknown> | undefined;
  return (
    typeof status.id === 'string' &&
    typeof status.name === 'string' &&
    typeof status.projectRoot === 'string' &&
    typeof status.apiUrl === 'string' &&
    typeof status.runtime === 'string' &&
    ports !== null &&
    typeof ports === 'object' &&
    typeof ports.api === 'number' &&
    typeof ports.db === 'number'
  );
}

/**
 * The recorded status for `stackName`, or null when it cannot be trusted:
 * missing/unreadable, written for another stack, older than the TTL, or made
 * for another checkout. Callers must still probe; this only saves the lookup.
 */
export function readCachedStack(
  stackName: string | null,
  now = Date.now(),
  ttlMs = STACK_CACHE_TTL_MS,
): CachedStack | null {
  try {
    if (lstatSync(CACHE_FILE).isSymbolicLink()) return null;
    const parsed: unknown = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (!isStatus(record.status)) return null;
    if (record.status.projectRoot !== REPO_ROOT) return null;
    if (record.stackName !== (stackName ?? '')) return null;
    if (typeof record.envHash !== 'string' || typeof record.appUrl !== 'string') return null;
    if (typeof record.heartbeatAt !== 'number') return null;
    if (!Array.isArray(record.services)) return null;
    if (now - record.heartbeatAt > ttlMs || record.heartbeatAt > now + ttlMs) return null;
    return {
      stackName: record.stackName as string,
      status: record.status,
      services: record.services.filter((name): name is string => typeof name === 'string'),
      envHash: record.envHash,
      appUrl: record.appUrl,
      heartbeatAt: record.heartbeatAt,
    };
  } catch {
    return null;
  }
}

/** Record an authoritative observation that just proved the stack is up and owned here. */
export function writeCachedStack(entry: Omit<CachedStack, 'heartbeatAt'>, now = Date.now()): void {
  atomicWrite(CACHE_FILE, `${JSON.stringify({ ...entry, heartbeatAt: now }, null, 2)}\n`);
}

/** Forget the observation (the stack is stopped, or the checkout was torn down). */
export function removeCachedStack(): void {
  rmSync(CACHE_FILE, { force: true });
}
