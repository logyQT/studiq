import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const PR_SCRIPT = fileURLToPath(new URL('../../../scripts/pr', import.meta.url));
const PR_URL = 'https://example.test/pull/1';
const OPEN_PR_URL = 'https://example.test/pull/7';

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
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: TEST_ENV }).trim();
}

// A fake gh that never contacts GitHub. It records the exact argv of each call.
// At `pr create` it also records what origin holds at that moment and the body
// it was given, so a test can prove what GitHub would have received.
const FAKE_GH = `#!/usr/bin/env bash
(IFS=$'\\x1f'; printf '%s\\n' "$*") >> "$GH_DIR/calls"
case "$1 $2" in
  "pr list")
    [ -z "\${GH_LIST_FAILS:-}" ] || exit 1
    [ -z "\${GH_OPEN_PR:-}" ] || printf '%s\\n' "$GH_OPEN_PR" ;;
  "pr create")
    git ls-remote origin "refs/heads/$(git branch --show-current)" | cut -f1 > "$GH_DIR/origin-at-create"
    while [ $# -gt 0 ]; do
      [ "$1" != "--body-file" ] || cat -- "$2" > "$GH_DIR/body"
      shift
    done
    printf '%s\\n' "${PR_URL}" ;;
esac
exit 0
`;

function commit(repo: string, message: string): void {
  git(repo, 'commit', '-q', '--allow-empty', '-m', message);
}

/** The `gh pr create` calls among all gh calls. */
const created = (calls: string[][]) => calls.filter(([a, b]) => a === 'pr' && b === 'create');

describe('scripts/pr', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A checkout on `feat/child`, one commit ahead of an origin it can push to. */
  function setup() {
    const parent = mkdtempSync(join(tmpdir(), 'pr-test-'));
    tempDirs.push(parent);
    const repo = join(parent, 'studiq');
    const remote = join(parent, 'remote.git');
    const bin = join(parent, 'bin');
    const ghDir = join(parent, 'gh');
    for (const dir of [repo, bin, ghDir]) mkdirSync(dir);
    git(parent, 'init', '-q', '--bare', '-b', 'main', remote);
    git(repo, 'init', '-q', '-b', 'main');
    commit(repo, 'init');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'checkout', '-q', '-b', 'feat/child');
    commit(repo, 'feat: child work');
    writeFileSync(join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = {
      ...TEST_ENV,
      PATH: `${bin}:${TEST_ENV.PATH ?? ''}`,
      GH_DIR: ghDir,
    };

    const read = (name: string) =>
      existsSync(join(ghDir, name)) ? readFileSync(join(ghDir, name), 'utf8') : '';

    return {
      parent,
      repo,
      remote,
      env,
      read,
      /** Every gh invocation, as argv arrays. */
      calls: () =>
        read('calls')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('\x1f')),
      run: (
        args: string[],
        options: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string } = {},
      ) =>
        spawnSync('bash', [PR_SCRIPT, ...args], {
          cwd: options.cwd ?? repo,
          input: options.input,
          encoding: 'utf8',
          env: { ...env, ...options.env },
        }),
      /** The commit origin has for a branch; empty when it has no such branch. */
      onOrigin: (branch: string) =>
        git(repo, 'ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0] ?? '',
    };
  }

  it('creates the PR against main with gh --fill and prints only its URL', () => {
    const t = setup();

    const result = t.run([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${PR_URL}\n`);
    // The whole conversation with gh: no label calls and no PR edits.
    expect(t.calls()).toEqual([
      ['auth', 'status'],
      [
        'pr',
        'list',
        '--head',
        'feat/child',
        '--state',
        'open',
        '--json',
        'url',
        '-q',
        '.[0].url // empty',
      ],
      ['pr', 'create', '--base', 'main', '--head', 'feat/child', '--fill'],
    ]);
  });

  it('passes the title, --body-file, --base and --draft to gh', () => {
    const t = setup();
    git(t.repo, 'push', '-q', 'origin', 'main:feat/parent');
    // A relative path has to keep its meaning when run from a subdirectory.
    const sub = join(t.repo, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, 'body.md'), 'Line one\nLine two\n');

    const result = t.run(
      ['fix: a title', '--body-file', 'body.md', '--base', 'feat/parent', '--draft'],
      { cwd: sub },
    );

    expect(result.status).toBe(0);
    expect(created(t.calls())).toEqual([
      [
        'pr',
        'create',
        '--base',
        'feat/parent',
        '--head',
        'feat/child',
        '--fill',
        '--title',
        'fix: a title',
        '--body-file',
        'body.md',
        '--draft',
      ],
    ]);
    expect(t.read('body')).toBe('Line one\nLine two\n');
  });

  it('accepts -d for a draft', () => {
    const t = setup();

    expect(t.run(['-d']).status).toBe(0);
    expect(created(t.calls())[0]?.at(-1)).toBe('--draft');
  });

  it('hands a body on stdin to gh, untouched by the push', () => {
    const t = setup();

    const result = t.run(['--body-file', '-'], { input: 'From stdin\n' });

    expect(result.status).toBe(0);
    expect(t.read('body')).toBe('From stdin\n');
  });

  it.each([
    ['is not there', 'missing.md'],
    ['is a directory', '.'],
  ])('refuses a body file that %s, before it pushes', (_label, file) => {
    const t = setup();

    const result = t.run(['--body-file', file]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Cannot read body file '${file}'`);
    expect(created(t.calls())).toEqual([]);
    expect(t.onOrigin('feat/child')).toBe('');
  });

  it('pushes before it creates the PR, also when origin has an older branch', () => {
    const t = setup();
    git(t.repo, 'push', '-q', 'origin', 'feat/child');
    commit(t.repo, 'feat: not pushed yet');

    const result = t.run([]);

    expect(result.status).toBe(0);
    expect(t.read('origin-at-create').trim()).toBe(git(t.repo, 'rev-parse', 'HEAD'));
    expect(git(t.repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feat/child');
  });

  it('pushes, then prints the URL of an open PR and creates no second one', () => {
    const t = setup();

    const result = t.run(['a new title'], { env: { GH_OPEN_PR: OPEN_PR_URL } });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${OPEN_PR_URL}\n`);
    expect(result.stderr).toContain('It is not changed.');
    expect(created(t.calls())).toEqual([]);
    expect(t.onOrigin('feat/child')).toBe(git(t.repo, 'rev-parse', 'HEAD'));
  });

  it('shows why a push failed and creates no PR', () => {
    const t = setup();
    writeFileSync(
      join(t.remote, 'hooks', 'pre-receive'),
      '#!/bin/sh\necho "refused by the test remote" >&2\nexit 1\n',
      { mode: 0o755 },
    );

    const result = t.run([]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('refused by the test remote');
    expect(result.stderr).toContain("Could not push 'feat/child'. No pull request was created.");
    expect(t.calls()).toEqual([['auth', 'status']]);
  });

  it('does not force a push over commits that only origin has', () => {
    const t = setup();
    commit(t.repo, 'feat: only on origin');
    git(t.repo, 'push', '-q', 'origin', 'feat/child');
    const theirs = t.onOrigin('feat/child');
    git(t.repo, 'reset', '-q', '--hard', 'HEAD~1');

    const result = t.run([]);

    expect(result.status).not.toBe(0);
    expect(t.onOrigin('feat/child')).toBe(theirs);
    expect(created(t.calls())).toEqual([]);
  });

  it('creates nothing when it cannot look for an open PR', () => {
    const t = setup();

    const result = t.run([], { env: { GH_LIST_FAILS: '1' } });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Could not check for an existing pull request');
    expect(created(t.calls())).toEqual([]);
  });

  // `--list` and `--view` are gone. An unknown word with a dash must never become a title.
  it.each(['--list', '-l', '--view', '-v', '--nope', '--base=main', '-x', '--'])(
    'refuses %s with no side effect',
    (flag) => {
      const t = setup();

      const result = t.run([flag]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Unknown option '${flag}'`);
      expect(t.calls()).toEqual([]);
      expect(t.onOrigin('feat/child')).toBe('');
    },
  );

  it('refuses a second title, so an unquoted one cannot lose words', () => {
    const t = setup();

    const result = t.run(['fix:', 'login']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Give one title only');
    expect(t.calls()).toEqual([]);
  });

  it('refuses to run on main, so it never pushes local commits to it', () => {
    const t = setup();
    git(t.repo, 'checkout', '-q', 'main');
    commit(t.repo, 'chore: local commit on main');
    const before = t.onOrigin('main');

    // Also with another base, which is the case the base comparison does not cover.
    git(t.repo, 'push', '-q', 'origin', 'feat/child');
    for (const args of [[], ['--base', 'feat/child']]) {
      const result = t.run(args);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("You are on 'main'");
    }
    expect(t.onOrigin('main')).toBe(before);
    expect(created(t.calls())).toEqual([]);
  });

  it('refuses a branch that is its own base, before it pushes', () => {
    const t = setup();
    git(t.repo, 'push', '-q', 'origin', 'feat/child');
    const before = t.onOrigin('feat/child');
    commit(t.repo, 'feat: local only');

    const result = t.run(['--base', 'feat/child']);

    expect(result.status).not.toBe(0);
    expect(t.onOrigin('feat/child')).toBe(before);
  });

  it('describes its options in --help without calling gh', () => {
    const t = setup();

    const help = t.run(['--help']);

    expect(help.status).toBe(0);
    for (const text of ['--base <branch>', 'default: main', '--body-file <file>', '--draft']) {
      expect(help.stdout).toContain(text);
    }
    expect(help.stdout).not.toMatch(/--list|--view/);
    expect(t.calls()).toEqual([]);
  });

  it('accepts a base branch that only exists on origin', () => {
    const t = setup();
    git(t.repo, 'push', '-q', 'origin', 'main:feat/remote-base');

    const result = t.run(['--base', 'feat/remote-base']);

    expect(result.status).toBe(0);
    expect(created(t.calls())[0]).toContain('feat/remote-base');
  });

  it.each([
    ['unknown', 'feat/nope', () => undefined],
    // gh resolves the base on origin, so a branch on this machine does not count.
    ['local-only', 'feat/local-base', (repo: string) => git(repo, 'branch', 'feat/local-base')],
  ])('refuses an %s base before it creates or pushes anything', (_label, base, arrange) => {
    const t = setup();
    arrange(t.repo);

    const result = t.run(['--base', base]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Base branch '${base}' is not on origin`);
    expect(result.stderr).toContain(`git push -u origin '${base}'`);
    expect(created(t.calls())).toEqual([]);
    expect(t.onOrigin('feat/child')).toBe('');
  });

  it.each([
    [['--base'], '--base requires a branch name'],
    [['--base', ''], '--base requires a branch name'],
    [['--body-file'], '--body-file requires a file'],
    [['--body-file', ''], '--body-file requires a file'],
  ])('refuses %j', (args, message) => {
    const t = setup();

    const result = t.run(args);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(t.calls()).toEqual([]);
  });
});
