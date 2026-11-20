/**
 * The duplication gate's comparison (`scripts/dup-baseline.ts`) is what turns
 * two jscpd reports into a verdict, so it is pinned here twice over: the pure
 * comparison on synthetic clones (what counts as new, and why), and the real
 * gate driven against a git repository whose files are copied and edited.
 *
 * jscpd's own `--baseline-from-ref` fingerprints a clone by the *pair* of
 * snippets it reports, and picks that pair among the files sharing a block by
 * detection order. Editing one of them re-pairs the block with another
 * neighbour and the baseline calls the new pair a new clone. These tests pin
 * both halves of the replacement rule: a re-pairing is quiet, a copy is not.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const MODULE = fileURLToPath(new URL('../../../scripts/dup-baseline.ts', import.meta.url));

/**
 * The gate's own types and functions, from the file that ships.
 * `scripts/**` has no import alias and `__tests__` may not use relative
 * specifiers, so the module is imported by an absolute file URL — the same way
 * `__tests__/unit/env/load.ts` loads `scripts/env`.
 */
interface GateModule {
  newClones: (current: Clone[], base: Clone[], comparison: Comparison) => Clone[];
  normaliseBlock: (text: string) => string;
}

interface CloneLocation {
  name: string;
  start: number;
  end: number;
}

interface Clone {
  pair: [string, string];
  block: string;
  first: CloneLocation;
  second: CloneLocation;
  tokens: number;
  lines: number;
}

interface Comparison {
  edited: Set<string>;
  resolve: (name: string) => string;
}

interface DupBaselineResult {
  ref: string;
  clones: number;
  baseClones: number;
  newClones: Array<{ first: string; second: string; lines: number; tokens: number }>;
}

function load(): Promise<GateModule> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- dynamic module boundary; `scripts/**` has no alias, as in __tests__/unit/env/load.ts
  return import(pathToFileURL(MODULE).href) as Promise<GateModule>;
}

// Never inherit the harness git context (GIT_DIR/GIT_WORK_TREE would redirect
// the fixture commits at the real checkout).
const TEST_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME ?? tmpdir(),
  LANG: process.env.LANG,
  LC_ALL: process.env.LC_ALL,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'dup-baseline-test',
  GIT_AUTHOR_EMAIL: 'dup-baseline-test@example.com',
  GIT_COMMITTER_NAME: 'dup-baseline-test',
  GIT_COMMITTER_EMAIL: 'dup-baseline-test@example.com',
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: TEST_ENV });
}

function write(repo: string, path: string, content: string): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Long enough to clear `.jscpd.json`'s `minTokens: 50` / `minLines: 5`. */
function route(name: string, method = 'GET'): string {
  return [
    "import { toNextResponse } from '@studiq/server/lib/http-utils';",
    "import { withAuth } from '@studiq/server/lib/with-auth';",
    "import type { NextRequest } from 'next/server';",
    '',
    `export async function ${method}(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {`,
    '  return withAuth(req, async (ctx) => {',
    '    const { id } = await params;',
    `    return toNextResponse(await ${name}Controller.getById(id, ctx));`,
    '  });',
    '}',
    '',
  ].join('\n');
}

function repoWith(files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), 'dup-baseline-'));
  roots.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  // The scan reads the scanned tree's own config, so the fixture carries one
  // shaped like the repository's, with the two thresholds the gate depends on.
  write(repo, '.jscpd.json', JSON.stringify({ path: ['src'], minTokens: 50, minLines: 5 }));
  for (const [path, content] of Object.entries(files)) write(repo, `src/${path}`, content);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return repo;
}

interface Verdict {
  status: number | null;
  result: DupBaselineResult | null;
}

function gate(repo: string, ...args: string[]): Verdict {
  let stdout: string;
  let status: number;
  try {
    stdout = execFileSync('bun', [MODULE, '--json', '--ref', 'origin/main', ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: TEST_ENV,
      stdio: 'pipe',
    });
    status = 0;
  } catch (error) {
    // A red gate exits 1; anything else did not run. `execFileSync`'s error
    // carries the child's status and output.
    stdout = isRecord(error) && typeof error.stdout === 'string' ? error.stdout : '';
    status = isRecord(error) && typeof error.status === 'number' ? error.status : 2;
  }
  if (stdout === '') return { status, result: null };
  const parsed: unknown = JSON.parse(stdout);
  return { status, result: isResult(parsed) ? parsed : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResult(value: unknown): value is DupBaselineResult {
  return (
    isRecord(value) &&
    typeof value.ref === 'string' &&
    typeof value.clones === 'number' &&
    Array.isArray(value.newClones)
  );
}

/** A clone of a block, with a line the test does not care about. */
function clone(overrides: Pick<Clone, 'pair' | 'block'> & Partial<Clone>): Clone {
  return {
    first: { name: overrides.pair[0], start: 1, end: 2 },
    second: { name: overrides.pair[1], start: 1, end: 2 },
    tokens: 60,
    lines: 6,
    ...overrides,
  };
}

/** Every path is "edited" unless the test says otherwise. */
const everything: Comparison = {
  edited: new Set(['a.ts', 'b.ts', 'c.ts']),
  resolve: (name) => name,
};

describe('dup-baseline: the comparison rule', () => {
  it('is quiet for a clone whose block moved to another line', async () => {
    const { newClones } = await load();
    const base = [clone({ pair: ['a.ts', 'b.ts'], block: 'const x = f();' })];
    const current = [
      clone({
        pair: ['a.ts', 'b.ts'],
        block: 'const x = f();',
        first: { name: 'a.ts', start: 40, end: 45 },
      }),
    ];

    expect(newClones(current, base, everything)).toEqual([]);
  });

  it('is quiet for a pair of untouched files, whatever jscpd now reports', async () => {
    const { newClones } = await load();
    const base = [clone({ pair: ['a.ts', 'b.ts'], block: 'const x = f();' })];
    const current = [clone({ pair: ['a.ts', 'b.ts'], block: 'a block the base never had' })];

    expect(newClones(current, base, { edited: new Set(), resolve: (name) => name })).toEqual([]);
  });

  it('is quiet when an edit re-pairs a block with another file that already held it', async () => {
    const { newClones } = await load();
    // This branch's shape: `b.ts` and `c.ts` both hold the block in the base,
    // `b.ts` is rewritten, and jscpd reports the block against `c.ts` now.
    const base = [
      clone({ pair: ['a.ts', 'b.ts'], block: 'shared header' }),
      clone({ pair: ['a.ts', 'c.ts'], block: 'shared header' }),
    ];
    const current = [clone({ pair: ['a.ts', 'c.ts'], block: 'shared header' })];

    expect(newClones(current, base, everything)).toEqual([]);
  });

  it('is quiet when the block moves between the same two files and only the pair order changes', async () => {
    const { newClones } = await load();
    const base = [clone({ pair: ['a.ts', 'b.ts'], block: 'shared header' })];
    const current = [
      clone({
        pair: ['a.ts', 'b.ts'],
        block: 'shared header',
        first: { name: 'b.ts', start: 30, end: 35 },
        second: { name: 'a.ts', start: 12, end: 17 },
      }),
    ];

    expect(newClones(current, base, everything)).toEqual([]);
  });

  it('fails a block re-paired with a file that never held it', async () => {
    const { newClones } = await load();
    // The same shape as the re-pairing above, but `c.ts` was never a holder:
    // that is `a.ts` copied into `c.ts`.
    const base = [clone({ pair: ['a.ts', 'b.ts'], block: 'shared header' })];
    const current = [clone({ pair: ['a.ts', 'c.ts'], block: 'shared header' })];

    expect(newClones(current, base, everything)).toHaveLength(1);
  });

  it('fails a copy of a file that was already duplicated, which adds a holder', async () => {
    const { newClones } = await load();
    const base = [clone({ pair: ['a.ts', 'b.ts'], block: 'shared header' })];
    // `copy.ts` is new to the block; it pairs with `b.ts`, which held it.
    const current = [clone({ pair: ['b.ts', 'copy.ts'], block: 'shared header' })];

    const fresh = newClones(current, base, {
      edited: new Set(['copy.ts']),
      resolve: (name) => name,
    });
    expect(fresh.map((pair) => pair.pair)).toEqual([['b.ts', 'copy.ts']]);
  });

  it('fails a block the base never held at all', async () => {
    const { newClones } = await load();
    // Nothing in the base carried this content, so there is no holder set to
    // consult: the clone is new however the files are named.
    const base = [clone({ pair: ['a.ts', 'b.ts'], block: 'a block of the base' })];
    const current = [clone({ pair: ['a.ts', 'b.ts'], block: 'content nobody had' })];

    expect(newClones(current, base, everything)).toHaveLength(1);
  });

  it('fails an edited file that becomes a copy of an untouched one', async () => {
    const { newClones } = await load();
    const base = [clone({ pair: ['a.ts', 'b.ts'], block: 'old a against b' })];
    const current = [clone({ pair: ['a.ts', 'c.ts'], block: 'content c never had' })];

    expect(newClones(current, base, everything)).toHaveLength(1);
  });
});

describe('dup-baseline: the gate against a repository', () => {
  it('exits 0 when the base has no clones at all', () => {
    const repo = repoWith({ 'lonely.ts': 'export const a = 1;\n' });

    const { status, result } = gate(repo);

    expect(status).toBe(0);
    expect(result?.newClones).toEqual([]);
  });

  it('exits 0 on a tree identical to the base that has clones of its own', () => {
    const repo = repoWith({ 'a.ts': route('alpha'), 'b.ts': route('alpha') });

    const { status, result } = gate(repo);

    expect(status).toBe(0);
    expect(result?.clones).toBeGreaterThan(0);
  });

  it('fails a new file that copies an existing route', () => {
    const repo = repoWith({ 'a.ts': route('alpha'), 'b.ts': route('alpha') });
    write(repo, 'src/copy.ts', route('alpha'));

    const { status, result } = gate(repo);

    expect(status).toBe(1);
    const named = (result?.newClones ?? []).flatMap((newClone) => [
      newClone.first,
      newClone.second,
    ]);
    expect(named.some((name) => name.startsWith('copy.ts:'))).toBe(true);
  });

  it('fails a new file that copies a file which was not duplicated before', () => {
    const repo = repoWith({ 'lonely.ts': route('alpha') });
    write(repo, 'src/copy.ts', route('alpha'));

    const { status, result } = gate(repo);

    expect(status).toBe(1);
    const named = (result?.newClones ?? []).flatMap((newClone) => [
      newClone.first,
      newClone.second,
    ]);
    expect(named.some((name) => name.startsWith('copy.ts:'))).toBe(true);
  });

  it('stays quiet when a third, untouched file is what made jscpd pair two files', () => {
    // `a` and `b` hold the block. In the base, `c` also did and jscpd paired
    // it with `a`; editing `c` takes it out of the pairing, so `a` is reported
    // against `b` instead. No file of that clone gained content.
    const repo = repoWith({ 'a.ts': route('alpha'), 'b.ts': route('alpha') });
    write(repo, 'src/c.ts', route('alpha'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'add c');
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    write(repo, 'src/c.ts', `export const c = 1;\n`);

    const { status } = gate(repo);

    expect(status).toBe(0);
  });
});
