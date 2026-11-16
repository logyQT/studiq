import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The QA pointer a consumer worktree reads (`qa/env.json`).
 *
 * The owning checkout writes it with `bun run env:share --write`; it carries
 * URLs only — the service-role key stays in each checkout's `.env.local`. Absent
 * or malformed is normal for a single-checkout run, so every reader degrades to
 * `process.env` and then to the documented local default.
 */
export interface QaPointerFile {
  appUrl?: string;
  supabaseUrl?: string;
  mailpitUrl?: string;
  stackId?: string;
  branch?: string;
  commit?: string;
}

export function readQaPointer(root = process.cwd()): QaPointerFile | null {
  const path = join(root, 'qa', 'env.json');
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    // The file is written by `env:share`; a malformed one must not hide the
    // caller's real error, so a parse failure reads as "no pointer".
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  // Rebuilt field by field: the pointer is a local file, but a wrong type here
  // would surface as a broken baseURL two layers away.
  const record: Record<string, unknown> = { ...parsed };
  return {
    appUrl: typeof record.appUrl === 'string' ? record.appUrl : undefined,
    supabaseUrl: typeof record.supabaseUrl === 'string' ? record.supabaseUrl : undefined,
    mailpitUrl: typeof record.mailpitUrl === 'string' ? record.mailpitUrl : undefined,
  };
}

/** The app a QA run talks to: explicit env, then the pointer, then the local default. */
export function qaAppUrl(root = process.cwd()): string {
  return process.env.QA_APP_URL ?? readQaPointer(root)?.appUrl ?? 'http://localhost:3010';
}
