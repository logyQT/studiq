/**
 * The build-entrypoint guard is a merge gate (`bun run lint` → `checks`), so it
 * must fail on the shapes that actually regress (a workflow step or a Playwright
 * `webServer` command that reaches `next build` without a grant) and stay quiet
 * on the ones that do not (comments, prose, the guarded workspace script).
 * Each test drives the real script against a temp fixture root.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(
  new URL('../../../scripts/check-build-entrypoints.ts', import.meta.url),
);

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: { workflow?: string; playwright?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'studiq-entrypoints-'));
  dirs.push(root);
  if (files.workflow !== undefined) {
    const path = join(root, '.github', 'workflows', 'verify.yml');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, files.workflow);
  }
  if (files.playwright !== undefined) {
    writeFileSync(join(root, 'playwright.config.ts'), files.playwright);
  }
  return root;
}

/** A workflow whose single step runs `command` as a literal block. */
function workflowWith(command: string): string {
  return [
    'name: verify',
    'jobs:',
    '  checks:',
    '    steps:',
    '      - name: Build',
    '        run: |',
    ...command.split('\n').map((line) => `          ${line}`),
    '',
  ].join('\n');
}

function run(root: string): { status: number; output: string } {
  try {
    return {
      status: 0,
      output: execFileSync('bun', [SCRIPT, root], { encoding: 'utf8', stdio: 'pipe' }),
    };
  } catch (error) {
    if (!isExecFailure(error)) throw error;
    return { status: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

function isExecFailure(
  error: unknown,
): error is { status?: number; stdout?: string; stderr?: string } {
  return typeof error === 'object' && error !== null && 'status' in error;
}

describe('check-build-entrypoints', () => {
  it('passes a workflow that builds through env:build --no-slot', () => {
    const root = fixture({ workflow: workflowWith('bun run env:build --no-slot') });
    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.output).toContain('no unguarded next build');
  });

  it('fails a workflow step that runs a bare `bun run build`', () => {
    const root = fixture({ workflow: workflowWith('bun run build') });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('.github/workflows/verify.yml:7');
    expect(result.output).toContain('bun run build');
    expect(result.output).toContain('has no build grant to consume');
  });

  it('fails a workflow step that runs `next build`', () => {
    const root = fixture({ workflow: workflowWith('bunx next build') });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('never runs the prebuild guard');
  });

  it('passes a comment that mentions `bun run build`', () => {
    const root = fixture({
      workflow: workflowWith(
        '# bun run build is replaced by env:build\nbun run env:build --no-slot',
      ),
    });
    expect(run(root).status).toBe(0);
  });

  it('passes a single-line run step that only mentions the command in prose', () => {
    const root = fixture({
      workflow: [
        'name: verify',
        'jobs:',
        '  checks:',
        '    steps:',
        '      - run: bun run env:build --no-slot   # not `bun run build`',
        '',
      ].join('\n'),
    });
    expect(run(root).status).toBe(0);
  });

  it('passes the guarded workspace script and the colon-suffixed variants', () => {
    const root = fixture({
      workflow: workflowWith(
        'bun run --filter @studiq/web build\nbun run build:web\nbun run build:admin',
      ),
    });
    expect(run(root).status).toBe(0);
  });

  it('fails a Playwright webServer command that runs `bun run build`', () => {
    const root = fixture({
      playwright: [
        'export default {',
        '  webServer: [',
        '    {',
        "      command: 'bun run build && bun run start',",
        "      url: 'http://localhost:3000',",
        '    },',
        '  ],',
        '};',
        '',
      ].join('\n'),
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('playwright.config.ts:4');
    expect(result.output).toContain('bun run build && bun run start');
  });

  it('passes a Playwright command that builds through env:build --no-slot', () => {
    const root = fixture({
      playwright: [
        'export default {',
        '  webServer: [',
        '    {',
        "      command: 'bun run env:build --no-slot && bun run start',",
        "      url: 'http://localhost:3000',",
        '    },',
        '  ],',
        '};',
        '',
      ].join('\n'),
    });
    expect(run(root).status).toBe(0);
  });

  it('ignores a TS comment that mentions `bun run build`', () => {
    const root = fixture({
      playwright: [
        '// Never `bun run build` here: it has no grant.',
        '/* bun run build is the unguarded path */',
        'export default {',
        '  webServer: [',
        '    {',
        "      command: 'bun run env:build --no-slot && bun run start',",
        "      url: 'http://localhost:3000',",
        '    },',
        '  ],',
        '};',
        '',
      ].join('\n'),
    });
    expect(run(root).status).toBe(0);
  });

  it('does not mangle a URL inside a Playwright string when stripping comments', () => {
    const root = fixture({
      playwright: [
        'export default {',
        '  use: { baseURL: "http://localhost:3000" },',
        '  webServer: [{ command: "bun run env:build --no-slot && bun run start" }],',
        '};',
        '',
      ].join('\n'),
    });
    expect(run(root).status).toBe(0);
  });

  it('fails loudly when there is nothing to check', () => {
    const root = mkdtempSync(join(tmpdir(), 'studiq-entrypoints-'));
    dirs.push(root);
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('no workflow or Playwright config found');
  });

  it('passes on the real repository', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const result = run(root);
    expect(result.status).toBe(0);
  });
});
