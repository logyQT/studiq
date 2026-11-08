import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './repo';

/**
 * Read-only view of `scripts/dev-registry.ts`'s per-checkout registry.
 *
 * Phase 1 never writes: the registry is runtime state owned by `scripts/dev`
 * (and, later, the lifecycle commands). Entries are only used to explain
 * ownership and to skip app ports other checkouts have claimed.
 */
export interface RegistryEntry {
  projectId: string;
  worktree: string;
  appPort: number;
  apiPort: number;
  dbPort: number;
  studioPort: number;
  mailPort: number;
  shadowPort: number;
  poolerPort: number;
  analyticsPort: number;
  edgeInspectorPort: number;
  ownerPid: number;
  startedAt: string;
  shared: boolean;
  sharedOwner: string | null;
  mode: 'dev' | 'prod';
  claimId: string | null;
}

export interface Registry {
  dir: string;
  trusted: boolean;
  entries: RegistryEntry[];
}

/** Registry fields that may claim a port (`scripts/dev` skips all of them). */
const REGISTRY_PORT_FIELDS = [
  'appPort',
  'apiPort',
  'dbPort',
  'studioPort',
  'mailPort',
  'shadowPort',
  'poolerPort',
  'analyticsPort',
  'edgeInspectorPort',
] as const;

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

type RawEntry = Partial<Record<keyof RegistryEntry, unknown>>;

/**
 * `${STUDIQ_DEV_REGISTRY:-${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/studiq-dev-<uid>}`.
 * A relative override is resolved against the checkout, like `scripts/dev`.
 */
export function resolveRegistryDir(): string {
  const explicit = process.env.STUDIQ_DEV_REGISTRY ?? '';
  const runtimeDir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp';
  const fallback = join(runtimeDir, `studiq-dev-${process.getuid?.() ?? 0}`);
  const raw = explicit || fallback;
  const dir = raw.startsWith('/') ? raw : resolve(REPO_ROOT, raw);
  return dir.length > 1 && dir.endsWith('/') ? dir.slice(0, -1) : dir;
}

/**
 * The registry directory is only trustworthy when it is a real directory owned
 * by the current user — the same read-side guard `scripts/dev` uses. A symlink
 * or a foreign directory is reported, never followed.
 */
export function registryDirTrusted(dir: string): boolean {
  try {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    const uid = process.getuid?.();
    return uid === undefined || stat.uid === uid;
  } catch {
    return false;
  }
}

function entryIdFromPath(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? '';
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
}

function toNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readEntry(file: string): RegistryEntry | null {
  try {
    // Never read through a symlink: a precreated entry could point anywhere.
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as RawEntry;
    if (typeof parsed.projectId !== 'string' || !PROJECT_ID_RE.test(parsed.projectId)) return null;
    if (parsed.projectId !== entryIdFromPath(file)) return null;
    const sharedOwner = toString(parsed.sharedOwner);
    const claimId = toString(parsed.claimId);
    return {
      projectId: parsed.projectId,
      worktree: toString(parsed.worktree),
      appPort: toNumber(parsed.appPort),
      apiPort: toNumber(parsed.apiPort),
      dbPort: toNumber(parsed.dbPort),
      studioPort: toNumber(parsed.studioPort),
      mailPort: toNumber(parsed.mailPort),
      shadowPort: toNumber(parsed.shadowPort),
      poolerPort: toNumber(parsed.poolerPort),
      analyticsPort: toNumber(parsed.analyticsPort),
      edgeInspectorPort: toNumber(parsed.edgeInspectorPort),
      ownerPid: toNumber(parsed.ownerPid),
      startedAt: toString(parsed.startedAt),
      shared: parsed.shared === true,
      sharedOwner: sharedOwner || null,
      mode: parsed.mode === 'prod' ? 'prod' : 'dev',
      claimId: claimId || null,
    };
  } catch {
    return null;
  }
}

export function readRegistry(dir = resolveRegistryDir()): Registry {
  if (!registryDirTrusted(dir)) return { dir, trusted: false, entries: [] };
  const entries: RegistryEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const entry = readEntry(join(dir, name));
    if (entry) entries.push(entry);
  }
  entries.sort((left, right) => left.projectId.localeCompare(right.projectId));
  return { dir, trusted: true, entries };
}

export function findEntry(entries: RegistryEntry[], projectId: string): RegistryEntry | null {
  return entries.find((entry) => entry.projectId === projectId) ?? null;
}

export function entryForPort(entries: RegistryEntry[], port: number): RegistryEntry | null {
  return (
    entries.find((entry) => REGISTRY_PORT_FIELDS.some((field) => entry[field] === port)) ?? null
  );
}
