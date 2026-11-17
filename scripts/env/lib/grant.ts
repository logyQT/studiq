import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { processStartTime } from './locks';
import { DEV_DIR, ensureDevDir } from './state';

/** Which Next app a grant authorises. */
export type BuildApp = 'web' | 'admin';

/**
 * How a build was admitted (ADR-0014, decision 6). Only `slot` claims a slot and
 * a lease; `no-slot` is CI/Playwright, `no-lock` is the explicit bypass.
 */
export type BuildAdmission = 'slot' | 'no-slot' | 'no-lock';

/**
 * The single-use authorisation the launcher mints and the `prebuild` guard
 * consumes (ADR-0014, decision 6).
 *
 * Holding a slot is a file fact, not an environment fact: this record names the
 * launcher by pid **and** start time, and (in slot mode) the slot directory's
 * token, so a long-lived shell that once ran `env build` cannot replay it.
 */
export interface BuildGrant {
  token: string;
  app: BuildApp;
  admission: BuildAdmission;
  /** The slot directory the token names, or null for `--no-slot`/`--no-lock`. */
  slot: number | null;
  launcherPid: number;
  launcherStart: string | null;
  mintedAt: string;
  expiresAt: string;
}

/**
 * How long a minted grant stays valid.
 *
 * The grant is minted immediately before the build is spawned and consumed by
 * `prebuild` a moment later, so this only has to cover a slow spawn. It is a
 * second fence behind single-use consumption: a grant that leaked (a failed
 * spawn, a crashed launcher) is worthless ten minutes later. Policy constant,
 * not a measurement.
 */
const GRANT_TTL_MS = 10 * 60 * 1000;

/** `.dev/build-grant.json` — this checkout's state directory, like the build record. */
export function grantPath(): string {
  return join(DEV_DIR, 'build-grant.json');
}

function parseGrant(text: string): BuildGrant | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const app = record.app;
  const admission = record.admission;
  if (app !== 'web' && app !== 'admin') return null;
  if (admission !== 'slot' && admission !== 'no-slot' && admission !== 'no-lock') return null;
  if (typeof record.token !== 'string' || record.token === '') return null;
  if (typeof record.launcherPid !== 'number' || !Number.isInteger(record.launcherPid)) return null;
  if (typeof record.expiresAt !== 'string' || Number.isNaN(Date.parse(record.expiresAt)))
    return null;
  const slot = record.slot;
  if (slot !== null && (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1))
    return null;
  return {
    token: record.token,
    app,
    admission,
    slot,
    launcherPid: record.launcherPid,
    launcherStart: typeof record.launcherStart === 'string' ? record.launcherStart : null,
    mintedAt: typeof record.mintedAt === 'string' ? record.mintedAt : '',
    expiresAt: record.expiresAt,
  };
}

/**
 * Write the grant atomically, mode 600.
 *
 * A failed spawn leaves the grant behind; it is single-use, so the next guard
 * read consumes it, and `expiresAt` bounds the damage either way.
 */
export function mintBuildGrant(input: {
  app: BuildApp;
  admission: BuildAdmission;
  slot: number | null;
  /** The slot's token in slot mode; a fresh one otherwise. */
  token?: string | null;
}): BuildGrant {
  ensureDevDir();
  const now = Date.now();
  const grant: BuildGrant = {
    token: input.token ?? randomBytes(12).toString('hex'),
    app: input.app,
    admission: input.admission,
    slot: input.slot,
    launcherPid: process.pid,
    launcherStart: processStartTime(process.pid),
    mintedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GRANT_TTL_MS).toISOString(),
  };
  const path = grantPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(grant, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  chmodSync(path, 0o600);
  return grant;
}

/**
 * What a guard read found.
 *
 * `missing` and `invalid` are separated because they need different advice: a
 * missing grant means no `env build` ran (or one already built), an invalid one
 * means the file was tampered with or written by an older shape.
 */
export type GrantConsumption =
  { status: 'missing' } | { status: 'invalid' } | { status: 'consumed'; grant: BuildGrant };

/**
 * Claim the grant by renaming it away, then unlink it.
 *
 * The rename is the atomic claim: two concurrent guards cannot both win it, and
 * the loser sees `ENOENT` and refuses. Consumption happens **before** any
 * validation, so a grant that fails a check is still spent — one grant
 * authorises exactly one build attempt, never a retry loop.
 */
export function consumeBuildGrant(): GrantConsumption {
  const path = grantPath();
  const claim = `${path}.claim-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    renameSync(path, claim);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    throw error;
  }
  try {
    const grant = parseGrant(readFileSync(claim, 'utf8'));
    return grant === null ? { status: 'invalid' } : { status: 'consumed', grant };
  } catch {
    return { status: 'invalid' };
  } finally {
    rmSync(claim, { force: true });
  }
}
