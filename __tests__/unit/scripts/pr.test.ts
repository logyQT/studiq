import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const PR_SCRIPT = fileURLToPath(new URL('../../../scripts/pr', import.meta.url));

// Never inherit the harness git context: GIT_DIR/GIT_WORK_TREE from a hook would
// redirect every git call at the real checkout instead of the temp repo.
const TEST_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME ?? tmpdir(),
  LANG: process.env.LANG,
  LC_ALL: process.env.LC_ALL,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'pr-test',
  GIT_AUTHOR_EMAIL: 'pr-test@example.com',
  GIT_COMMITTER_NAME: 'pr-test',
  GIT_COMMITTER_EMAIL: 'pr-test@example.com',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: TEST_ENV });
}

// A fake gh that records every invocation and answers the calls scripts/pr
// makes: auth check, no existing PR, a created PR URL. It never contacts
// GitHub, so a test can prove what would have been sent.
function fakeGhEnv(parent: string): { env: NodeJS.ProcessEnv; callsFile: string } {
  const bin = join(parent, 'bin');
  mkdirSync(bin, { recursive: true });
  const callsFile = join(parent, 'gh-calls.log');
  writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_CALLS"
case "$*" in
  "auth status") exit 0 ;;
  pr\\ create*) printf '%s\\n' "https://example.test/pull/1"; exit 0 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  // Triage would shell out to bun + TypeScript for a size label this test does
  // not exercise; a failing stub keeps the run fast and the label empty.
  writeFileSync(join(bin, 'bun'), '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });
  return {
    env: { ...TEST_ENV, PATH: `${bin}:${TEST_ENV.PATH ?? ''}`, GH_CALLS: callsFile },
    callsFile,
  };
}

function runPr(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  return spawnSync('bash', [PR_SCRIPT, ...args], { cwd, encoding: 'utf8', env });
}

function createCalls(callsFile: string): string[] {
  if (!existsSync(callsFile)) return [];
  return readFileSync(callsFile, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('pr create'));
}

function commit(repo: string, message: string): void {
  git(repo, 'commit', '-q', '--allow-empty', '-m', message);
}

describe('scripts/pr', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // A repo with an origin it can push to, so the "branch already pushed" path
  // runs and a refused base can be proven not to have pushed anything.
  function makeRepo(): { parent: string; repo: string } {
    const parent = mkdtempSync(join(tmpdir(), 'pr-test-'));
    tempDirs.push(parent);
    const repo = join(parent, 'studiq');
    const remote = join(parent, 'remote.git');
    mkdirSync(repo);
    git(parent, 'init', '-q', '--bare', '-b', 'main', remote);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main');
    return { parent, repo };
  }

  it('targets main by default and describes --base in --help', () => {
    const { parent, repo } = makeRepo();
    const { env, callsFile } = fakeGhEnv(parent);
    git(repo, 'checkout', '-q', '-b', 'feat/child');
    commit(repo, 'feat: child work');
    git(repo, 'push', '-q', '-u', 'origin', 'feat/child');

    const result = runPr(repo, ['chore: explicit title'], env);

    expect(result.status).toBe(0);
    expect(createCalls(callsFile)).toHaveLength(1);
    expect(createCalls(callsFile)[0]).toMatch(
      /^pr create --base main --head feat\/child --title chore: explicit title/,
    );

    const help = runPr(repo, ['--help'], env);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--base <branch>');
    expect(help.stdout).toContain('default: main');
  });

  it('passes --base through to gh and computes the PR body against it', () => {
    const { parent, repo } = makeRepo();
    const { env, callsFile } = fakeGhEnv(parent);
    git(repo, 'checkout', '-q', '-b', 'feat/parent');
    commit(repo, 'feat: parent work');
    git(repo, 'checkout', '-q', '-b', 'feat/child');
    commit(repo, 'feat: child work');
    git(repo, 'push', '-q', '-u', 'origin', 'feat/child');

    const result = runPr(repo, ['--base', 'feat/parent'], env);

    expect(result.status).toBe(0);
    const [call] = createCalls(callsFile);
    expect(call).toMatch(/^pr create --base feat\/parent --head feat\/child /);
    // The body is the commit range since the base; the parent's commit would
    // appear if --base were ignored.
    expect(call).toContain('feat: child work');
    expect(call).not.toContain('feat: parent work');
  });

  it('accepts a base branch that only exists on origin', () => {
    const { parent, repo } = makeRepo();
    const { env, callsFile } = fakeGhEnv(parent);
    git(repo, 'checkout', '-q', '-b', 'feat/remote-base');
    commit(repo, 'feat: remote base work');
    git(repo, 'push', '-q', 'origin', 'feat/remote-base');
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'branch', '-q', '-D', 'feat/remote-base');
    git(repo, 'checkout', '-q', '-b', 'feat/child');
    commit(repo, 'feat: child work');
    git(repo, 'push', '-q', '-u', 'origin', 'feat/child');

    const result = runPr(repo, ['--base', 'feat/remote-base'], env);

    expect(result.status).toBe(0);
    expect(createCalls(callsFile)[0]).toMatch(/^pr create --base feat\/remote-base /);
  });

  it('refuses an unknown base before creating or pushing anything', () => {
    const { parent, repo } = makeRepo();
    const { env, callsFile } = fakeGhEnv(parent);
    git(repo, 'checkout', '-q', '-b', 'feat/child');
    commit(repo, 'feat: child work');

    const result = runPr(repo, ['--base', 'feat/nope'], env);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Base branch 'feat/nope' does not exist");
    expect(createCalls(callsFile)).toHaveLength(0);
    // Validation runs before the push, so a mistyped base cannot publish the branch.
    expect(() => git(repo, 'ls-remote', '--exit-code', 'origin', 'feat/child')).toThrow();
  });

  it('refuses --base without a branch name', () => {
    const { parent, repo } = makeRepo();
    const { env, callsFile } = fakeGhEnv(parent);

    const result = runPr(repo, ['--base'], env);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--base requires a branch name');
    expect(createCalls(callsFile)).toHaveLength(0);
  });
});
