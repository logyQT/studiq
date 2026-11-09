import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ensureRegistryDir, ensureRegistrySubdir, pidAlive } from './locks';

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

/**
 * Cross-checkout app-port claim (spec §5).
 *
 * A lease file belongs to one checkout, so it cannot stop two checkouts from
 * choosing the same port. The claim file is named after the **port**, so
 * creating it with `flag: 'wx'` is an atomic reservation shared by every
 * process and worktree using the registry: exactly one claimant wins, the
 * others move to the next candidate.
 */
export interface AppPortClaim {
  projectId: string;
  appPort: number;
  ownerPid: number;
  createdAt: string;
}

/** How long a live claimant may hold a claim before its lease is written. */
export const CLAIM_GRACE_MS = 5_000;

const CLAIM_FILE_RE = /^port-(\d+)\.claim$/;

export function claimsDir(dir: string): string {
  return join(dir, 'claims');
}

function claimFile(dir: string, port: number): string {
  return join(claimsDir(dir), `port-${port}.claim`);
}

function claimBody(port: number, projectId: string, ownerPid: number): string {
  return `${JSON.stringify({
    projectId,
    appPort: port,
    ownerPid,
    createdAt: new Date().toISOString(),
  })}\n`;
}

export function readAppPortClaim(dir: string, port: number): AppPortClaim | null {
  try {
    const file = claimFile(dir, port);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const projectId = str(parsed.projectId);
    if (!projectId || num(parsed.appPort) !== port) return null;
    return {
      projectId,
      appPort: port,
      ownerPid: num(parsed.ownerPid),
      createdAt: str(parsed.createdAt),
    };
  } catch {
    return null;
  }
}

export interface AppPortClaimResult {
  ok: boolean;
  /** The current holder when the claim could not be taken. */
  holder: AppPortClaim | null;
}

/**
 * Atomically reserve `port` for `projectId`. A re-entrant claim by the same
 * project refreshes its timestamp instead of failing, so a retry inside one
 * checkout (or a second `ensure`) is idempotent.
 */
export function claimAppPort(
  dir: string,
  port: number,
  projectId: string,
  ownerPid = process.pid,
): AppPortClaimResult {
  ensureRegistrySubdir('claims', dir);
  const file = claimFile(dir, port);
  const body = claimBody(port, projectId, ownerPid);
  try {
    writeFileSync(file, body, { mode: 0o600, flag: 'wx' });
    chmodSync(file, 0o600);
    return { ok: true, holder: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const holder = readAppPortClaim(dir, port);
  if (holder?.projectId !== projectId) return { ok: false, holder };
  try {
    writeFileSync(file, body, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch {
    return { ok: false, holder: readAppPortClaim(dir, port) };
  }
  return { ok: true, holder: null };
}

/** Release one claim, but only when this project is the holder. */
export function releaseAppPortClaim(dir: string, port: number, projectId: string): boolean {
  if (readAppPortClaim(dir, port)?.projectId !== projectId) return false;
  try {
    rmSync(claimFile(dir, port), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Release every claim this project holds except `keepPort` (lease release). */
export function releaseProjectClaims(
  dir: string,
  projectId: string,
  keepPort: number | null = null,
): number {
  let names: string[];
  try {
    names = readdirSync(claimsDir(dir));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const match = CLAIM_FILE_RE.exec(name);
    if (!match) continue;
    const port = Number(match[1]);
    if (port === keepPort) continue;
    if (releaseAppPortClaim(dir, port, projectId)) removed += 1;
  }
  return removed;
}

/**
 * A claim is stale when its checkout has no lease left behind and either its
 * owner died (the lease can never arrive) or it is older than the grace period
 * (a crashed claimant whose pid was reused). A live claim is never stolen
 * while its lease exists — the lease's own reclaim rules decide that.
 */
export function isClaimStale(dir: string, claim: AppPortClaim, now = Date.now()): boolean {
  if (readLease(dir, claim.projectId)) return false;
  if (!pidAlive(claim.ownerPid)) return true;
  const created = Date.parse(claim.createdAt);
  return !Number.isFinite(created) || now - created > CLAIM_GRACE_MS;
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
