import { randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureRegistryDir } from './locks';

/** App-port lease in `scripts/dev-registry.ts`'s entry format. */
export interface AppLease {
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

export function leasePath(dir: string, projectId: string): string {
  return join(dir, `${projectId}.json`);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readLease(dir: string, projectId: string): AppLease | null {
  try {
    const file = leasePath(dir, projectId);
    if (lstatSync(file).isSymbolicLink()) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (parsed.envLease !== true || parsed.projectId !== projectId) return null;
    return {
      projectId,
      worktree: str(parsed.worktree),
      appPort: num(parsed.appPort),
      apiPort: num(parsed.apiPort),
      dbPort: num(parsed.dbPort),
      studioPort: num(parsed.studioPort),
      mailPort: num(parsed.mailPort),
      shadowPort: num(parsed.shadowPort),
      poolerPort: num(parsed.poolerPort),
      analyticsPort: num(parsed.analyticsPort),
      edgeInspectorPort: num(parsed.edgeInspectorPort),
      ownerPid: num(parsed.ownerPid),
      startedAt: str(parsed.startedAt),
      shared: parsed.shared === true,
      sharedOwner: str(parsed.sharedOwner) || null,
      mode: parsed.mode === 'prod' ? 'prod' : 'dev',
      claimId: str(parsed.claimId),
      envLease: true,
      projectRoot: str(parsed.projectRoot),
      branch: str(parsed.branch),
      stackName: str(parsed.stackName),
      heartbeatAt: str(parsed.heartbeatAt),
      ttlSec: num(parsed.ttlSec, LEASE_TTL_SEC),
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

export function removeLease(dir: string, projectId: string): void {
  rmSync(leasePath(dir, projectId), { force: true });
}

export function heartbeatAgeMs(lease: AppLease, now = Date.now()): number {
  const heartbeat = Date.parse(lease.heartbeatAt);
  return Number.isFinite(heartbeat) ? Math.max(0, now - heartbeat) : Number.POSITIVE_INFINITY;
}

export function isLeaseReclaimable(input: {
  pidAlive: boolean;
  heartbeatAgeMs: number;
  ttlSec: number;
  stackRunning: boolean;
}): boolean {
  return !input.pidAlive && input.heartbeatAgeMs > input.ttlSec * 1000 && !input.stackRunning;
}

export function newLease(input: {
  projectId: string;
  projectRoot: string;
  branch: string;
  stackName: string;
  appPort: number;
  shared: boolean;
  sharedOwner: string | null;
  mode: 'dev' | 'prod';
}): AppLease {
  const now = new Date().toISOString();
  return {
    ...input,
    worktree: input.projectRoot,
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
    claimId: `${process.pid}-${randomBytes(6).toString('hex')}`,
    envLease: true,
    heartbeatAt: now,
    ttlSec: LEASE_TTL_SEC,
  };
}

export function touchLease(lease: AppLease, updates: Partial<AppLease> = {}): AppLease {
  return { ...lease, ...updates, heartbeatAt: new Date().toISOString() };
}
