/**
 * The mutation gate's own proof: the harness must go red on the shapes that
 * made six hand-rolled harnesses in the ADR-0014 arc worthless. Each test
 * drives the real script against a throwaway git repo with a real vitest run,
 * so `git checkout --`, the JSON reporter and the exit codes are all exercised,
 * not mocked.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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

/** A test that sabotages the revert once the mutation is in place. */
const SABOTAGE = `import { chmodSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('sabotage', () => {
  it('sabotages the revert', () => {
    // A read-only directory makes git's unlink fail: the one deterministic way
    // to force \`git checkout --\` to fail from inside the test run.
    if (readFileSync(join(here, 'guard.ts'), 'utf8').includes('value < -10')) {
      chmodSync(join(here, 'guard.ts'), 0o444);
      chmodSync(here, 0o555);
    }
    expect(1 + 1).toBe(2);
  });
});
`;

/** A test that fails on every run after the first, i.e. a flake. */
const FLAKY = `import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Outside the checkout, so the marker cannot make the tree dirty; unique per
// fixture, so parallel runs cannot see each other's.
const here = dirname(fileURLToPath(import.meta.url));
const marker = join(tmpdir(), \`studiq-flaky-\${basename(join(here, '..'))}\`);

describe('flaky', () => {
  it('fails on its second run', () => {
    if (existsSync(marker)) throw new Error('flaky: this run is not the first');
    writeFileSync(marker, 'ran');
    expect(1 + 1).toBe(2);
  });
});
`;

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

/** The sabotage test leaves a read-only directory behind; make it removable. */
function unlock(dir: string): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) unlock(join(dir, entry.name));
    }
    chmodSync(dir, 0o755);
  } catch {
    // Best effort: the directory may already be gone.
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    unlock(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function write(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, env: ENV });
}

function commit(root: string, message = 'fixture'): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', message);
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
  git(root, 'init', '-q');
  commit(root);
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

/** Pins the NDJSON contract a PR body quotes: seven keys, `outcome` in the vocabulary. */
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

/**
 * Every stdout line in `--json` mode is one NDJSON record — progress belongs on
 * stderr. A line that is not JSON throws here rather than being filtered out.
 */
function lines(out: string): Line[] {
  return out
    .split('\n')
    .filter((line) => line !== '')
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
  it('prints usage for --help without touching the tree', () => {
    const root = fixture();

    const result = mutate(root, ['--help']);

    expect(result.status).toBe(0);
    expect(result.out).toMatch(/bun scripts\/mutate\.ts --file/);
    expect(gitStatus(root)).toBe('');
  }, 60_000);

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
    // stdout is NDJSON only; progress (including the revert line) is on stderr.
    expect(result.out.trim().split('\n')).toHaveLength(1);
    expect(result.err).toMatch(/\[1\/1\] src\/guard\.ts/);
    expect(result.err).toMatch(/1 mutation\(s\): 1 KILLED, 0 SURVIVED, 0 ERROR/);
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toBe(GUARD);
    expect(gitStatus(root)).toBe('');
    expect(
      spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'src/guard.ts'], { cwd: root, env: ENV })
        .status,
    ).toBe(0);
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

  it('runs a spec table and continues past a row that comes back ERROR', () => {
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
          name: 'clamps a negative value to zreo',
        },
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

    // A table's value is the whole table: the bad first row does not hide the
    // other two. The ERROR still decides the exit code.
    expect(result.status).toBe(1);
    expect(lines(result.out).map((line) => line.outcome)).toEqual(['ERROR', 'KILLED', 'SURVIVED']);
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

  it('refuses a file git cannot revert, before mutating it', () => {
    // An ignored file has no pre-image, and `git status` cannot even see it
    // afterwards — mutating it would leave the mutation in place silently.
    const root = fixture();
    write(root, '.gitignore', 'node_modules/\nsrc/ignored/\n');
    commit(root, 'ignore src/ignored');
    write(root, 'src/ignored/probe.ts', GUARD);

    const result = mutate(root, [
      ...KILL,
      '--file',
      'src/ignored/probe.ts',
      '--test',
      'src/guard.test.ts',
    ]);

    expect(result.status).toBe(2);
    expect(result.err).toMatch(/not tracked by git/);
    expect(readFileSync(join(root, 'src/ignored/probe.ts'), 'utf8')).toBe(GUARD);
    expect(gitStatus(root)).toBe('');
  }, 60_000);

  it('refuses a path outside the worktree', () => {
    // The sibling's name extends the checkout's name, which is what made the
    // old `slice(CWD.length + 1)` read it as an inside path.
    const root = fixture();
    const sibling = `${root}-probe`;
    dirs.push(sibling);
    write(sibling, 'guard.ts', GUARD);

    const result = mutate(root, [
      ...KILL,
      '--file',
      join(sibling, 'guard.ts'),
      '--test',
      'src/guard.test.ts',
    ]);

    expect(result.status).toBe(2);
    expect(result.err).toMatch(/' is outside the worktree/);
    expect(readFileSync(join(sibling, 'guard.ts'), 'utf8')).toBe(GUARD);
    expect(gitStatus(root)).toBe('');
  }, 60_000);

  it('refuses a path whose symlink resolves outside the worktree', () => {
    const root = fixture();
    // The target is throwaway: if the real-path check regresses, this test
    // mutates .tmp instead of a real source file.
    const target = join(TMP, `escape-${basename(root)}.ts`);
    dirs.push(target);
    writeFileSync(target, GUARD);
    symlinkSync(target, join(root, 'src', 'escape.ts'));
    commit(root, 'track the escape symlink');

    const result = mutate(root, [...KILL, '--file', 'src/escape.ts']);

    expect(result.status).toBe(2);
    expect(result.err).toMatch(/resolves outside the worktree/);
    expect(readFileSync(target, 'utf8')).toBe(GUARD);
  }, 60_000);

  it('surfaces a failed git checkout as REVERT FAILED, never as clean', () => {
    const root = fixture();
    write(root, 'src/sabotage.test.ts', SABOTAGE);
    commit(root, 'add the sabotage test');

    const result = mutate(root, [
      '--file',
      'src/guard.ts',
      '--find',
      'if (value < 0) return 0;',
      '--replace',
      'if (value < -10) return 0;',
      '--test',
      'src/sabotage.test.ts',
      '--name',
      'sabotages the revert',
      '--json',
    ]);

    expect(result.status).not.toBe(0);
    const [line] = lines(result.out);
    expect(line?.outcome).toBe('ERROR');
    expect(line?.detail).toMatch(/REVERT FAILED/);
    expect(result.err).toMatch(/REVERT FAILED/);
    // The mutation is still on disk: the report must not claim otherwise.
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toContain('value < -10');
  }, 60_000);

  it('treats a test that is red without the mutation as a flake, not a kill', () => {
    const root = fixture();
    write(root, 'src/flaky.test.ts', FLAKY);
    commit(root, 'add the flaky test');
    const marker = join(tmpdir(), `studiq-flaky-${basename(root)}`);
    rmSync(marker, { force: true });
    dirs.push(marker);

    const result = mutate(root, [
      '--file',
      'src/guard.ts',
      '--find',
      'if (value < 0) return 0;',
      '--replace',
      'if (value < -10) return 0;',
      '--test',
      'src/flaky.test.ts',
      '--name',
      'fails on its second run',
      '--json',
    ]);

    expect(result.status).not.toBe(0);
    const [line] = lines(result.out);
    expect(line?.outcome).toBe('ERROR');
    expect(line?.detail).toMatch(/flake suspected/);
    expect(readFileSync(join(root, 'src/guard.ts'), 'utf8')).toBe(GUARD);
    expect(gitStatus(root)).toBe('');
  }, 60_000);
});
