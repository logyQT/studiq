/**
 * The build's terminal contract.
 *
 * Two agents lost real time to these shapes: a failed build printed only
 * `env: build failed` (the compiler error went to a log nobody was told about,
 * with raw ANSI), and a successful build printed nothing at all, so warnings
 * were invisible. These tests pin what a terminal gets on each path.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnvModule } from '#test/unit/env/load';

interface ProductionBuildOptions {
  app: 'web' | 'admin';
  admission: 'slot' | 'no-slot' | 'no-lock';
}

interface BuildResult {
  ok: boolean;
  timedOut: boolean;
  output: string;
  fingerprintAfter: string;
  slot?: number | null;
  durationMs?: number;
}

interface SpawnOutcome {
  status: number | null;
  timedOut: boolean;
  output: string;
  durationMs: number;
}

interface BuildModule {
  runProductionBuild(
    envHash: string,
    deps: {
      readWebPid(): number | null;
      spawnBuild(slot: unknown, options: ProductionBuildOptions): Promise<SpawnOutcome>;
      artifactDir?: string;
    },
    options: ProductionBuildOptions,
  ): Promise<BuildResult>;
  reportBuildFailure(result: BuildResult): { code: number; message: string };
  formatBuildDuration(ms: number): string;
}

// `state.ts` captures DEV_DIR at import time; the log this suite reads is here.
const stateDir = mkdtempSync(join(tmpdir(), 'studiq-build-output-'));
const registryDir = mkdtempSync(join(tmpdir(), 'studiq-build-output-registry-'));
const artifactRoot = mkdtempSync(join(tmpdir(), 'studiq-build-output-artifact-'));
process.env.STUDIQ_ENV_STATE_DIR = stateDir;
process.env.STUDIQ_DEV_REGISTRY = registryDir;

const build = await loadEnvModule<BuildModule>('lib/build.ts');
const logPath = join(stateDir, 'env.log');

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
  rmSync(registryDir, { recursive: true, force: true });
  rmSync(artifactRoot, { recursive: true, force: true });
});

beforeEach(() => {
  for (const name of readdirSync(stateDir)) rmSync(join(stateDir, name), { recursive: true });
  rmSync(join(registryDir, 'build-slots'), { recursive: true, force: true });
});

function captureStderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

function outcome(overrides: Partial<SpawnOutcome> = {}): SpawnOutcome {
  return { status: 0, timedOut: false, output: '', durationMs: 1_200, ...overrides };
}

function run(
  spawn: SpawnOutcome,
  options: ProductionBuildOptions = { app: 'admin', admission: 'no-slot' },
): Promise<BuildResult> {
  return build.runProductionBuild(
    'env-hash',
    // A failed web build invalidates the artifact it was pointed at; never this
    // checkout's real `apps/web/.next`.
    {
      readWebPid: () => null,
      spawnBuild: () => Promise.resolve(spawn),
      artifactDir: artifactDir(),
    },
    options,
  );
}

/** A throwaway artifact path: a failed build moves this, not the real one. */
function artifactDir(): string {
  return join(artifactRoot, '.next');
}

/** The compiler failure both agents hit, with the ANSI colour Next emits. */
const COMPILER_FAILURE = [
  '@studiq/web prebuild: build: admitted apps/web (slot 1, launcher pid 1)',
  '@studiq/web prebuild: Exited with code 0',
  '@studiq/web build:',
  '@studiq/web build: > Build error occurred',
  '\u001b[31mError: Turbopack build failed with 1 error:',
  './src/components/header-badge.tsx:36:12',
  'Error: Expression expected\u001b[0m',
  '',
  '  34 |     <div className="flex">',
  '  35 |       {badge && (',
  '> 36 |         <Badge>{label}</Badge>',
  '     |                ^',
  '  37 |       )}',
  '',
  'error: script "build" exited with code 4',
  '',
].join('\n');

const WEB_FAILURE: ProductionBuildOptions = { app: 'web', admission: 'no-slot' };

describe('a failed build', () => {
  it('prints the compiler error to stderr and names the log', async () => {
    const stderr = captureStderr();
    const result = await run(outcome({ status: 2, output: COMPILER_FAILURE }), WEB_FAILURE);

    expect(result.ok).toBe(false);
    const failure = build.reportBuildFailure(result, 'web');
    const text = stderr.join('');

    // The compiler line, the file and the caret are all visible without opening
    // a file — this is the whole point of the change.
    expect(text).toContain('build: Error: Expression expected');
    expect(text).toContain('build: ./src/components/header-badge.tsx:36:12');
    expect(text).toContain('build: > 36 |         <Badge>{label}</Badge>');
    expect(text).toContain('build:      |                ^');
    expect(text).not.toContain('\u001b[');
    // Bun's own filter labels (build and prebuild) are not the compiler's output,
    // and the guard's own `build:` tag is not applied twice.
    expect(text).not.toContain('@studiq/');
    expect(text).toContain('build: admitted apps/web (slot 1, launcher pid 1)');
    expect(text).not.toContain('build: build:');

    expect(failure).toEqual({ code: 4, message: 'build failed (exit 4); full log: .dev/env.log' });
  });

  it('writes the full output to .dev/env.log, ANSI-free', async () => {
    captureStderr();
    const result = await run(outcome({ status: 2, output: COMPILER_FAILURE }), WEB_FAILURE);
    const failure = build.reportBuildFailure(result, 'web');

    const log = readFileSync(logPath, 'utf8');
    expect(log).toContain('build: Error: Expression expected');
    expect(log).toContain('build: > 36 |         <Badge>{label}</Badge>');
    expect(log).not.toContain('\u001b[');
    expect(log).not.toContain('@studiq/');
    // The log keeps more than the terminal tail: the first line is there too.
    expect(log).toContain('build: Error: Turbopack build failed with 1 error:');
    // The line the CLI prints names the log, so the failure is not a dead end.
    expect(failure.message).toContain('full log: .dev/env.log');
  });

  it('caps the terminal tail at 40 lines and still keeps the end', async () => {
    const stderr = captureStderr();
    const lines = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`);
    const result = await run(outcome({ status: 2, output: lines.join('\n') }), WEB_FAILURE);
    build.reportBuildFailure(result, 'web');

    const printed = stderr
      .join('')
      .split('\n')
      .filter((line) => line.startsWith('build: line '));
    expect(printed).toHaveLength(40);
    expect(printed[0]).toBe('build: line 21');
    expect(printed.at(-1)).toBe('build: line 60');
  });

  it('names exit 5 for a timeout', async () => {
    captureStderr();
    const result = await run(
      outcome({ status: null, timedOut: true, output: 'killed' }),
      WEB_FAILURE,
    );

    expect(build.reportBuildFailure(result, 'web')).toEqual({
      code: 5,
      message: 'timed out building (exit 5); full log: .dev/env.log',
    });
  });
});

describe('a successful build', () => {
  it('prints its warnings and one summary line with the duration', async () => {
    const stderr = captureStderr();
    const output = [
      '✓ Compiled successfully in 3.2s',
      '⚠ Warning: Image /logo.png has no width or height',
      '✓ Generating static pages (12/12)',
      '',
    ].join('\n');

    const result = await run(outcome({ output, durationMs: 12_400 }), {
      app: 'admin',
      admission: 'slot',
    });

    expect(result.ok).toBe(true);
    const text = stderr.join('');
    expect(text).toContain('build: ⚠ Warning: Image /logo.png has no width or height');
    expect(text).toContain('Build complete (apps/admin, slot) in 12.4s');
    // Next's own success lines are not re-printed as diagnostics.
    expect(text).not.toContain('✓ Compiled successfully');
  });

  it('stays one summary line when there is nothing to warn about', async () => {
    const stderr = captureStderr();
    await run(outcome({ output: '✓ Compiled successfully in 3.2s\n' }), {
      app: 'admin',
      admission: 'no-slot',
    });

    const lines = stderr
      .join('')
      .split('\n')
      .filter((line) => line !== '');
    // Exactly the mode line, the start line and the summary: a clean build adds
    // nothing, which is what makes a build with warnings visible.
    expect(lines).toEqual([
      'build: --no-slot: no build slot or lease claimed (CI/Playwright mode)',
      'build: building apps/admin (no-slot)',
      'Build complete (apps/admin, no-slot) in 1.2s',
    ]);
  });

  it('does not treat a ✓ line that mentions warnings as a diagnostic', async () => {
    const stderr = captureStderr();
    await run(outcome({ output: '✓ Warning: 1 page uses a deprecated API\n' }), {
      app: 'admin',
      admission: 'no-slot',
    });

    expect(stderr.join('')).not.toContain('1 page uses a deprecated API');
  });

  it('caps the warning list and points at the log for the rest', async () => {
    const stderr = captureStderr();
    const warnings = Array.from({ length: 12 }, (_, index) => `⚠ Warning ${index + 1}`);
    await run(outcome({ output: warnings.join('\n') }), { app: 'admin', admission: 'no-slot' });

    const text = stderr.join('');
    expect(text).toContain('build: ⚠ Warning 10');
    expect(text).not.toContain('build: ⚠ Warning 11');
    expect(text).toContain('build: … 2 more warning line(s) in .dev/env.log');
  });

  it('writes its warnings to .dev/env.log', async () => {
    captureStderr();
    await run(outcome({ output: '⚠ Warning: something small\n' }), {
      app: 'admin',
      admission: 'no-slot',
    });

    expect(readFileSync(logPath, 'utf8')).toContain('build: ⚠ Warning: something small');
  });
});

describe('the start line', () => {
  it('names the slot and the queue wait before the spawn', async () => {
    const stderr = captureStderr();
    await run(outcome(), { app: 'admin', admission: 'slot' });

    // The wait is on the line because the wall time includes it; a line without
    // it would read as build time.
    expect(stderr.join('')).toMatch(/build: building apps\/admin \(slot 1, after \d+\.\d+s\)/);
  });

  it('names the mode when there is no slot', async () => {
    const stderr = captureStderr();
    await run(outcome(), { app: 'admin', admission: 'no-slot' });

    expect(stderr.join('')).toContain('build: building apps/admin (no-slot)');
  });

  it('names --no-lock too', async () => {
    const stderr = captureStderr();
    await run(outcome(), { app: 'admin', admission: 'no-lock' });

    expect(stderr.join('')).toContain('build: building apps/admin (no-lock)');
  });
});

describe('formatBuildDuration', () => {
  it.each([
    [400, '0.4s'],
    [12_400, '12.4s'],
    [59_900, '59.9s'],
    [60_000, '1m 00s'],
    [312_000, '5m 12s'],
  ])('formats %d ms as %s', (ms, expected) => {
    expect(build.formatBuildDuration(ms)).toBe(expected);
  });
});
