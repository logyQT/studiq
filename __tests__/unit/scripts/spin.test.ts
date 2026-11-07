import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SPIN_SCRIPT = fileURLToPath(new URL('../../../scripts/spin', import.meta.url));

// Git hooks export GIT_DIR/GIT_WORK_TREE; strip them so child git commands
// target the temporary repositories, not the repo running the suite.
const GIT_DIR_VARS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
];

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'spin-test',
  GIT_AUTHOR_EMAIL: 'spin-test@example.com',
  GIT_COMMITTER_NAME: 'spin-test',
  GIT_COMMITTER_EMAIL: 'spin-test@example.com',
};
for (const key of GIT_DIR_VARS) delete GIT_ENV[key];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

function runSpin(cwd: string, ...args: string[]): string {
  return execFileSync('bash', [SPIN_SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('scripts/spin', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeRepo(name: string): { parent: string; repo: string } {
    const parent = mkdtempSync(join(tmpdir(), 'spin-test-'));
    tempDirs.push(parent);
    const repo = join(parent, name);
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    return { parent, repo };
  }

  it('cleans a worktree when the repo path contains unusual characters', () => {
    const { parent, repo } = makeRepo('stüdiq\nrepo');
    const worktree = join(parent, 'stüdiq\nrepo-feat-x');

    runSpin(repo, 'feat/x');
    expect(existsSync(worktree)).toBe(true);
    expect(git(repo, 'branch', '--list', 'feat/x')).toContain('feat/x');

    runSpin(repo, 'feat/x', '--clean');
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, 'branch', '--list', 'feat/x').trim()).toBe('');
  });

  it('deletes the branch when the worktree directory was removed by hand', () => {
    const { parent, repo } = makeRepo('studiq');
    const worktree = join(parent, 'studiq-feat-gone');

    runSpin(repo, 'feat/gone');
    rmSync(worktree, { recursive: true, force: true });

    runSpin(repo, 'feat/gone', '--clean');
    expect(git(repo, 'branch', '--list', 'feat/gone').trim()).toBe('');
  });

  it('refuses to clean the primary checkout from a linked worktree', () => {
    const { parent, repo } = makeRepo('studiq');
    const worktree = join(parent, 'studiq-feat-x');

    runSpin(repo, 'feat/x');

    expect(() => runSpin(worktree, 'main', '--clean')).toThrow();
    expect(existsSync(repo)).toBe(true);
    expect(git(repo, 'branch', '--list', 'main')).toContain('main');
  });
});
