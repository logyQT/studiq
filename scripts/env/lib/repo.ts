import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** This checkout's root, canonicalised like `pwd -P` in the legacy dev script. */
export const REPO_ROOT = realpathSync(join(HERE, '..', '..', '..'));

/** Resolve a path to its real form; unmatched paths are returned unchanged. */
export function canon(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Whether a CLI/registry path names this checkout. The Supabase CLI may report
 * a non-canonical project root (symlinked worktree, trailing form), so every
 * ownership/lease comparison goes through `canon`.
 */
export function isThisCheckout(path: string | null | undefined): boolean {
  if (!path) return false;
  return canon(path) === REPO_ROOT;
}

/**
 * Whether a CLI `--workdir`/`SUPABASE_WORKDIR` value names this checkout. The
 * CLI resolves a relative workdir from our cwd, which is the repo root.
 */
export function isThisCheckoutWorkdir(workdir: string): boolean {
  return canon(workdir.startsWith('/') ? workdir : join(REPO_ROOT, workdir)) === REPO_ROOT;
}

function runGit(args: string[], input?: string): string | null {
  const result = spawnSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    input,
    timeout: 10_000,
  });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim();
}

/** `refs/heads/<branch>` (the CLI's `branch_context`), or `detached`. */
export function currentBranchRef(): string {
  return runGit(['symbolic-ref', '-q', 'HEAD']) || 'detached';
}

/** Short branch name for human output; `detached` when there is no branch. */
export function currentBranchName(): string {
  return runGit(['branch', '--show-current']) || 'detached';
}

/**
 * The primary checkout's path (the first `git worktree list` entry). The
 * machine-wide observability stack belongs to this checkout, not to whichever
 * worktree an agent happens to be in.
 */
export function primaryCheckoutPath(): string {
  const output = runGit(['worktree', 'list', '--porcelain', '-z']);
  if (!output) return REPO_ROOT;

  // A genuinely bare primary checkout has no working tree (and no compose
  // file). Prefer the first entry that can actually own the stack; fall back to
  // this checkout so the printed command is at least runnable.
  for (const record of output.split('\0')) {
    if (!record.startsWith('worktree ')) continue;
    const path = canon(record.slice('worktree '.length));
    if (existsSync(join(path, 'docker-compose.yml'))) return path;
  }
  return REPO_ROOT;
}

/** Same normalisation as the legacy dev script's `sanitize_project_id`. */
export function sanitizeProjectId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

/**
 * Git's blob object id for the checkout path (`git hash-object --stdin`).
 * Falls back to the same SHA-1 computation when git is unavailable.
 */
function pathHash(root: string): string {
  const gitHash = runGit(['hash-object', '--stdin'], root);
  if (gitHash) return gitHash.slice(0, 8);
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(root)}\0${root}`)
    .digest('hex')
    .slice(0, 8);
}

/**
 * Project id used only by the shared-stack path (borrowed from the legacy dev script's
 * `derive_project_id`): slugged directory name plus a stable path hash.
 */
export function deriveProjectId(): string {
  const toplevel = runGit(['rev-parse', '--show-toplevel']) ?? REPO_ROOT;
  const root = canon(toplevel);
  const slug = sanitizeProjectId(basename(root)).slice(0, 30).replace(/-+$/, '');
  return sanitizeProjectId(`studiq-${slug}-${pathHash(root)}`);
}
