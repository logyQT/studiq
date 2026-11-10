import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/pr-triage.ts', import.meta.url));

// Never inherit the harness git context: GIT_DIR/GIT_WORK_TREE would redirect
// the fixture commits at the real checkout.
const TEST_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME ?? tmpdir(),
  LANG: process.env.LANG,
  LC_ALL: process.env.LC_ALL,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'pr-triage-test',
  GIT_AUTHOR_EMAIL: 'pr-triage-test@example.com',
  GIT_COMMITTER_NAME: 'pr-triage-test',
  GIT_COMMITTER_EMAIL: 'pr-triage-test@example.com',
};

interface Output {
  total: number;
  testLines: number;
  excludedLines: number;
  bucket: string;
  overLimit: boolean;
  sensitive: boolean;
  deepReview: boolean;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: TEST_ENV });
}

function lines(count: number, prefix = 'export const x'): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index} = ${index};\n`).join('');
}

function write(repo: string, path: string, content: string): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commit(repo: string, message = 'change'): void {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', message);
}

function isOutput(value: unknown): value is Output {
  return (
    typeof value === 'object' &&
    value !== null &&
    'total' in value &&
    typeof value.total === 'number' &&
    'testLines' in value &&
    typeof value.testLines === 'number' &&
    'excludedLines' in value &&
    typeof value.excludedLines === 'number' &&
    'bucket' in value &&
    typeof value.bucket === 'string' &&
    'overLimit' in value &&
    typeof value.overLimit === 'boolean' &&
    'sensitive' in value &&
    typeof value.sensitive === 'boolean' &&
    'deepReview' in value &&
    typeof value.deepReview === 'boolean'
  );
}

function run(repo: string, args: string[]): Output {
  const stdout = execFileSync('bun', [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: TEST_ENV,
  });
  const parsed: unknown = JSON.parse(stdout);
  if (!isOutput(parsed)) throw new Error(`Unexpected pr-triage output: ${stdout}`);
  return parsed;
}

function runStatus(repo: string, args: string[]): number | null {
  try {
    execFileSync('bun', [SCRIPT, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: TEST_ENV,
      stdio: 'pipe',
    });
    return 0;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const status = (error as { status?: unknown }).status;
      return typeof status === 'number' ? status : null;
    }
    return null;
  }
}

describe('scripts/pr-triage', () => {
  const repos: string[] = [];

  afterEach(() => {
    for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
  });

  function makeRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'pr-triage-test-'));
    repos.push(repo);
    git(repo, 'init', '-q', '-b', 'main');
    write(repo, 'README.md', '# fixture\n');
    commit(repo, 'init');
    return repo;
  }

  it('excludes tests, generated files and vendored skills from the budget', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/feature.ts', lines(20));
    write(repo, '__tests__/unit/feature.test.ts', lines(100));
    write(repo, 'bun.lock', lines(10));
    write(repo, 'packages/server/src/types/database.ts', lines(30));
    write(repo, '.agents/skills/example/SKILL.md', lines(5));
    commit(repo);

    const output = run(repo, ['--base', 'HEAD~1', '--json']);

    expect(output.total).toBe(20);
    expect(output.testLines).toBe(100);
    expect(output.excludedLines).toBe(45);
    expect(output.bucket).toBe('S');
    expect(output.overLimit).toBe(false);
    expect(output.deepReview).toBe(false);
  });

  it('does not count a pure rename as churn', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/old.ts', lines(30));
    commit(repo, 'add old');
    renameSync(join(repo, 'apps/web/src/old.ts'), join(repo, 'apps/web/src/new.ts'));
    commit(repo, 'rename');

    expect(run(repo, ['--base', 'HEAD~1', '--json']).total).toBe(0);
  });

  it('requests a deep review for a small PR touching a sensitive path', () => {
    const repo = makeRepo();
    write(repo, 'supabase/migrations/20260101000000_t.sql', 'create table x (id int);\n');
    commit(repo);

    const output = run(repo, ['--base', 'HEAD~1', '--json']);

    expect(output.total).toBe(1);
    expect(output.sensitive).toBe(true);
    expect(output.deepReview).toBe(true);
  });

  it('only fails an over-budget PR when --enforce is passed', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/feature.ts', lines(11));
    commit(repo);

    expect(run(repo, ['--base', 'HEAD~1', '--json', '--limit', '10']).overLimit).toBe(true);
    expect(runStatus(repo, ['--base', 'HEAD~1', '--limit', '10'])).toBe(0);
    expect(runStatus(repo, ['--base', 'HEAD~1', '--limit', '10', '--enforce'])).toBe(1);
  });

  it('exits 2 when the base ref does not exist', () => {
    const repo = makeRepo();
    expect(runStatus(repo, ['--base', 'does-not-exist'])).toBe(2);
  });
});
