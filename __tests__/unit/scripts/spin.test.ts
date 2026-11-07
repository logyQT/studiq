import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SPIN_SCRIPT = fileURLToPath(new URL('../../../scripts/spin', import.meta.url));
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

// Never inherit the harness git context. Git hooks export GIT_DIR/GIT_WORK_TREE,
// and either one redirects `git init`/`git commit` at the real checkout instead
// of the temp repo. An allowlisted environment keeps every child hermetic.
const TEST_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME ?? tmpdir(),
  LANG: process.env.LANG,
  LC_ALL: process.env.LC_ALL,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'spin-test',
  GIT_AUTHOR_EMAIL: 'spin-test@example.com',
  GIT_COMMITTER_NAME: 'spin-test',
  GIT_COMMITTER_EMAIL: 'spin-test@example.com',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: TEST_ENV });
}

function runSpin(cwd: string, args: string[], env: NodeJS.ProcessEnv = TEST_ENV): string {
  return execFileSync('bash', [SPIN_SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function branchExists(repo: string, branch: string): boolean {
  return git(repo, 'branch', '--list', '--', branch).trim() !== '';
}

function spinStderr(cwd: string, args: string[], env: NodeJS.ProcessEnv = TEST_ENV): string {
  try {
    runSpin(cwd, args, env);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'stderr' in error) {
      const { stderr } = error;
      if (typeof stderr === 'string') return stderr;
      if (stderr instanceof Uint8Array) return new TextDecoder().decode(stderr);
    }
    return '';
  }
  throw new Error(`Expected scripts/spin to fail: ${args.join(' ')}`);
}

function failingGitEnv(parent: string, failingArgs: string): NodeJS.ProcessEnv {
  const bin = join(parent, 'bin');
  mkdirSync(bin, { recursive: true });
  const realGit = execFileSync('bash', ['-c', 'command -v git'], {
    encoding: 'utf8',
    env: TEST_ENV,
  }).trim();
  writeFileSync(
    join(bin, 'git'),
    `#!/usr/bin/env bash
case "$*" in
  *"${failingArgs}"*) echo "simulated ${failingArgs} failure" >&2; exit 1 ;;
esac
exec "${realGit}" "$@"
`,
    { mode: 0o755 },
  );
  return { ...TEST_ENV, PATH: `${bin}:${TEST_ENV.PATH ?? ''}` };
}

describe('scripts/spin', () => {
  const tempDirs: string[] = [];
  const readonlyDirs: string[] = [];

  afterEach(() => {
    for (const dir of readonlyDirs.splice(0)) chmodSync(dir, 0o755);
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeRepo(name: string): { parent: string; repo: string; root: string } {
    const parent = mkdtempSync(join(tmpdir(), 'spin-test-'));
    tempDirs.push(parent);
    const repo = join(parent, name);
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');

    // Fail loudly rather than touch the real workspace if isolation ever breaks.
    const topLevel = git(repo, 'rev-parse', '--show-toplevel').trim();
    if (realpathSync(topLevel) !== realpathSync(repo)) {
      throw new Error(`Refusing to run git outside the temp repo: ${topLevel}`);
    }

    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    return { parent, repo, root: join(parent, `${name}-worktrees`) };
  }

  it('creates and cleans a worktree when the repo path contains unusual characters', () => {
    const name = 'stüdiq repo\nname';
    const { parent, repo } = makeRepo(name);
    const worktree = join(parent, `${name}-worktrees`, 'feat', 'x');

    runSpin(repo, ['feat/x']);
    expect(existsSync(worktree)).toBe(true);
    expect(branchExists(repo, 'feat/x')).toBe(true);

    runSpin(repo, ['feat/x', '--clean']);
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists(repo, 'feat/x')).toBe(false);
  });

  it('preserves the branch hierarchy and keeps similar prefixes apart', () => {
    const { repo, root } = makeRepo('studiq');

    runSpin(repo, ['feat/x']);
    runSpin(repo, ['feat-x']);

    expect(existsSync(join(root, 'feat', 'x'))).toBe(true);
    expect(existsSync(join(root, 'feat-x'))).toBe(true);

    runSpin(repo, ['feat/x', '--clean']);
    runSpin(repo, ['feat-x', '--clean']);
  });

  it('supports multi-slash branches', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat', 'x', 'y');

    runSpin(repo, ['feat/x/y']);
    expect(existsSync(worktree)).toBe(true);

    runSpin(repo, ['feat/x/y', '--clean']);
    expect(existsSync(worktree)).toBe(false);
  });

  it.skipIf(IS_ROOT)('fails before creating a branch when the parent is not writable', () => {
    const { parent, repo } = makeRepo('studiq');
    chmodSync(parent, 0o555);
    readonlyDirs.push(parent);

    expect(spinStderr(repo, ['feat/nope'])).toMatch(/not writable/);
    expect(branchExists(repo, 'feat/nope')).toBe(false);
  });

  it('deletes the branch when the worktree directory was removed by hand', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat', 'gone');

    runSpin(repo, ['feat/gone']);
    rmSync(worktree, { recursive: true, force: true });

    runSpin(repo, ['feat/gone', '--clean']);
    expect(branchExists(repo, 'feat/gone')).toBe(false);
  });

  it('refuses to clean a worktree without scripts/spin provenance', () => {
    const { repo, root } = makeRepo('studiq');
    const foreign = join(root, 'feat', 'foreign');

    mkdirSync(join(root, 'feat'), { recursive: true });
    git(repo, 'worktree', 'add', '-q', foreign, '-b', 'feat/foreign', 'main');
    writeFileSync(join(foreign, 'local.txt'), 'dirty');

    expect(spinStderr(repo, ['feat/foreign', '--clean'])).toMatch(
      /without scripts\/spin provenance/,
    );
    expect(existsSync(join(foreign, 'local.txt'))).toBe(true);
    expect(branchExists(repo, 'feat/foreign')).toBe(true);
  });

  it('marks created worktrees with its provenance lock', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat', 'locked');

    runSpin(repo, ['feat/locked']);
    const porcelain = git(repo, 'worktree', 'list', '--porcelain', '-z');
    expect(porcelain).toContain(worktree);
    expect(porcelain).toContain('locked created-by-scripts/spin');

    runSpin(repo, ['feat/locked', '--clean']);
  });

  it('does not leave an orphan branch when worktree add fails', () => {
    const { parent, repo } = makeRepo('studiq');
    const env = failingGitEnv(parent, 'worktree add');

    expect(spinStderr(repo, ['feat/broken'], env)).toMatch(/simulated worktree add failure/);
    expect(branchExists(repo, 'feat/broken')).toBe(false);
  });

  it('keeps the provenance lock when worktree removal fails', () => {
    const { parent, repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat', 'stuck');
    runSpin(repo, ['feat/stuck']);

    const env = failingGitEnv(parent, 'worktree remove');
    expect(spinStderr(repo, ['feat/stuck', '--clean'], env)).toMatch(
      /simulated worktree remove failure/,
    );

    const porcelain = git(repo, 'worktree', 'list', '--porcelain', '-z');
    expect(porcelain).toContain(worktree);
    expect(porcelain).toContain('locked created-by-scripts/spin');

    // The real cleanup still works afterwards.
    runSpin(repo, ['feat/stuck', '--clean']);
  });

  it('refuses to clean the primary checkout from a linked worktree', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat', 'x');

    runSpin(repo, ['feat/x']);

    expect(spinStderr(worktree, ['main', '--clean'])).toMatch(/primary checkout/);
    expect(existsSync(repo)).toBe(true);
    expect(branchExists(repo, 'main')).toBe(true);
  });

  it('rejects an existing branch and an existing directory', () => {
    const { repo, root } = makeRepo('studiq');

    runSpin(repo, ['feat/dup']);
    expect(spinStderr(repo, ['feat/dup'])).toMatch(/already exists/);

    mkdirSync(join(root, 'chore', 'pre'), { recursive: true });
    expect(spinStderr(repo, ['chore/pre'])).toMatch(/Directory already exists/);

    runSpin(repo, ['feat/dup', '--clean']);
  });

  it('lists worktrees and describes the layout in --help', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat', 'listed');

    runSpin(repo, ['feat/listed']);
    expect(runSpin(repo, ['--list'])).toContain(worktree);
    expect(runSpin(repo, ['--help'])).toContain('-worktrees/feat/my-feature');

    runSpin(repo, ['feat/listed', '--clean']);
  });
});
