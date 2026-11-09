import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build fingerprint (spec §8).
 *
 * Next inlines `NEXT_PUBLIC_*` at build time, and `HEAD^{tree}` +
 * `git status --porcelain` alone do not notice a second edit to an already
 * modified file. The fingerprint therefore hashes:
 *
 * - the three inlined public values (as one hash — the values are never stored),
 * - the build mode,
 * - `HEAD^{tree}`, and
 * - the **content** of every changed/untracked non-ignored file.
 *
 * Only the final hash is persisted (`.dev/build.json`), never the inputs.
 */
export interface PublicBuildEnv {
  supabaseUrl: string;
  siteUrl: string;
  anonKey: string;
}

export function buildEnvHash(env: PublicBuildEnv): string {
  return createHash('sha256')
    .update(JSON.stringify([env.supabaseUrl, env.siteUrl, env.anonKey]))
    .digest('hex');
}

/** Git variables that point at another worktree (e.g. inside hooks). */
const GIT_LOCAL_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
];

function git(root: string, args: string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of GIT_LOCAL_ENV) delete env[name];
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env,
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (exit ${result.status ?? 'unknown'}): ${(result.stderr ?? '').trim()}`,
    );
  }
  return result.stdout ?? '';
}

function contentHash(path: string): string {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      return createHash('sha256')
        .update(`symlink:${readlinkSync(path)}`)
        .digest('hex');
    }
    if (!stat.isFile()) return 'not-a-file';
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    // Deleted files are represented by their status entry alone.
    return 'missing';
  }
}

interface ChangedFile {
  status: string;
  path: string;
  content: string;
}

/**
 * Content hash of the working tree (tracked changes + untracked source).
 * @public Exercised by the unit tests, which load this module by computed URL.
 */
export function workingTreeHash(root: string): string {
  const headTree = git(root, ['rev-parse', 'HEAD^{tree}']).trim();
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const tokens = status.split('\0');
  const entries: ChangedFile[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (token.length < 4) continue;
    const code = token.slice(0, 2);
    const path = token.slice(3);
    // Rename/copy entries carry the source path as the next NUL token.
    if (code.includes('R') || code.includes('C')) index += 1;
    entries.push({ status: code, path, content: contentHash(join(root, path)) });
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));
  return createHash('sha256')
    .update(headTree)
    .update('\0')
    .update(entries.map((entry) => `${entry.status}\0${entry.path}\0${entry.content}`).join('\0'))
    .digest('hex');
}

export interface FingerprintInput {
  root: string;
  mode: string;
  envHash: string;
  /** Injected in tests so the tree hash need not be recomputed. */
  treeHash?: string;
}

/** The persisted build fingerprint (no inputs, no secrets). */
export function computeBuildFingerprint(input: FingerprintInput): string {
  const treeHash = input.treeHash ?? workingTreeHash(input.root);
  return createHash('sha256')
    .update(JSON.stringify({ mode: input.mode, envHash: input.envHash, treeHash }))
    .digest('hex');
}

export const BUILD_MODE = 'production';
