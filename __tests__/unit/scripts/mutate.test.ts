/**
 * The mutation gate's own proof: the harness must go red on the shapes that
 * made six hand-rolled harnesses in the ADR-0014 arc worthless. Each test
 * drives the real script against a throwaway git repo with a real vitest run,
 * so `git checkout --`, the JSON reporter and the exit codes are all exercised,
 * not mocked.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/mutate.ts', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TMP = join(REPO, '.tmp');

const GUARD = `export function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 100) throw new RangeError('clamp: value above the maximum');
  return value;
}
`;

const TEST = `import { describe, expect, it } from 'vitest';
import { clamp } from '@fixture/guard';

describe('clamp', () => {
  it('clamps a negative value to zero', () => {
    expect(clamp(-5)).toBe(0);
  });

  it('rejects a value above the maximum', () => {
    expect(() => clamp(101)).toThrow(RangeError);
  });
});
`;

/**
 * The subject is a separate module from the test so the mutation lands in
 * production code, and the specifier is aliased so this file contains no
 * relative import for `check-import-paths.ts` to flag.
 */
const CONFIG = `import { defineConfig } from 'vitest/config';
import { join } from 'node:path';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@fixture': join(process.cwd(), 'src') } },
});
`;

const KILL: string[] = [
  '--file',
  'src/guard.ts',
  '--find',
  'if (value < 0) return 0;',
  '--replace',
  'if (value < -10) return 0;',
  '--test',
  'src/guard.test.ts',
  '--name',
  'clamps a negative value to zero',
];

// Curated, never inherited: a parent VITEST/GIT_DIR would leak into the child
// vitest run or redirect the fixture's git commands at this checkout.
const ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME ?? '/tmp',
  LANG: process.env.LANG,
  LC_ALL: process.env.LC_ALL,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'mutate-test',
  GIT_AUTHOR_EMAIL: 'mutate-test@example.com',
  GIT_COMMITTER_NAME: 'mutate-test',
  GIT_COMMITTER_EMAIL: 'mutate-test@example.com',
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function fixture(): string {
  mkdirSync(TMP, { recursive: true });
  const root = mkdtempSync(join(TMP, 'mutate-'));
  dirs.push(root);
  write(root, 'vitest.config.ts', CONFIG);
  // Vite writes its dependency cache into the fixture's node_modules.
  write(root, '.gitignore', 'node_modules/\n');
  write(root, 'src/guard.ts', GUARD);
  write(root, 'src/guard.test.ts', TEST);
  execFileSync('git', ['init', '-q'], { cwd: root, env: ENV });
  execFileSync('git', ['add', '-A'], { cwd: root, env: ENV });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root, env: ENV });
  return root;
}

interface Result {
  status: number;
  out: string;
  err: string;
}

function mutate(root: string, args: string[]): Result {
  const result = spawnSync('bun', [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env: ENV });
  return { status: result.status ?? -1, out: result.stdout, err: result.stderr };
}

interface Line {
  file: string;
  find: string;
  test: string;
  title: string;
  outcome: 'KILLED' | 'SURVIVED' | 'ERROR';
  executed: number;
  detail: string;
}

function isLine(value: unknown): value is Line {
  if (typeof value !== 'object' || value === null) return false;
  if (!('file' in value) || typeof value.file !== 'string') return false;
  if (!('find' in value) || typeof value.find !== 'string') return false;
  if (!('test' in value) || typeof value.test !== 'string') return false;
  if (!('title' in value) || typeof value.title !== 'string') return false;
  if (!('executed' in value) || typeof value.executed !== 'number') return false;
  if (!('detail' in value) || typeof value.detail !== 'string') return false;
  if (!('outcome' in value)) return false;
  return value.outcome === 'KILLED' || value.outcome === 'SURVIVED' || value.outcome === 'ERROR';
}

/** Pins the NDJSON contract a PR body quotes: seven keys, `outcome` in the vocabulary. */
function lines(out: string): Line[] {
  return out
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isLine(parsed)) throw new Error(`not a mutation line: ${line}`);
      return parsed;
    });
}

function gitStatus(root: string): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', env: ENV });
}

describe('scripts/mutate.ts', () => {
  it('refuses to start on a dirty tree and mutates nothing', () => {
    const root = fixture();
    write(root, 'stray.txt', 'uncommitted\n');

    const result = mutate(root, KILL);

    expect(result.status).toBe(2);
    expect(result.err).toMatch(/worktree is not clean/);
    expect(result.out).toBe('');
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toBe(GUARD);
  }, 60_000);

  it('rejects a --find that matches zero times', () => {
    const root = fixture();
    const args = [...KILL];
    args[args.indexOf('--find') + 1] = 'if (value < -999) return 0;';

    const result = mutate(root, args);

    expect(result.status).toBe(2);
    expect(result.err).toMatch(/matched 0 times/);
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toBe(GUARD);
  }, 60_000);

  it('rejects an ambiguous --find without --all', () => {
    const root = fixture();
    const args = [...KILL];
    args[args.indexOf('--find') + 1] = 'return';

    const result = mutate(root, args);

    expect(result.status).toBe(2);
    expect(result.err).toMatch(/matched 2 times/);
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toBe(GUARD);
  }, 60_000);

  it('classifies a --name that matches nothing as ERROR with a non-zero exit', () => {
    // vitest exits 0 and reports the test as skipped here. Reading that as
    // "mutant survived" is the defect this tool exists to prevent, and a
    // freshly written (or mistyped) title is the first thing an author types.
    const root = fixture();
    const args = [...KILL];
    args[args.indexOf('--name') + 1] = 'clamps a negative value to zreo';

    const result = mutate(root, [...args, '--json']);

    expect(result.status).not.toBe(0);
    const [line] = lines(result.out);
    expect(line?.outcome).toBe('ERROR');
    expect(line?.executed).toBe(0);
    expect(line?.detail).toMatch(/no test matched/);
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toBe(GUARD);
  }, 60_000);

  it('kills the mutant the named test claims to catch and reverts the tree', () => {
    const root = fixture();

    const result = mutate(root, [...KILL, '--json']);

    expect(result.status).toBe(0);
    const [line] = lines(result.out);
    expect(line).toMatchObject({
      file: 'src/guard.ts',
      find: 'if (value < 0) return 0;',
      test: 'src/guard.test.ts',
      title: 'clamps a negative value to zero',
      outcome: 'KILLED',
      executed: 1,
    });
    expect(line?.detail).toMatch(/expected -5 to be \+0/);
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toBe(GUARD);
    expect(gitStatus(root)).toBe('');
  }, 60_000);

  it('reports a mutant the named test does not notice as SURVIVED', () => {
    const root = fixture();

    const result = mutate(root, [
      '--file',
      'src/guard.ts',
      '--find',
      'clamp: value above the maximum',
      '--replace',
      'clamp: out of range',
      '--test',
      'src/guard.test.ts',
      '--name',
      'rejects a value above the maximum',
      '--json',
    ]);

    expect(result.status).toBe(0);
    const [line] = lines(result.out);
    expect(line?.outcome).toBe('SURVIVED');
    expect(line?.executed).toBe(1);
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toBe(GUARD);
  }, 60_000);

  it('runs a spec table and emits one NDJSON line per mutation', () => {
    const root = fixture();
    const specDir = mkdtempSync(join(TMP, 'mutate-spec-'));
    dirs.push(specDir);
    const spec = join(specDir, 'mutations.json');
    writeFileSync(
      spec,
      JSON.stringify([
        {
          file: 'src/guard.ts',
          find: 'if (value < 0) return 0;',
          replace: 'if (value < -10) return 0;',
          test: 'src/guard.test.ts',
          name: 'clamps a negative value to zero',
        },
        {
          file: 'src/guard.ts',
          find: 'clamp: value above the maximum',
          replace: 'clamp: out of range',
          test: 'src/guard.test.ts',
          name: 'rejects a value above the maximum',
        },
      ]),
    );

    const result = mutate(root, ['--spec', spec, '--json']);

    expect(result.status).toBe(0);
    expect(lines(result.out).map((line) => line.outcome)).toEqual(['KILLED', 'SURVIVED']);
    expect(gitStatus(root)).toBe('');
  }, 90_000);

  it('refuses to mutate a test file', () => {
    const root = fixture();

    const result = mutate(root, [
      '--file',
      'src/guard.test.ts',
      '--find',
      'expect(clamp(-5)).toBe(0);',
      '--replace',
      '',
      '--test',
      'src/guard.test.ts',
      '--name',
      'clamps a negative value to zero',
    ]);

    expect(result.status).toBe(2);
    expect(result.err).toMatch(/refusing to mutate the test file/);
    expect(readFileSync(join(root, 'src/guard.test.ts'), 'utf8')).toBe(TEST);
  }, 60_000);
});
