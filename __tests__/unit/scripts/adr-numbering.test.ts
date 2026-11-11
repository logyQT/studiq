/**
 * The ADR numbering guard is a merge gate (`bun run lint` → `checks`), so it
 * must fail on the cases that actually happen (a duplicate, a skipped number, a
 * copied title) and stay quiet on the ones that do not (README, dotfiles,
 * anchors in links). Each test drives the real script against a temp directory.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/check-adr-numbering.ts', import.meta.url));

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An ADR whose H1 matches its filename, e.g. `0003-adr.md` → `# ADR-0003: Adr`. */
function adr(file: string, options: { title?: string; body?: string } = {}): [string, string] {
  const number = file.slice(0, 4);
  return [file, `# ${options.title ?? `ADR-${number}: Record ${number}`}\n\n${options.body ?? ''}`];
}

function fixture(files: [string, string][]): string {
  const dir = mkdtempSync(join(tmpdir(), 'studiq-adr-'));
  dirs.push(dir);
  for (const [name, content] of files) writeFileSync(join(dir, name), content);
  return dir;
}

function run(dir: string): { status: number; output: string } {
  try {
    return {
      status: 0,
      output: execFileSync('bun', [SCRIPT, dir], { encoding: 'utf8', stdio: 'pipe' }),
    };
  } catch (error) {
    // A non-zero exit is the expected failure signal here; anything else (e.g.
    // `bun` itself missing) still carries no `status`, so rethrow it.
    if (!isExecFailure(error)) throw error;
    return {
      status: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

function isExecFailure(
  error: unknown,
): error is { status?: number; stdout?: string; stderr?: string } {
  return typeof error === 'object' && error !== null && 'status' in error;
}

describe('check-adr-numbering', () => {
  it('passes a gapless, unique sequence', () => {
    const dir = fixture([adr('0001-a.md'), adr('0002-b.md'), adr('0003-c.md')]);
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.output).toContain('0001–0003');
  });

  it('allows README.md and dotfiles, ignores their numbering', () => {
    const dir = fixture([
      adr('0001-a.md'),
      ['README.md', 'not an ADR\n'],
      ['.DS_Store', 'binary droppings\n'],
    ]);
    expect(run(dir).status).toBe(0);
  });

  it('fails a skipped number', () => {
    const dir = fixture([adr('0001-a.md'), adr('0003-c.md')]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('gap: 0002 is missing');
  });

  it('collapses a longer gap into a range', () => {
    const dir = fixture([adr('0001-a.md'), adr('0005-e.md')]);
    expect(run(dir).output).toContain('0002–0004 are missing');
  });

  it('fails a duplicate number even when the titles differ', () => {
    const dir = fixture([
      adr('0001-a.md'),
      adr('0002-b.md'),
      adr('0003-c.md'),
      adr('0004-d.md'),
      adr('0005-e.md'),
      adr('0006-f.md'),
      adr('0007-admin.md', { title: 'ADR-0007: Admin' }),
      adr('0007-plans.md', { title: 'ADR-0007: Plans' }),
    ]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('ADR-0007 is used by 2 files');
    // A duplicate is not also reported as a gap.
    expect(result.output).not.toContain('gap');
  });

  it.each([
    ['7-a.md', 'expected NNNN-kebab-case-slug.md'],
    ['00007-a.md', 'expected NNNN-kebab-case-slug.md'],
    ['000_a.md', 'expected NNNN-kebab-case-slug.md'],
    ['0001.md', 'expected NNNN-kebab-case-slug.md'],
    ['0001-A.md', 'expected NNNN-kebab-case-slug.md'],
    ['0001_not-kebab.md', 'expected NNNN-kebab-case-slug.md'],
    ['0001-trailing-.md', 'expected NNNN-kebab-case-slug.md'],
    ['NOTES.md', 'expected NNNN-kebab-case-slug.md'],
  ])('fails a malformed filename %s', (name) => {
    const dir = fixture([
      ['0001-a.md', '# ADR-0001: A\n'],
      [name, '# ADR-0001: X\n'],
    ]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain(name);
  });

  it('fails ADR-0000', () => {
    const dir = fixture([adr('0000-zero.md'), adr('0001-a.md')]);
    expect(run(dir).output).toContain('numbering starts at 0001');
  });

  it('fails a heading number that does not match the filename', () => {
    const dir = fixture([['0002-copied.md', '# ADR-0001: Copied from an older ADR\n']]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('title says ADR-0001 but the filename says ADR-0002');
  });

  it('fails a file that does not start with an ADR heading', () => {
    const dir = fixture([['0001-a.md', 'Some notes without a title\n']]);
    expect(run(dir).output).toContain('must start with "# ADR-0001: <title>"');
  });

  it('fails an intra-directory link to a renamed or missing ADR', () => {
    const dir = fixture([adr('0001-a.md', { body: 'See [ADR-0009](0009-old-name.md).\n' })]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('links to 0009-old-name.md');
  });

  it('accepts links with anchors, ./ and valid targets', () => {
    const dir = fixture([
      adr('0001-a.md', { body: 'See [two](./0002-b.md#status) and [three](0003-c.md).\n' }),
      adr('0002-b.md'),
      adr('0003-c.md'),
    ]);
    expect(run(dir).status).toBe(0);
  });

  it('fails a subdirectory', () => {
    const dir = fixture([adr('0001-a.md')]);
    mkdirSync(join(dir, 'archive'));
    expect(run(dir).output).toContain('archive/');
  });

  it('fails loudly when the ADR directory is missing', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'studiq-adr-')), 'absent');
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not exist');
  });
});
