import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { REPO_ROOT } from './repo';
import type { Capability } from '../profiles';

/**
 * `.dev/` state shared by the lifecycle commands.
 *
 * It never contains secrets: capability records carry ports/URLs and a hash of
 * the build-time public values, never the values themselves. Every file is
 * created mode 600 inside a mode-700 directory (spec §9, §10.8).
 */
export const DEV_DIR = process.env.STUDIQ_ENV_STATE_DIR
  ? resolve(REPO_ROOT, process.env.STUDIQ_ENV_STATE_DIR)
  : join(REPO_ROOT, '.dev');

const STATE_DIR = join(DEV_DIR, 'stacks');
const SEED_DIR = join(DEV_DIR, 'seed');

export interface RecordedPorts {
  api: number;
  db: number;
  studio: number;
  mail: number;
  mailSmtp: number;
  mailPop3: number;
  realtime: number;
  analytics: number;
  edgeInspector: number;
  pooler: number;
  pgmeta: number;
}

export interface StackRecord {
  version: 1;
  stackId: string;
  name: string;
  branch: string | null;
  projectRoot: string;
  runtime: string;
  capabilities: Capability[];
  ports: RecordedPorts;
  urls: {
    supabase: string;
    db: string | null;
    mail: string | null;
    studio: string | null;
  };
  /** Last profile this checkout ensured (null when written by another path). */
  profile: string | null;
  /** True when the invocation that wrote the record started/resumed the stack. */
  cold: boolean;
  /** Hash of the inlined public values; never the values themselves. */
  envHash: string | null;
  createdAt: string;
  updatedAt: string;
  heartbeatAt: string;
}

export interface BuildState {
  fingerprint: string;
  envHash: string;
  mode: string;
  builtAt: string;
}

export interface SeedMarker {
  stackId: string;
  scriptsHash: string;
  seededAt: string;
}

export function ensureDevDir(): void {
  if (lstatSync(DEV_DIR, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`.dev directory ${DEV_DIR} is a symlink; refusing to use it`);
  }
  mkdirSync(DEV_DIR, { recursive: true, mode: 0o700 });
  chmodSync(DEV_DIR, 0o700);
}

/** One state file per stack identity, so named stacks do not clobber each other. */
export function identityKey(projectRoot: string, branch: string, stackName: string): string {
  return createHash('sha256')
    .update(`${projectRoot}\0${branch}\0${stackName}`)
    .digest('hex')
    .slice(0, 16);
}

function atomicWrite(path: string, contents: string, mode = 0o600): void {
  ensureDevDir();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, contents, { mode, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  chmodSync(path, mode);
}

function readJson(path: string): unknown {
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPort(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function toPorts(value: unknown): RecordedPorts {
  const ports = isObject(value) ? value : {};
  return {
    api: toPort(ports.api),
    db: toPort(ports.db),
    studio: toPort(ports.studio),
    mail: toPort(ports.mail),
    mailSmtp: toPort(ports.mailSmtp),
    mailPop3: toPort(ports.mailPop3),
    realtime: toPort(ports.realtime),
    analytics: toPort(ports.analytics),
    edgeInspector: toPort(ports.edgeInspector),
    pooler: toPort(ports.pooler),
    pgmeta: toPort(ports.pgmeta),
  };
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stackRecordPath(key: string): string {
  return join(STATE_DIR, `${key}.json`);
}

export function readStackRecord(key: string): StackRecord | null {
  const parsed = readJson(stackRecordPath(key));
  if (!isObject(parsed) || parsed.version !== 1) return null;
  if (typeof parsed.stackId !== 'string' || typeof parsed.name !== 'string') return null;
  if (typeof parsed.projectRoot !== 'string' || typeof parsed.runtime !== 'string') return null;
  const urls = isObject(parsed.urls) ? parsed.urls : {};
  const supabase = typeof urls.supabase === 'string' ? urls.supabase : '';
  if (!supabase) return null;
  const capabilities = Array.isArray(parsed.capabilities)
    ? parsed.capabilities.filter((value): value is Capability => typeof value === 'string')
    : [];
  return {
    version: 1,
    stackId: parsed.stackId,
    name: parsed.name,
    branch: toStringOrNull(parsed.branch),
    projectRoot: parsed.projectRoot,
    runtime: parsed.runtime,
    capabilities,
    ports: toPorts(parsed.ports),
    urls: {
      supabase,
      db: toStringOrNull(urls.db),
      mail: toStringOrNull(urls.mail),
      studio: toStringOrNull(urls.studio),
    },
    profile: toStringOrNull(parsed.profile),
    cold: parsed.cold === true,
    envHash: toStringOrNull(parsed.envHash),
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    heartbeatAt:
      typeof parsed.heartbeatAt === 'string' ? parsed.heartbeatAt : new Date(0).toISOString(),
  };
}

export function writeStackRecord(key: string, record: StackRecord): void {
  atomicWrite(stackRecordPath(key), `${JSON.stringify(record, null, 2)}\n`);
}

/** Remove a stale record when its lease is reclaimed or its stack is destroyed. */
export function removeStackRecord(key: string): void {
  rmSync(stackRecordPath(key), { force: true });
}

/** A record is fresh for the warm-path heartbeat window (also the lease TTL). */
const RECORD_TTL_MS = 15 * 60 * 1000;

export function isStackRecordFresh(
  record: StackRecord | null,
  now = Date.now(),
  ttlMs = RECORD_TTL_MS,
): boolean {
  if (!record) return false;
  const heartbeat = Date.parse(record.heartbeatAt);
  return Number.isFinite(heartbeat) && now - heartbeat <= ttlMs;
}

export function readBuildState(): BuildState | null {
  const parsed = readJson(join(DEV_DIR, 'build.json'));
  if (!isObject(parsed)) return null;
  if (typeof parsed.fingerprint !== 'string' || typeof parsed.envHash !== 'string') return null;
  return {
    fingerprint: parsed.fingerprint,
    envHash: parsed.envHash,
    mode: typeof parsed.mode === 'string' ? parsed.mode : 'production',
    builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : new Date(0).toISOString(),
  };
}

export function writeBuildState(state: BuildState): void {
  atomicWrite(join(DEV_DIR, 'build.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function seedMarkerPath(stackId: string): string {
  return join(SEED_DIR, `${stackId}.json`);
}

export function readSeedMarker(stackId: string): SeedMarker | null {
  const parsed = readJson(seedMarkerPath(stackId));
  if (!isObject(parsed) || typeof parsed.stackId !== 'string') return null;
  if (typeof parsed.scriptsHash !== 'string' || typeof parsed.seededAt !== 'string') return null;
  return {
    stackId: parsed.stackId,
    scriptsHash: parsed.scriptsHash,
    seededAt: parsed.seededAt,
  };
}

export function buildArtifactPresent(): boolean {
  return existsSync(join(REPO_ROOT, 'apps', 'web', '.next', 'BUILD_ID'));
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function timestamp(date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * Append one human line to `.dev/env.log` (mode 600). Callers must never pass
 * key material: the log records actions and outcomes only.
 */
export function appendEnvLog(line: string): void {
  ensureDevDir();
  const path = join(DEV_DIR, 'env.log');
  const created = !existsSync(path);
  writeFileSync(path, `[${timestamp()}] ${line}\n`, { flag: 'a', mode: 0o600 });
  if (created) chmodSync(path, 0o600);
}
