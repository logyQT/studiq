import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The QA pointer a consumer worktree reads (`qa/env.json`).
 *
 * The owning checkout writes it with `bun run env:share --write`; it carries
 * URLs only — the service-role key stays in each checkout's `.env.local`. Absent,
 * malformed or not a JSON object reads as no pointer, so the caller decides what
 * comes next: `QA_APP_URL` first, then this pointer (`resolveQaAppUrl`), and
 * outside CI there is no default at all.
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

/** The shared QA app, which the env tool deliberately never leases. */
const SHARED_QA_APP_URL = 'http://localhost:3010';

/**
 * Many tools export `CI=false` or `CI=0` on a developer box, so presence is not a signal: only
 * an affirmative value counts, and it is trimmed and compared case-insensitively.
 */
function isCi(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/**
 * The app a QA run was told to talk to, or `null` when nobody told it (#1286): an explicit
 * `QA_APP_URL`, then the pointer `env:share` wrote. CI exports `QA_APP_URL` and `CI` itself, so
 * there the shared app is the right default; anywhere else `:3010` is another checkout's app and
 * must never be a silent one. An empty `QA_APP_URL=` (the env schema declares the key optional)
 * is "not set".
 *
 * Never throws, so it is safe where a config is merely loaded (listing, knip's Playwright plugin).
 */
export function resolveQaAppUrl(
  root = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const url = env.QA_APP_URL || readQaPointer(root)?.appUrl;
  if (url) return url;
  return isCi(env) ? SHARED_QA_APP_URL : null;
}

/**
 * The app a QA run talks to, or an actionable error: a bare `bunx playwright test` would
 * otherwise silently exercise the shared `:3010` app, or hang on a port with nothing behind it.
 * Reaching the shared app on purpose takes `QA_APP_URL=http://localhost:3010`.
 */
export function qaAppUrl(root = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  const url = resolveQaAppUrl(root, env);
  if (url) return url;
  throw new Error(
    [
      'QA_APP_URL is not set and there is no qa/env.json pointer: this run would silently hit',
      `the shared QA app on ${SHARED_QA_APP_URL}, which is another checkout's app.`,
      "Run it through the wrapper, which sets QA_APP_URL to this checkout's app:",
      '  bun run env:run -- bun run test:qa <spec>',
      'or set QA_APP_URL yourself, or write the pointer with `bun run env:share --write`.',
      `To target the shared app on purpose, set QA_APP_URL=${SHARED_QA_APP_URL}.`,
    ].join('\n'),
  );
}
