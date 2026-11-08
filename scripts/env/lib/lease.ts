import { randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureRegistryDir } from './locks';

/**
 * App-port lease (spec §6.1).
 *
 * Phase 2 leases **one app port**, never a 20-port block. The lease is written
 * in `scripts/dev-registry.ts`'s entry format (plus a few extra fields that
 * helper ignores), so `scripts/dev`, `env:ports` and the doctor see the same
 * claim and skip the port.
 *
 * The lease follows the **stack** lifetime: plain `down` keeps it while the
 * stack runs (config.toml binds the auth redirect URLs to APP_URL), and
 * `down --all` or a stopped stack releases it.
 */
export interface AppLease {
  // Registry-compatible fields.
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
  claimId: string;
  // Lease metadata (ignored by the dev registry reader).
  envLease: true;
  projectRoot: string;
  branch: string;
  stackName: string;
  heartbeatAt: string;
  ttlSec: number;
}

const LEASE_TTL_SEC = 15 * 60;

export function leaseProjectId(identityKey: string): string {
  return `env-${identityKey}`;
}

function leasePath(dir: string, projectId: string): string {
  return join(dir, `${projectId}.json`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readLease(dir: string, projectId: string): AppLease | null {
  const file = leasePath(dir, projectId);
  try {
    if (lstatSync(file).isSymbolicLink()) return null;
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isObject(parsed) || parsed.envLease !== true) return null;
    if (parsed.projectId !== projectId) return null;
    return {
      projectId,
      worktree: toText(parsed.worktree),
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
      startedAt: toText(parsed.startedAt),
      shared: parsed.shared === true,
      sharedOwner: toText(parsed.sharedOwner) || null,
      mode: parsed.mode === 'prod' ? 'prod' : 'dev',
      claimId: toText(parsed.claimId),
      envLease: true,
      projectRoot: toText(parsed.projectRoot),
      branch: toText(parsed.branch),
      stackName: toText(parsed.stackName),
      heartbeatAt: toText(parsed.heartbeatAt),
      ttlSec: toNumber(parsed.ttlSec) || LEASE_TTL_SEC,
    };
  } catch {
    return null;
  }
}

export function writeLease(lease: AppLease): void {
  const dir = ensureRegistryDir();
  const file = leasePath(dir, lease.projectId);
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(lease, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
  chmodSync(file, 0o600);
}

/** Remove our lease only while it still carries the expected claim. */
export function removeLease(dir: string, projectId: string, claimId?: string): boolean {
  const lease = readLease(dir, projectId);
  if (!lease) return false;
  if (claimId && lease.claimId && lease.claimId !== claimId) return false;
  rmSync(leasePath(dir, projectId), { force: true });
  return true;
}

export function leaseMatchesIdentity(
  lease: AppLease,
  identity: { projectRoot: string; branch: string; stackName: string },
): boolean {
  return (
    lease.projectRoot === identity.projectRoot &&
    lease.branch === identity.branch &&
    lease.stackName === identity.stackName
  );
}

export interface ReclaimInput {
  pidAlive: boolean;
  heartbeatAgeMs: number;
  ttlSec: number;
  /** A running stack always keeps its lease, no matter how old the heartbeat. */
  stackRunning: boolean;
}

/** Reclaim only when the pid is dead, the heartbeat is old, and no stack runs. */
export function isLeaseReclaimable(input: ReclaimInput): boolean {
  return !input.pidAlive && input.heartbeatAgeMs > input.ttlSec * 1000 && !input.stackRunning;
}

export function heartbeatAgeMs(lease: AppLease, now = Date.now()): number {
  const heartbeat = Date.parse(lease.heartbeatAt);
  return Number.isFinite(heartbeat) ? Math.max(0, now - heartbeat) : Number.POSITIVE_INFINITY;
}

/** New lease record; callers fill the observed stack ports afterwards. */
export function newLease(input: {
  projectId: string;
  projectRoot: string;
  branch: string;
  stackName: string;
  appPort: number;
  shared: boolean;
  sharedOwner: string | null;
  mode: 'dev' | 'prod';
  claimId?: string;
}): AppLease {
  const now = new Date().toISOString();
  return {
    projectId: input.projectId,
    worktree: input.projectRoot,
    appPort: input.appPort,
    apiPort: 0,
    dbPort: 0,
    studioPort: 0,
    mailPort: 0,
    shadowPort: 0,
    poolerPort: 0,
    analyticsPort: 0,
    edgeInspectorPort: 0,
    ownerPid: 0,
    startedAt: now,
    shared: input.shared,
    sharedOwner: input.sharedOwner,
    mode: input.mode,
    claimId: input.claimId ?? `${process.pid}-${randomBytes(6).toString('hex')}`,
    envLease: true,
    projectRoot: input.projectRoot,
    branch: input.branch,
    stackName: input.stackName,
    heartbeatAt: now,
    ttlSec: LEASE_TTL_SEC,
  };
}

export function touchLease(lease: AppLease, updates: Partial<AppLease> = {}): AppLease {
  return { ...lease, ...updates, heartbeatAt: new Date().toISOString() };
}
