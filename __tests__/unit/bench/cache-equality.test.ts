import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface FileDifference {
  path: string;
  kinds: string[];
  explained: boolean;
}

interface TreeDiff {
  comparedFiles: number;
  onlyA: string[];
  onlyB: string[];
  differing: FileDifference[];
  unexplained: string[];
}

interface CacheHit {
  confirmed: boolean;
  compileRatio: number | null;
  bytesRatio: number | null;
  compactionSpan: boolean;
}

interface BenchModule {
  compareTrees(aRoot: string, aId: string, bRoot: string, bId: string): TreeDiff;
  chooseWorkDir(input: {
    raw: string | null;
    repoRoot: string;
    tmpRoot: string;
  }): { ok: true; path: string } | { ok: false; reason: string };
  verdictOf(
    noise: TreeDiff,
    subject: TreeDiff,
    novelDifferences: string[],
    buildIds: readonly string[],
    cacheHit: CacheHit,
  ): { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; reason: string | null; ok: boolean };
}

/**
 * Load the shipped harness by absolute URL, like `#test/unit/env/load.ts`:
 * `scripts/**` has no alias and `__tests__` may not use relative specifiers.
 */
async function loadBenchModule(): Promise<BenchModule> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- dynamic module boundary
  return import(pathToFileURL(join(REPO_ROOT, 'scripts', 'bench', 'cache-equality.ts')).href);
}

const bench = await loadBenchModule();

const COLD_ID = 'CwVn_kv0wMIHUzOmETtD1';
const SEEDED_ID = 'q7Zt2mQ0dYy8wXbGpLrNv';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, string>, buildId: string): string {
  const root = mkdtempSync(join(tmpdir(), 'cache-equality-test-'));
  roots.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const path = join(root, rel.split('__BUILD_ID__').join(buildId));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

const hit: CacheHit = {
  confirmed: true,
  compileRatio: 0.27,
  bytesRatio: 0.05,
  compactionSpan: true,
};

const randomNoise: TreeDiff = {
  comparedFiles: 2,
  onlyA: [],
  onlyB: [],
  differing: [{ path: 'build-manifest.json', kinds: ['build-id'], explained: true }],
  unexplained: [],
};

function emptyDiff(): TreeDiff {
  return { comparedFiles: 2, onlyA: [], onlyB: [], differing: [], unexplained: [] };
}

interface WorkDirLab {
  tmpRoot: string;
  repoRoot: string;
  outside: string;
}

function workDirLab(): WorkDirLab {
  const base = mkdtempSync(join(tmpdir(), 'cache-equality-work-'));
  roots.push(base);
  const tmpRoot = join(base, 'tmp');
  const repoRoot = join(tmpRoot, 'checkout');
  const outside = join(base, 'outside');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { tmpRoot, repoRoot, outside };
}

describe('cache equality comparison', () => {
  it('explains a BUILD_ID derivation and a per-build random value', () => {
    const a = tree(
      {
        BUILD_ID: COLD_ID,
        'static/__BUILD_ID__/page.js': 'chunk',
        'build-manifest.json': `{"buildId":"${COLD_ID}"}`,
        'server/preview-props.json': '{"previewModeId":"0f5245a6657f21be8b85701178e40acb"}',
      },
      COLD_ID,
    );
    const b = tree(
      {
        BUILD_ID: SEEDED_ID,
        'static/__BUILD_ID__/page.js': 'chunk',
        'build-manifest.json': `{"buildId":"${SEEDED_ID}"}`,
        'server/preview-props.json': '{"previewModeId":"9a1c7e5d3b2f4a6c8e0d1f2a3b4c5d6e"}',
      },
      SEEDED_ID,
    );

    const diff = bench.compareTrees(a, COLD_ID, b, SEEDED_ID);
    expect(diff.comparedFiles).toBe(3);
    expect(diff.unexplained).toEqual([]);
    expect(diff.differing.map((file) => [file.path, file.kinds, file.explained])).toEqual([
      ['build-manifest.json', ['build-id'], true],
      ['server/preview-props.json', ['previewModeId'], true],
    ]);
  });

  it('reports a content difference no random rule explains', () => {
    const a = tree({ 'server/app/page.html': '<h1>cold</h1>' }, COLD_ID);
    const b = tree({ 'server/app/page.html': '<h1>seeded</h1>' }, SEEDED_ID);

    const diff = bench.compareTrees(a, COLD_ID, b, SEEDED_ID);
    expect(diff.unexplained).toEqual(['server/app/page.html']);
    expect(diff.differing).toEqual([{ path: 'server/app/page.html', kinds: [], explained: false }]);
  });

  it('reports a file only one arm emitted', () => {
    const a = tree({ 'server/app/page.html': 'same' }, COLD_ID);
    const b = tree(
      { 'server/app/page.html': 'same', 'static/stale-chunk.js': 'only seeded' },
      SEEDED_ID,
    );

    const diff = bench.compareTrees(a, COLD_ID, b, SEEDED_ID);
    expect(diff.onlyB).toEqual(['static/stale-chunk.js']);
    expect(diff.unexplained).toEqual(['static/stale-chunk.js']);
  });

  it('leaves a 64-hex value under another key and an ISO timestamp unexplained', () => {
    const a = tree(
      {
        'server/session.json': `{"sessionToken":"${'a'.repeat(64)}"}`,
        'server/build-note.txt': '2026-11-18T10:00:00.000Z',
      },
      COLD_ID,
    );
    const b = tree(
      {
        'server/session.json': `{"sessionToken":"${'b'.repeat(64)}"}`,
        'server/build-note.txt': '2026-11-18T10:00:01.000Z',
      },
      SEEDED_ID,
    );

    const diff = bench.compareTrees(a, COLD_ID, b, SEEDED_ID);
    expect(diff.unexplained).toEqual(['server/build-note.txt', 'server/session.json']);
  });
});

describe('cache equality verdict', () => {
  it('passes when the seeded arm differs only where two cold builds did', () => {
    expect(
      bench.verdictOf(randomNoise, randomNoise, [], [COLD_ID, SEEDED_ID, 'third-id'], hit),
    ).toEqual({ verdict: 'PASS', reason: null, ok: true });
  });

  it('fails on a difference the noise floor never had', () => {
    const verdict = bench.verdictOf(
      randomNoise,
      randomNoise,
      ['server/app/page.html'],
      [COLD_ID, SEEDED_ID, 'third-id'],
      hit,
    );
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.ok).toBe(false);
  });

  it('fails on an unexplained seeded difference', () => {
    const subject: TreeDiff = {
      ...emptyDiff(),
      differing: [{ path: 'server/app/page.html', kinds: [], explained: false }],
      unexplained: ['server/app/page.html'],
    };
    expect(
      bench.verdictOf(randomNoise, subject, [], [COLD_ID, SEEDED_ID, 'third-id'], hit).verdict,
    ).toBe('FAIL');
  });

  it('is inconclusive when the seeded arm did not hit the cache', () => {
    const missed: CacheHit = {
      confirmed: false,
      compileRatio: 0.98,
      bytesRatio: 0.97,
      compactionSpan: false,
    };
    expect(
      bench.verdictOf(randomNoise, randomNoise, [], [COLD_ID, SEEDED_ID, 'third-id'], missed)
        .verdict,
    ).toBe('INCONCLUSIVE');
  });

  it('fails when two cold builds were identical', () => {
    expect(
      bench.verdictOf(emptyDiff(), randomNoise, [], [COLD_ID, SEEDED_ID, 'third-id'], hit).verdict,
    ).toBe('FAIL');
  });

  it('fails when the noise floor itself has an unexplained difference', () => {
    const noise: TreeDiff = {
      ...emptyDiff(),
      differing: [{ path: 'server/app/page.html', kinds: [], explained: false }],
      unexplained: ['server/app/page.html'],
    };
    expect(
      bench.verdictOf(noise, randomNoise, [], [COLD_ID, SEEDED_ID, 'third-id'], hit).verdict,
    ).toBe('FAIL');
  });

  it('fails when two arms share a BUILD_ID', () => {
    expect(
      bench.verdictOf(randomNoise, randomNoise, [], [COLD_ID, COLD_ID, 'third-id'], hit).verdict,
    ).toBe('FAIL');
  });
});

describe('cache equality work dir', () => {
  it('refuses an empty value instead of resolving it to the current directory', () => {
    const { tmpRoot, repoRoot } = workDirLab();
    expect(bench.chooseWorkDir({ raw: '', repoRoot, tmpRoot })).toEqual({
      ok: false,
      reason: 'an empty value would resolve to the current directory',
    });
  });

  it('refuses the checkout itself', () => {
    const { tmpRoot, repoRoot } = workDirLab();
    expect(bench.chooseWorkDir({ raw: repoRoot, repoRoot, tmpRoot })).toEqual({
      ok: false,
      reason: 'it is this checkout',
    });
  });

  it('refuses an ancestor of the checkout', () => {
    const { tmpRoot, repoRoot } = workDirLab();
    const choice = bench.chooseWorkDir({ raw: tmpRoot, repoRoot, tmpRoot });
    expect(choice.ok).toBe(false);
    if (!choice.ok) expect(choice.reason).toBe('it contains this checkout');
  });

  it('refuses a path inside the checkout', () => {
    const { tmpRoot, repoRoot } = workDirLab();
    expect(bench.chooseWorkDir({ raw: join(repoRoot, 'evidence'), repoRoot, tmpRoot })).toEqual({
      ok: false,
      reason: 'it is inside this checkout',
    });
  });

  it('refuses the temp root itself when the checkout sits outside it', () => {
    const base = mkdtempSync(join(tmpdir(), 'cache-equality-work-'));
    roots.push(base);
    const tmpRoot = join(base, 'tmp');
    const repoRoot = join(base, 'checkout');
    mkdirSync(tmpRoot, { recursive: true });
    mkdirSync(repoRoot, { recursive: true });
    expect(bench.chooseWorkDir({ raw: tmpRoot, repoRoot, tmpRoot })).toEqual({
      ok: false,
      reason: 'it is the temp root itself',
    });
  });

  it('refuses a path outside the temp root', () => {
    const { tmpRoot, repoRoot, outside } = workDirLab();
    const choice = bench.chooseWorkDir({ raw: outside, repoRoot, tmpRoot });
    expect(choice.ok).toBe(false);
    if (!choice.ok) expect(choice.reason).toContain('outside');
  });

  it('accepts a path inside the temp root that is not the checkout', () => {
    const { tmpRoot, repoRoot } = workDirLab();
    const choice = bench.chooseWorkDir({ raw: join(tmpRoot, 'evidence'), repoRoot, tmpRoot });
    expect(choice.ok).toBe(true);
  });

  it('gives two checkouts distinct defaults', () => {
    const { tmpRoot, repoRoot } = workDirLab();
    const first = bench.chooseWorkDir({ raw: null, repoRoot, tmpRoot });
    const second = bench.chooseWorkDir({ raw: null, repoRoot: join(tmpRoot, 'other'), tmpRoot });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.path.startsWith(realpathSync(tmpRoot))).toBe(true);
      expect(second.path.startsWith(realpathSync(tmpRoot))).toBe(true);
      expect(first.path).not.toBe(second.path);
    }
  });
});
