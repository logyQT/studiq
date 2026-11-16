import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EXIT_CONFLICT, EnvFailure } from './exit';
import type { StatusSnapshot } from './json';
import { REPO_ROOT } from './repo';

/**
 * `qa/env.json` — the URL-only handoff that lets several agent worktrees drive
 * one app.
 *
 * The split is deliberate: the pointer says **which** stack (`appUrl`,
 * `supabaseUrl`, `mailpitUrl`), and each checkout's `.env.local` says **who you
 * are** (anon + service-role key). So the file is copyable between worktrees
 * without moving a secret, and a stale copy can only misdirect URLs — never leak
 * a key.
 *
 * `__tests__/helpers/db-admin.ts`, `mailpit.ts`, the QA seeder and the QA specs
 * read these keys already; `env:share` is the writer they never had.
 */
export interface QaPointer {
  appUrl: string;
  supabaseUrl: string;
  mailpitUrl: string | null;
  stackId: string | null;
  branch: string | null;
  commit: string | null;
  writtenAt: string;
}

export type PointerRead =
  { state: 'absent' } | { state: 'invalid'; reason: string } | { state: 'ok'; pointer: QaPointer };

/** Relative to the checkout root, like every other QA artifact. */
const POINTER_RELATIVE = join('qa', 'env.json');

/**
 * The pointer this checkout reads. `STUDIQ_QA_POINTER` isolates tests: without
 * it a doctor run would read the developer's real pointer and report warnings no
 * fixture created.
 */
export function pointerPath(): string {
  return process.env.STUDIQ_QA_POINTER || join(REPO_ROOT, POINTER_RELATIVE);
}

export function buildPointer(snapshot: StatusSnapshot, now = new Date()): QaPointer {
  return {
    appUrl: snapshot.urls.app,
    supabaseUrl: snapshot.urls.supabase ?? '',
    mailpitUrl: snapshot.urls.mail ?? snapshot.mailUrl,
    stackId: snapshot.stackId,
    branch: snapshot.branch,
    commit: snapshot.commit,
    writtenAt: now.toISOString(),
  };
}

function isPointer(value: unknown): value is QaPointer {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.appUrl === 'string' &&
    candidate.appUrl.length > 0 &&
    typeof candidate.supabaseUrl === 'string' &&
    candidate.supabaseUrl.length > 0
  );
}

export function readPointer(path = pointerPath()): PointerRead {
  if (!existsSync(path)) return { state: 'absent' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { state: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
  if (!isPointer(parsed)) {
    return { state: 'invalid', reason: 'expected appUrl and supabaseUrl strings' };
  }
  return { state: 'ok', pointer: parsed };
}

export type PointerWriteState = 'written' | 'unchanged';

export interface PointerWriteResult {
  path: string;
  state: PointerWriteState;
}

/**
 * Write the pointer, atomically and private (0600 — it carries local URLs, no
 * keys, but it is still machine state that belongs to one user).
 *
 * Replacing a pointer that names a **different** app is a conflict, not an
 * update: a wrong pointer silently sends the seeder and every spec to another
 * database, which is the failure this file's readers cannot detect themselves.
 */
export function writePointer(
  pointer: QaPointer,
  options: { path?: string; force?: boolean } = {},
): PointerWriteResult {
  const path = options.path ?? pointerPath();
  const existing = readPointer(path);
  if (existing.state === 'ok') {
    const same = existing.pointer.appUrl === pointer.appUrl;
    if (same) return { path, state: 'unchanged' };
    if (!options.force) {
      throw new EnvFailure(
        EXIT_CONFLICT,
        `refusing to replace ${path}: it points at ${existing.pointer.appUrl}` +
          `${existing.pointer.stackId ? ` (stack ${existing.pointer.stackId.slice(0, 12)})` : ''}. ` +
          `Pass --force to point it at ${pointer.appUrl} instead.`,
      );
    }
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Temp file in the same directory, so the rename is atomic on one filesystem.
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(pointer, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
  return { path, state: 'written' };
}
