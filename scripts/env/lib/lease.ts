import { spawnSync } from 'node:child_process';
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

/** App-port lease in the cross-checkout registry's entry format. */
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
  /**
   * `ps -o lstart=` of `ownerPid` at claim time (null when `ps` could not tell).
   * It is the PID-reuse witness: a live pid started at another time is a
   * different process, so the claim belongs to a dead claimant.
   */
  ownerStartedAt: string | null;
}

const CLAIM_FILE_RE = /^port-(\d+)\.claim$/;

function claimsDir(dir: string): string {
  return join(dir, 'claims');
}

function claimFile(dir: string, port: number): string {
  return join(claimsDir(dir), `port-${port}.claim`);
}

function claimBody(
  port: number,
  projectId: string,
  ownerPid: number,
  ownerStartedAt: string | null,
): string {
  return `${JSON.stringify({
    projectId,
    appPort: port,
    ownerPid,
    createdAt: new Date().toISOString(),
    ownerStartedAt,
  })}\n`;
}

/**
 * `ps -o lstart= -p <pid>`: process identity, trimmed; null when unavailable.
 *
 * `lstart` is rendered in the caller's timezone and locale, so the claim writer
 * and a later checker with a different `TZ`/`LC_*`/`LANG` would read two
 * different strings for the same live pid — and the checker would mistake a
 * live claimant for a reused pid and steal the claim. Pin the environment so
 * every process produces the identical identity string.
 */
function processStartedAt(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      TZ: 'UTC',
      LC_ALL: 'C',
      LANG: 'C',
      LC_TIME: 'C',
    },
  });
  if (result.status !== 0) return null;
  const value = (result.stdout ?? '').trim();
  return value === '' ? null : value;
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
      ownerStartedAt: str(parsed.ownerStartedAt) || null,
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
  const body = claimBody(port, projectId, ownerPid, processStartedAt(ownerPid));
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

/**
 * Whether two reads describe the same claimed holder. Recovery compares the
 * observed claim with the current file under the claims mutex, so a claim that
 * another recoverer replaced is never removed.
 */
export function sameClaimHolder(left: AppPortClaim, right: AppPortClaim): boolean {
  return (
    left.projectId === right.projectId &&
    left.ownerPid === right.ownerPid &&
    left.createdAt === right.createdAt &&
    left.ownerStartedAt === right.ownerStartedAt
  );
}

/**
 * Compare-and-remove: drop `port`'s claim only when it is still exactly
 * `expected`. Callers hold the claims mutex; the identity check also keeps a
 * stale recovery from deleting a replacement claim read after the first look.
 */
export function removeAppPortClaimIfHeldBy(
  dir: string,
  port: number,
  expected: AppPortClaim,
): boolean {
  const current = readAppPortClaim(dir, port);
  if (!current || !sameClaimHolder(current, expected)) return false;
  try {
    rmSync(claimFile(dir, port), { force: true });
    return true;
  } catch {
    return false;
  }
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
 * owner died (the lease can never arrive) or its live pid belongs to another
 * process (pid reuse, proven by a different start time). Age alone is never
 * evidence: a slow-but-live claimant keeps its reservation. A claim whose lease
 * exists is never stale — the lease's own reclaim rules decide that.
 */
export function isClaimStale(dir: string, claim: AppPortClaim): boolean {
  if (readLease(dir, claim.projectId)) return false;
  if (!pidAlive(claim.ownerPid)) return true;
  const startedAt = processStartedAt(claim.ownerPid);
  // Unknown start times on either side are not proof of reuse: keep the claim
  // for the live pid instead of guessing.
  return claim.ownerStartedAt !== null && startedAt !== null && startedAt !== claim.ownerStartedAt;
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
