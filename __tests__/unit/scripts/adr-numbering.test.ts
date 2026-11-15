/**
 * The ADR guard is a merge gate (`bun run lint` → `checks`), so it must fail on
 * the cases that actually happen (a duplicate, a skipped number, a copied
 * title, a renamed record that leaves links or `ADR-NNNN` citations dangling)
 * and stay quiet on the ones that do not (README, dotfiles, anchors in links,
 * untracked scratch files). Each test drives the real script against a temp
 * git checkout.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../scripts/check-adr-numbering.ts', import.meta.url));

// Never inherit the harness git context. Lefthook exports GIT_DIR/GIT_WORK_TREE
// (and friends), so a `git init` or `git add` in a temp fixture would act on the
// real checkout instead — including rewriting its index. An allowlisted
// environment keeps every child hermetic.
const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME ?? tmpdir(),
  LANG: process.env.LANG,
  LC_ALL: process.env.LC_ALL,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An ADR whose H1 matches its filename, e.g. `0003-adr.md` → `# ADR-0003: Adr`. */
function adr(file: string, options: { title?: string; body?: string } = {}): [string, string] {
  const number = file.slice(0, 4);
  return [file, `# ${options.title ?? `ADR-${number}: Record ${number}`}\n\n${options.body ?? ''}`];
}

/**
 * A temp checkout: ADRs under `docs/decisions/`, plus optional reference files
 * (`README.md`, `docs/**.md`, code) relative to the root. Everything is
 * git-added, because the reference scan only looks at tracked files.
 */
function fixture(files: [string, string][], references: [string, string][] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'studiq-adr-'));
  dirs.push(root);
  mkdirSync(join(root, 'docs', 'decisions'), { recursive: true });
  for (const [name, content] of files) {
    writeFileSync(join(root, 'docs', 'decisions', name), content);
  }
  for (const [name, content] of references) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  execFileSync('git', ['init', '-q'], { cwd: root, env: GIT_ENV, stdio: 'pipe' });
  execFileSync('git', ['add', '-A'], { cwd: root, env: GIT_ENV, stdio: 'pipe' });
  return root;
}

function run(dir: string): { status: number; output: string } {
  try {
    return {
      status: 0,
      output: execFileSync('bun', [SCRIPT, dir], {
        encoding: 'utf8',
        env: GIT_ENV,
        stdio: 'pipe',
      }),
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

  it('explains that a deleted mid-sequence record is restored or reused, not renumbered', () => {
    const dir = fixture([adr('0001-a.md'), adr('0003-c.md')]);
    const result = run(dir);
    expect(result.output).toContain('restore it (or a tombstone) at that number');
    expect(result.output).not.toContain('renumber the records after it to fill');
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

  it('fails a 0000 record', () => {
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

  it('fails a cross-directory link to a renamed ADR', () => {
    const dir = fixture(
      [adr('0001-a.md')],
      [['README.md', 'See [ADR-0001](docs/decisions/0001-old-name.md).\n']],
    );
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('README.md:1 links to docs/decisions/0001-old-name.md');
  });

  it('fails a relative cross-directory link from a plan', () => {
    const dir = fixture(
      [adr('0001-a.md')],
      [['docs/plans/plan.md', 'See [ADR-0001](../decisions/0001-old-name.md).\n']],
    );
    expect(run(dir).output).toContain('links to ../decisions/0001-old-name.md');
  });

  it('accepts links with anchors, ./ and valid targets', () => {
    const dir = fixture([
      adr('0001-a.md', { body: 'See [two](./0002-b.md#status) and [three](0003-c.md).\n' }),
      adr('0002-b.md'),
      adr('0003-c.md'),
    ]);
    expect(run(dir).status).toBe(0);
  });

  it('accepts cross-directory links that resolve', () => {
    const dir = fixture(
      [adr('0001-a.md')],
      [
        ['README.md', 'See [ADR-0001](docs/decisions/0001-a.md#status).\n'],
        ['docs/plans/plan.md', 'See [ADR-0001](../decisions/0001-a.md).\n'],
      ],
    );
    expect(run(dir).status).toBe(0);
  });

  it('fails an ADR-NNNN citation with no matching record', () => {
    const dir = fixture([adr('0001-a.md')], [['README.md', 'The plan model lives in ADR-0007.\n']]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain('README.md:1 cites ADR-0007, but no docs/decisions/0007-*.md');
  });

  it('fails a citation in a code comment, not just in Markdown', () => {
    const dir = fixture(
      [adr('0001-a.md')],
      [['packages/server/src/thing.ts', '// Plans are defined by ADR-0007.\n']],
    );
    expect(run(dir).output).toContain('cites ADR-0007');
  });

  it('accepts citations of records that exist', () => {
    const dir = fixture(
      [adr('0001-a.md', { body: 'Superseded context: ADR-0001.\n' })],
      [
        ['README.md', 'See ADR-0001.\n'],
        ['packages/server/src/thing.ts', '// See ADR-0001.\n'],
      ],
    );
    expect(run(dir).status).toBe(0);
  });

  it('ignores untracked files in the reference scan', () => {
    const dir = fixture([adr('0001-a.md')]);
    writeFileSync(join(dir, 'scratch.md'), 'See ADR-0007 and [x](docs/decisions/0007-gone.md).\n');
    expect(run(dir).status).toBe(0);
  });

  it('fails a subdirectory', () => {
    const dir = fixture([adr('0001-a.md')]);
    mkdirSync(join(dir, 'docs', 'decisions', 'archive'));
    expect(run(dir).output).toContain('archive/');
  });

  it('fails loudly when the ADR directory is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'studiq-adr-'));
    dirs.push(root);
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('does not exist');
  });
});
