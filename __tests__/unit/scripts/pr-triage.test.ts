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
  docLines: number;
  excludedLines: number;
  bucket: string;
  label: {
    name: string;
    color: string;
    description: string;
  };
  overLimit: boolean;
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

function isLabel(value: unknown): value is Output['label'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string' &&
    'color' in value &&
    typeof value.color === 'string' &&
    'description' in value &&
    typeof value.description === 'string'
  );
}

function isOutput(value: unknown): value is Output {
  return (
    typeof value === 'object' &&
    value !== null &&
    'total' in value &&
    typeof value.total === 'number' &&
    'testLines' in value &&
    typeof value.testLines === 'number' &&
    'docLines' in value &&
    typeof value.docLines === 'number' &&
    'excludedLines' in value &&
    typeof value.excludedLines === 'number' &&
    'bucket' in value &&
    typeof value.bucket === 'string' &&
    'label' in value &&
    isLabel(value.label) &&
    'overLimit' in value &&
    typeof value.overLimit === 'boolean'
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
    write(repo, 'docs/plans/feature.md', lines(20));
    commit(repo);

    const output = run(repo, ['--base', 'HEAD~1', '--json']);

    expect(output.total).toBe(20);
    expect(output.testLines).toBe(100);
    expect(output.docLines).toBe(20);
    expect(output.excludedLines).toBe(45);
    expect(output.bucket).toBe('S');
    expect(output.overLimit).toBe(false);
  });

  it('does not count a pure rename as churn', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/old.ts', lines(30));
    commit(repo, 'add old');
    renameSync(join(repo, 'apps/web/src/old.ts'), join(repo, 'apps/web/src/new.ts'));
    commit(repo, 'rename');

    expect(run(repo, ['--base', 'HEAD~1', '--json']).total).toBe(0);
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

  it('labels an over-budget PR XL even below the M boundary', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/feature.ts', lines(101));
    commit(repo);

    // 101 > 100, and 200 > 100: both are over budget, never M or L.
    expect(run(repo, ['--base', 'HEAD~1', '--limit', '100', '--json']).bucket).toBe('XL');
    expect(run(repo, ['--base', 'HEAD~1', '--limit', '100', '--json']).overLimit).toBe(true);

    write(repo, 'apps/web/src/more.ts', lines(99));
    commit(repo);
    const output = run(repo, ['--base', 'HEAD~2', '--limit', '100', '--json']);
    expect(output.total).toBe(200);
    expect(output.bucket).toBe('XL');
    expect(output.overLimit).toBe(true);
  });

  it('uses the default 400-line budget boundaries', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/feature.ts', lines(400));
    commit(repo);

    const atLimit = run(repo, ['--base', 'HEAD~1', '--json']);
    expect(atLimit.total).toBe(400);
    expect(atLimit.bucket).toBe('L');
    expect(atLimit.overLimit).toBe(false);

    write(repo, 'apps/web/src/more.ts', 'export const y1 = 1;\n');
    commit(repo);
    const overLimit = run(repo, ['--base', 'HEAD~2', '--json']);
    expect(overLimit.total).toBe(401);
    expect(overLimit.bucket).toBe('XL');
    expect(overLimit.overLimit).toBe(true);
  });

  it('reports label metadata for the bucket', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/tiny.ts', lines(5));
    commit(repo);

    const output = run(repo, ['--base', 'HEAD~1', '--json']);
    expect(output.bucket).toBe('XS');
    expect(output.label).toEqual({
      name: 'size/XS',
      color: '0e8a16',
      description: '10 or fewer reviewable lines',
    });

    write(repo, 'apps/web/src/big.ts', lines(200));
    commit(repo);
    const xl = run(repo, ['--base', 'HEAD~2', '--limit', '100', '--json']);
    expect(xl.label).toEqual({
      name: 'size/XL',
      color: 'b60205',
      description: 'Over the 100-line review budget',
    });
  });

  it('exits 2 when a flag is present without a value', () => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/feature.ts', lines(3));
    commit(repo);

    expect(runStatus(repo, ['--base'])).toBe(2);
    expect(runStatus(repo, ['--base', 'HEAD~1', '--limit'])).toBe(2);
    expect(runStatus(repo, ['--base', 'HEAD~1', '--limit', '--json'])).toBe(2);
  });

  it.each(['abc', '10abc', '1.5', '0', '-1'])('exits 2 for --limit %s', (limit) => {
    const repo = makeRepo();
    write(repo, 'apps/web/src/feature.ts', lines(3));
    commit(repo);

    expect(runStatus(repo, ['--base', 'HEAD~1', '--limit', limit])).toBe(2);
  });
});
