import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

function runSpinCaptured(cwd: string, args: string[], env: NodeJS.ProcessEnv = TEST_ENV) {
  return spawnSync('bash', [SPIN_SCRIPT, ...args], { cwd, encoding: 'utf8', env });
}

function branchExists(repo: string, branch: string): boolean {
  return git(repo, 'branch', '--list', '--', branch).trim() !== '';
}

// A worktree created outside scripts/spin, optionally locked with the given
// reason. This is how the refusal cases present a foreign worktree.
function addWorktree(repo: string, worktree: string, branch: string, lockReason?: string): void {
  mkdirSync(dirname(worktree), { recursive: true });
  git(repo, 'worktree', 'add', '-q', worktree, '-b', branch, 'main');
  if (lockReason !== undefined) {
    git(repo, 'worktree', 'lock', '--reason', lockReason, worktree);
  }
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

// A git that fails only on `fetch`, with a caller-chosen message. Needed to
// prove the script redacts a URL that still carries credentials — the real git
// redacts them itself, so a live fetch cannot exercise that branch.
function failingFetchEnv(parent: string, message: string): NodeJS.ProcessEnv {
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
  *fetch*) printf '%s\\n' "$FAKE_FETCH_ERROR" >&2; exit 1 ;;
esac
exec "${realGit}" "$@"
`,
    { mode: 0o755 },
  );
  return { ...TEST_ENV, PATH: `${bin}:${TEST_ENV.PATH ?? ''}`, FAKE_FETCH_ERROR: message };
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
    // The default worktree root is the checkout's parent directory.
    return { parent, repo, root: parent };
  }

  it('creates a worktree directly in the parent directory', () => {
    const { repo, root } = makeRepo('studiq');

    runSpin(repo, ['release-candidate']);

    expect(existsSync(join(root, 'release-candidate'))).toBe(true);
    expect(branchExists(repo, 'release-candidate')).toBe(true);

    runSpin(repo, ['release-candidate', '--clean']);
  });

  it('flattens branch slashes so a worktree never adds a directory level', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat-x-y');

    runSpin(repo, ['feat/x/y']);
    expect(existsSync(worktree)).toBe(true);
    expect(existsSync(join(root, 'feat'))).toBe(false);

    runSpin(repo, ['feat/x/y', '--clean']);
    expect(existsSync(worktree)).toBe(false);
  });

  it('refuses a second branch that flattens to an occupied directory', () => {
    const { repo, root } = makeRepo('studiq');

    runSpin(repo, ['feat-x']);

    const stderr = spinStderr(repo, ['feat/x']);
    expect(stderr).toMatch(/Directory already exists/);
    expect(stderr).toContain(join(root, 'feat-x'));
    expect(stderr).toContain("checkout of branch 'feat-x'");
    expect(stderr).not.toContain('Remove it manually');
    expect(branchExists(repo, 'feat/x')).toBe(false);

    runSpin(repo, ['feat-x', '--clean']);
  });

  it('names the primary checkout when the branch name matches it', () => {
    const { repo } = makeRepo('studiq');

    const stderr = spinStderr(repo, ['studiq']);

    expect(stderr).toMatch(/Directory already exists/);
    expect(stderr).toContain('It is the primary checkout');
    expect(stderr).not.toContain('Remove it manually');
    expect(stderr).not.toContain('SPIN_WORKTREE_ROOT');
    expect(branchExists(repo, 'studiq')).toBe(false);
  });

  it('refuses a worktree root that exists as a file, before creating a branch', () => {
    const { parent, repo } = makeRepo('studiq');
    const fileRoot = join(parent, 'afile');
    writeFileSync(fileRoot, '');
    const env = { ...TEST_ENV, SPIN_WORKTREE_ROOT: fileRoot };

    const result = runSpinCaptured(repo, ['feat/file'], env);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not a directory/);
    expect(result.stdout).not.toContain('Created branch');
    expect(branchExists(repo, 'feat/file')).toBe(false);
  });

  it('deletes the branch when the worktree directory cannot be created', () => {
    const { parent, repo } = makeRepo('studiq');
    const bin = join(parent, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'mkdir'),
      '#!/usr/bin/env bash\necho "simulated mkdir failure" >&2\nexit 1\n',
      { mode: 0o755 },
    );
    const env = { ...TEST_ENV, PATH: `${bin}:${TEST_ENV.PATH ?? ''}` };

    expect(spinStderr(repo, ['feat/nodir'], env)).toMatch(/simulated mkdir failure/);
    expect(branchExists(repo, 'feat/nodir')).toBe(false);
  });

  it('creates and cleans a worktree when the repo path contains unusual characters', () => {
    const name = 'stüdiq repo\nname';
    const { parent, repo } = makeRepo(name);
    const worktree = join(parent, 'feat-x');

    runSpin(repo, ['feat/x']);
    expect(existsSync(worktree)).toBe(true);
    expect(branchExists(repo, 'feat/x')).toBe(true);

    runSpin(repo, ['feat/x', '--clean']);
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists(repo, 'feat/x')).toBe(false);
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
    const worktree = join(root, 'feat-gone');

    runSpin(repo, ['feat/gone']);
    rmSync(worktree, { recursive: true, force: true });

    runSpin(repo, ['feat/gone', '--clean']);
    expect(branchExists(repo, 'feat/gone')).toBe(false);
  });

  it('cleans a worktree at the default path', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat-cleaned');

    runSpin(repo, ['feat/cleaned']);
    expect(existsSync(worktree)).toBe(true);

    const result = runSpinCaptured(repo, ['feat/cleaned', '--clean']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Removed worktree: ${worktree}`);
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists(repo, 'feat/cleaned')).toBe(false);
  });

  it('refuses to clean a worktree with uncommitted changes', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-probe');
    writeFileSync(join(repo, 'tracked.txt'), 'committed\n');
    git(repo, 'add', 'tracked.txt');
    git(repo, 'commit', '-q', '-m', 'tracked file');

    runSpin(repo, ['chore/probe']);
    // Untracked work and an in-place edit are both lost by a removal.
    writeFileSync(join(worktree, 'PRECIOUS.md'), 'uncommitted work\n');
    writeFileSync(join(worktree, 'tracked.txt'), 'edited\n');

    const result = runSpinCaptured(repo, ['chore/probe', '--clean']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing to clean 'chore/probe'");
    expect(result.stderr).toContain('PRECIOUS.md');
    expect(result.stderr).toContain('tracked.txt');
    expect(result.stderr).toContain('--clean --force');
    // The refusal says what it checks, and that ignored files go with the tree.
    expect(result.stderr).toContain('The check covers tracked edits, staged changes');
    expect(result.stderr).toContain('git-ignored files (.env.local, node_modules, .next)');
    // The refusal must not fall through to the branch deletion.
    expect(result.stdout).not.toContain('Deleted branch');
    expect(readFileSync(join(worktree, 'PRECIOUS.md'), 'utf8')).toBe('uncommitted work\n');
    expect(branchExists(repo, 'chore/probe')).toBe(true);
  });

  it('finds untracked files even when repo config hides them from status', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-hidden');

    runSpin(repo, ['chore/hidden']);
    writeFileSync(join(worktree, 'NOTES.md'), 'not committed\n');
    // A repo (or user) config that turns status into a lie for this call.
    git(repo, 'config', 'status.showUntrackedFiles', 'no');

    const result = runSpinCaptured(repo, ['chore/hidden', '--clean']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('NOTES.md');
    expect(readFileSync(join(worktree, 'NOTES.md'), 'utf8')).toBe('not committed\n');
    expect(branchExists(repo, 'chore/hidden')).toBe(true);
  });

  it('removes a worktree whose only file is git-ignored, as the refusal states', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-ignored');
    writeFileSync(join(repo, '.gitignore'), '.env.local\n');
    git(repo, 'add', '.gitignore');
    git(repo, 'commit', '-q', '-m', 'ignore the values file');

    runSpin(repo, ['chore/ignored']);
    writeFileSync(join(worktree, '.env.local'), 'SECRET=1\n');
    // Ignored content is not inspected; the refusal text says so explicitly.
    expect(git(worktree, 'status', '--porcelain')).not.toContain('.env.local');

    const result = runSpinCaptured(repo, ['chore/ignored', '--clean']);

    expect(result.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists(repo, 'chore/ignored')).toBe(false);
  });

  it('inspects its own worktree even when GIT_DIR points at another checkout', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-redirected');

    runSpin(repo, ['chore/redirected']);
    writeFileSync(join(worktree, 'PRECIOUS.md'), 'uncommitted work\n');
    // The parent checkout is clean, so an inherited GIT_DIR would report clean
    // for the worktree about to be removed.
    const env = { ...TEST_ENV, GIT_DIR: join(repo, '.git'), GIT_WORK_TREE: repo };

    const result = runSpinCaptured(repo, ['chore/redirected', '--clean'], env);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PRECIOUS.md');
    expect(readFileSync(join(worktree, 'PRECIOUS.md'), 'utf8')).toBe('uncommitted work\n');
    expect(branchExists(repo, 'chore/redirected')).toBe(true);
  });

  it('treats a hand-written .spin-base as dirt, not as its stamp', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-fake-stamp');

    runSpin(repo, ['chore/fake-stamp']);
    writeFileSync(join(worktree, '.spin-base'), 'notes I care about\n');

    const result = runSpinCaptured(repo, ['chore/fake-stamp', '--clean']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('.spin-base');
    expect(existsSync(join(worktree, '.spin-base'))).toBe(true);
    expect(branchExists(repo, 'chore/fake-stamp')).toBe(true);
  });

  it('refuses when the worktree cannot be inspected', () => {
    const { parent, repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-unreadable');

    runSpin(repo, ['chore/unreadable']);
    const env = failingGitEnv(parent, 'status');

    const result = runSpinCaptured(repo, ['chore/unreadable', '--clean'], env);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Could not inspect worktree for uncommitted changes');
    expect(existsSync(worktree)).toBe(true);
    expect(branchExists(repo, 'chore/unreadable')).toBe(true);
  });

  it('warns that --force means nothing without --clean', () => {
    const { repo, root } = makeRepo('studiq');

    const result = runSpinCaptured(repo, ['chore/force-alone', '--force']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--force only applies to --clean');
    expect(existsSync(join(root, 'chore-force-alone'))).toBe(true);

    runSpin(repo, ['chore/force-alone', '--clean']);
  });

  it('caps the dirty-path list and says how many paths are affected', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-many');

    runSpin(repo, ['chore/many']);
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(worktree, `dirty-${String(i).padStart(2, '0')}.txt`), 'x');
    }

    const stderr = spinStderr(repo, ['chore/many', '--clean']);

    expect(stderr).toContain('25 path(s) affected');
    expect(stderr).toContain('(showing the first 20)');
    expect(stderr.match(/^ {4}\?\? dirty-/gm)).toHaveLength(20);
    expect(branchExists(repo, 'chore/many')).toBe(true);
  });

  it('removes a dirty worktree with --force', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-forced');

    runSpin(repo, ['chore/forced']);
    writeFileSync(join(worktree, 'PRECIOUS.md'), 'uncommitted work\n');

    const result = runSpinCaptured(repo, ['chore/forced', '--clean', '--force']);

    expect(result.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists(repo, 'chore/forced')).toBe(false);
  });

  it('does not treat its own .spin-base stamp as uncommitted work', () => {
    // The temp repo has no .gitignore entry for the stamp, so this pins the
    // explicit exclusion rather than the ignore file doing the work.
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'chore-stamped');

    runSpin(repo, ['chore/stamped']);
    expect(git(worktree, 'status', '--porcelain')).toContain('.spin-base');

    const result = runSpinCaptured(repo, ['chore/stamped', '--clean']);

    expect(result.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists(repo, 'chore/stamped')).toBe(false);
  });

  // The locator is the branch registration, never the path recomputed from
  // the name, so a worktree that moved is still the one its branch owns.
  it('cleans a worktree registered at a path other than the computed one', () => {
    const { parent, repo } = makeRepo('studiq');
    const moved = join(parent, 'moved', 'feat-moved');

    runSpin(repo, ['feat/moved']);
    mkdirSync(dirname(moved), { recursive: true });
    git(repo, 'worktree', 'move', '-f', '-f', join(parent, 'feat-moved'), moved);

    const result = runSpinCaptured(repo, ['feat/moved', '--clean']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Removed worktree: ${moved}`);
    expect(existsSync(moved)).toBe(false);
    expect(branchExists(repo, 'feat/moved')).toBe(false);
  });

  it('creates beneath SPIN_WORKTREE_ROOT and cleans it by provenance', () => {
    const { parent, repo } = makeRepo('studiq');
    const env = { ...TEST_ENV, SPIN_WORKTREE_ROOT: join(parent, 'builds') };
    const worktree = join(parent, 'builds', 'feat-relocated');

    runSpin(repo, ['feat/relocated'], env);
    expect(existsSync(worktree)).toBe(true);
    expect(existsSync(join(parent, 'feat-relocated'))).toBe(false);

    const result = runSpinCaptured(repo, ['feat/relocated', '--clean'], env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Removed worktree: ${worktree}`);
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists(repo, 'feat/relocated')).toBe(false);
  });

  it('rejects a relative SPIN_WORKTREE_ROOT', () => {
    const { repo } = makeRepo('studiq');
    const env = { ...TEST_ENV, SPIN_WORKTREE_ROOT: 'relative/builds' };

    expect(spinStderr(repo, ['feat/rel'], env)).toMatch(/must be an absolute path/);
    expect(branchExists(repo, 'feat/rel')).toBe(false);
  });

  it.each([
    ['default', null, 'found ""'],
    ['default', 'kept-for-review', 'kept-for-review'],
    ['moved', null, 'found ""'],
    ['moved', 'kept-for-review', 'kept-for-review'],
  ])('refuses a %s worktree whose lock reason is %s', (layout, lockReason, found) => {
    const { parent, repo, root } = makeRepo('studiq');
    const branch = 'feat/foreign';
    const worktree =
      layout === 'moved' ? join(parent, 'moved', 'feat-foreign') : join(root, 'feat-foreign');
    addWorktree(repo, worktree, branch, lockReason ?? undefined);
    writeFileSync(join(worktree, 'local.txt'), 'dirty');

    const stderr = spinStderr(repo, [branch, '--clean']);

    expect(stderr).toMatch(/without scripts\/spin provenance/);
    expect(stderr).toContain(worktree);
    expect(stderr).toContain(found);
    expect(stderr).toContain('worktree remove -f -f');
    expect(existsSync(join(worktree, 'local.txt'))).toBe(true);
    expect(branchExists(repo, branch)).toBe(true);
  });

  it('names the occupant instead of advising removal when clean hits its path', () => {
    const { repo, root } = makeRepo('studiq');
    const occupant = join(root, 'feat-x');
    runSpin(repo, ['feat-x']);
    writeFileSync(join(occupant, 'work-in-progress.txt'), 'uncommitted');

    const result = runSpinCaptured(repo, ['feat/x', '--clean']);

    expect(result.stdout).toContain('another branch');
    expect(result.stdout).toContain("Branch 'feat-x' is checked out there");
    expect(result.stdout).not.toContain('rm -rf');
    expect(existsSync(join(occupant, 'work-in-progress.txt'))).toBe(true);
    expect(branchExists(repo, 'feat-x')).toBe(true);
    expect(branchExists(repo, 'feat/x')).toBe(false);

    // Cleanup: the occupant is deliberately dirty, so removal needs --force.
    runSpin(repo, ['feat-x', '--clean', '--force']);
  });

  it('cleans a worktree even when SPIN_WORKTREE_ROOT is relative', () => {
    const { repo, root } = makeRepo('studiq');
    runSpin(repo, ['feat/rel-clean']);
    const env = { ...TEST_ENV, SPIN_WORKTREE_ROOT: 'relative/builds' };

    const result = runSpinCaptured(repo, ['feat/rel-clean', '--clean'], env);

    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'feat-rel-clean'))).toBe(false);
    expect(branchExists(repo, 'feat/rel-clean')).toBe(false);
  });

  it('names a detached worktree instead of advising removal', () => {
    const { repo, root } = makeRepo('studiq');
    const detached = join(root, 'feat-det');

    git(repo, 'worktree', 'add', '-q', '--detach', detached, 'main');
    writeFileSync(join(detached, 'work-in-progress.txt'), 'uncommitted');

    const result = runSpinCaptured(repo, ['feat/det', '--clean']);

    expect(result.stdout).toContain('detached worktree');
    expect(result.stdout).not.toContain('rm -rf');
    expect(result.stdout).not.toContain('not a registered worktree');
    expect(existsSync(join(detached, 'work-in-progress.txt'))).toBe(true);
    expect(git(repo, 'worktree', 'list', '--porcelain')).toContain(detached);
  });

  it('keeps the manual hint for a directory with no registration', () => {
    const { repo, root } = makeRepo('studiq');
    const stray = join(root, 'feat-stray');
    mkdirSync(stray);

    const result = runSpinCaptured(repo, ['feat/stray', '--clean']);

    expect(result.stdout).toContain('not a registered worktree');
    expect(result.stdout).toContain(`rm -rf "${stray}"`);
    expect(existsSync(stray)).toBe(true);
  });

  it('prunes and deletes a branch that has no worktree', () => {
    const { repo } = makeRepo('studiq');
    git(repo, 'branch', 'feat/orphan', 'main');

    const result = runSpinCaptured(repo, ['feat/orphan', '--clean']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Pruned stale worktree entries');
    expect(result.stdout).toContain('Deleted branch: feat/orphan');
    expect(branchExists(repo, 'feat/orphan')).toBe(false);
  });

  it('marks created worktrees with its provenance lock', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat-locked');

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
    const worktree = join(root, 'feat-stuck');
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
    const worktree = join(root, 'feat-x');

    runSpin(repo, ['feat/x']);

    expect(spinStderr(worktree, ['main', '--clean'])).toMatch(/primary checkout/);
    expect(existsSync(repo)).toBe(true);
    expect(branchExists(repo, 'main')).toBe(true);
  });

  it('rejects an existing branch and an existing directory', () => {
    const { repo, root } = makeRepo('studiq');

    runSpin(repo, ['feat/dup']);
    expect(spinStderr(repo, ['feat/dup'])).toMatch(/already exists/);

    mkdirSync(join(root, 'chore-pre'), { recursive: true });
    expect(spinStderr(repo, ['chore/pre'])).toMatch(/Directory already exists/);

    runSpin(repo, ['feat/dup', '--clean']);
  });

  it('installs dependencies in the new worktree unless --no-install is passed', () => {
    const { parent, repo, root } = makeRepo('studiq');
    const installed = join(root, 'feat-installed');
    const marker = join(parent, 'bun-install-marker');

    // The temp repo has no lockfile by default; commit one so the install path runs.
    writeFileSync(join(repo, 'bun.lock'), '');
    git(repo, 'add', 'bun.lock');
    git(repo, 'commit', '-q', '-m', 'lock');

    const bin = join(parent, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'bun'),
      `#!/usr/bin/env bash
printf 'cwd=%s args=%s\\n' "$PWD" "$*" >> "$MARKER"
`,
      { mode: 0o755 },
    );
    const env = { ...TEST_ENV, PATH: `${bin}:${TEST_ENV.PATH ?? ''}`, MARKER: marker };

    runSpin(repo, ['feat/installed'], env);
    const invocation = readFileSync(marker, 'utf8');
    expect(invocation).toContain(`cwd=${installed}`);
    expect(invocation).toContain('args=install --frozen-lockfile');

    rmSync(marker, { force: true });
    runSpin(repo, ['feat/skipped', '--no-install'], env);
    expect(existsSync(marker)).toBe(false);

    runSpin(repo, ['feat/installed', '--clean']);
    runSpin(repo, ['feat/skipped', '--clean']);
  });

  it('keeps the worktree when dependency install fails', () => {
    const { parent, repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat-install-failed');

    writeFileSync(join(repo, 'bun.lock'), '');
    git(repo, 'add', 'bun.lock');
    git(repo, 'commit', '-q', '-m', 'lock');

    const bin = join(parent, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'bun'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
    const env = { ...TEST_ENV, PATH: `${bin}:${TEST_ENV.PATH ?? ''}` };

    runSpin(repo, ['feat/install-failed'], env);
    expect(existsSync(worktree)).toBe(true);
    expect(branchExists(repo, 'feat/install-failed')).toBe(true);

    runSpin(repo, ['feat/install-failed', '--clean']);
  });

  it('lists worktrees and describes the layout in --help', () => {
    const { repo, root } = makeRepo('studiq');
    const worktree = join(root, 'feat-listed');

    runSpin(repo, ['feat/listed']);
    const base = git(repo, 'rev-parse', 'feat/listed').trim().slice(0, 12);
    expect(runSpin(repo, ['--list'])).toContain(worktree);
    expect(runSpin(repo, ['--list'])).toContain(`base ${base}`);
    expect(runSpin(repo, ['--help'])).toContain('feat-my-feature');
    expect(runSpin(repo, ['--help'])).toContain('SPIN_WORKTREE_ROOT');
    expect(runSpin(repo, ['--help'])).toContain('--no-install');

    runSpin(repo, ['feat/listed', '--clean']);
  });

  it('branches from a freshly fetched origin/main and stamps the base commit', () => {
    const { parent, repo, root } = makeRepo('studiq');
    const remote = join(parent, 'remote.git');
    git(parent, 'init', '-q', '--bare', '-b', 'main', remote);
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main');
    const staleMain = git(repo, 'rev-parse', 'main').trim();

    // Advance the remote without touching local main, the state a stale
    // checkout is in when work starts.
    const clone = join(parent, 'clone');
    git(parent, 'clone', '-q', remote, clone);
    git(clone, 'commit', '-q', '--allow-empty', '-m', 'ahead of local main');
    git(clone, 'push', '-q', 'origin', 'main');
    const remoteMain = git(clone, 'rev-parse', 'HEAD').trim();

    runSpin(repo, ['feat/fresh']);
    const worktree = join(root, 'feat-fresh');

    expect(git(repo, 'rev-parse', 'feat/fresh').trim()).toBe(remoteMain);
    expect(git(repo, 'rev-parse', 'main').trim()).toBe(staleMain);
    expect(readFileSync(join(worktree, '.spin-base'), 'utf8').trim()).toBe(remoteMain);

    runSpin(repo, ['feat/fresh', '--clean']);
  });

  it('falls back to local main when origin/main cannot be fetched and none is cached', () => {
    const { root, repo } = makeRepo('studiq');
    git(repo, 'remote', 'add', 'origin', join(root, 'missing.git'));
    const localMain = git(repo, 'rev-parse', 'main').trim();

    const result = runSpinCaptured(repo, ['feat/offline']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('branching from local main');
    expect(result.stdout).toContain('Fetch failed:');
    const worktree = join(root, 'feat-offline');

    expect(git(repo, 'rev-parse', 'feat/offline').trim()).toBe(localMain);
    expect(readFileSync(join(worktree, '.spin-base'), 'utf8').trim()).toBe(localMain);

    runSpin(repo, ['feat/offline', '--clean']);
  });

  it('prefers the last fetched origin/main over local main when the fetch fails', () => {
    const { parent, repo, root } = makeRepo('studiq');
    const remote = join(parent, 'remote.git');
    git(parent, 'init', '-q', '--bare', '-b', 'main', remote);
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main');

    const clone = join(parent, 'clone');
    git(parent, 'clone', '-q', remote, clone);
    git(clone, 'commit', '-q', '--allow-empty', '-m', 'fetched ahead of local main');
    git(clone, 'push', '-q', 'origin', 'main');
    git(repo, 'fetch', '-q', 'origin', 'main');
    const cached = git(repo, 'rev-parse', 'origin/main').trim();

    // Warm cache, dead remote: prefer the cached ref over stale local main.
    git(repo, 'remote', 'set-url', 'origin', join(root, 'missing.git'));

    const result = runSpinCaptured(repo, ['feat/cached']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('using the last fetched origin/main');
    expect(git(repo, 'rev-parse', 'feat/cached').trim()).toBe(cached);
    expect(readFileSync(join(root, 'feat-cached', '.spin-base'), 'utf8').trim()).toBe(cached);

    runSpin(repo, ['feat/cached', '--clean']);
  });

  it('redacts credentials from a fetch failure', () => {
    const { parent, repo } = makeRepo('studiq');
    git(repo, 'remote', 'add', 'origin', 'https://user:secret@example.test/repo.git');
    const env = failingFetchEnv(
      parent,
      "fatal: unable to access 'https://user:secret@example.test/repo.git/': boom",
    );

    const result = runSpinCaptured(repo, ['feat/redacted'], env);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Fetch failed:');
    expect(result.stdout).not.toContain('secret');
    expect(result.stdout).toContain('https://***@example.test/repo.git/');

    runSpin(repo, ['feat/redacted', '--clean'], env);
  });
});
