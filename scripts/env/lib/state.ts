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

/** `.dev/` is runtime state only; `STUDIQ_ENV_STATE_DIR` isolates tests. */
export const DEV_DIR = process.env.STUDIQ_ENV_STATE_DIR
  ? resolve(REPO_ROOT, process.env.STUDIQ_ENV_STATE_DIR)
  : join(REPO_ROOT, '.dev');

export interface StackState {
  stackName: string;
  profile: string | null;
  cold: boolean;
  updatedAt: string;
}

export interface BuildState {
  fingerprint: string;
  envHash: string;
  builtAt: string;
}

export function ensureDevDir(): void {
  mkdirSync(DEV_DIR, { recursive: true, mode: 0o700 });
  chmodSync(DEV_DIR, 0o700);
}

function atomicWrite(path: string, contents: string): void {
  ensureDevDir();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  chmodSync(path, 0o600);
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function identityKey(projectRoot: string, branch: string, stackName: string): string {
  return createHash('sha256')
    .update(`${projectRoot}\0${branch}\0${stackName}`)
    .digest('hex')
    .slice(0, 16);
}

const STATE_FILE = join(DEV_DIR, 'stack.json');

export function readStackState(): StackState | null {
  const parsed = readJson(STATE_FILE);
  if (!parsed || typeof parsed.stackName !== 'string') return null;
  return {
    stackName: parsed.stackName,
    profile: typeof parsed.profile === 'string' ? parsed.profile : null,
    cold: parsed.cold === true,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
  };
}

export function writeStackState(state: StackState): void {
  atomicWrite(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export function removeStackState(): void {
  rmSync(STATE_FILE, { force: true });
}

const BUILD_FILE = join(DEV_DIR, 'build.json');

export function readBuildState(): BuildState | null {
  const parsed = readJson(BUILD_FILE);
  if (!parsed || typeof parsed.fingerprint !== 'string' || typeof parsed.envHash !== 'string') {
    return null;
  }
  return {
    fingerprint: parsed.fingerprint,
    envHash: parsed.envHash,
    builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : '',
  };
}

export function writeBuildState(state: BuildState): void {
  atomicWrite(BUILD_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Forget the recorded build. Recovery calls this before putting an older
 * artifact back: the restored `.next` must never inherit the interrupted run's
 * "this build is current" claim.
 */
export function removeBuildState(): void {
  rmSync(BUILD_FILE, { force: true });
}

export function buildArtifactPresent(): boolean {
  return existsSync(join(REPO_ROOT, 'apps', 'web', '.next', 'BUILD_ID'));
}

/** Append one human line to `.dev/env.log`; callers never pass secrets. */
export function appendEnvLog(line: string): void {
  ensureDevDir();
  const path = join(DEV_DIR, 'env.log');
  const created = !existsSync(path);
  writeFileSync(path, `[${new Date().toISOString()}] ${line}\n`, { flag: 'a', mode: 0o600 });
  if (created) chmodSync(path, 0o600);
}
