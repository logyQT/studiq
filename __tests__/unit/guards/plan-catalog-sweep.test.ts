/**
 * Guard for B3 (#1495): a catalogue sweep must spare an unlisted plan.
 *
 * `20261126130000`, `20261126160000`, `20261126170000` and `20261127090000`
 * delete every `subscription_plans` row their matrix does not list, so `db
 * reset` and `db push` end on the same eight public plans. A sales-led contract
 * plan is created at runtime by an admin, not by a matrix, so a future sweep
 * that keeps that shape would delete a customer's plan on the next migration.
 *
 * The rule is decidable from the source: a `delete from subscription_plans`
 * statement either predates the `visibility` column (the allowlist below) or
 * carries a `visibility` predicate. This is a source scan, so it needs no
 * database and fails in both directions: a new sweep without the predicate is
 * reported, and a missing migrations directory or allowlisted file (which would
 * make the scan vacuous) is reported too.
 *
 * The matcher is exercised against synthetic sources below, so the scan cannot
 * silently stop matching. Comments are stripped first, because this file's own
 * rule is described in prose in the migration headers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_ROOT = path.join(process.cwd(), 'supabase/migrations');

/**
 * The sweeps and targeted deletes written before `visibility` existed. Every
 * one of them predates B3; none may be extended, and a new file must not be
 * added here — it must carry the predicate instead.
 */
const PRE_B3_SWEEPS = [
  '20260924000002_strip_sys_admin.sql',
  '20261125170000_plan_catalog_owned_by_migrations.sql',
  '20261126130000_individual_plan_ladder.sql',
  '20261126160000_organization_plan_ladder.sql',
  '20261126170000_plan_key_rename_manager_plan.sql',
  '20261127090000_org_team_tier.sql',
] as const;

const DELETE_PATTERN = /\bdelete\s+from\s+(?:public\.)?subscription_plans\b/gi;

type SweepFinding = { file: string; line: number; statement: string };

function relative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

/** Replace every character except a newline, so line numbers survive the strip. */
function blank(text: string): string {
  return text.replaceAll(/[^\n]/g, ' ');
}

/** Remove SQL comments; string literals stay, so a `--` inside one is the only blind spot. */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, blank).replaceAll(/--[^\n]*/g, '');
}

/** The statement starting at `index`, up to its terminating semicolon. */
function statementAt(source: string, index: number): string {
  const end = source.indexOf(';', index);
  return source
    .slice(index, end === -1 ? undefined : end + 1)
    .trim()
    .replaceAll(/\s+/g, ' ');
}

function findingsInSource(file: string, source: string, allowlisted = false): SweepFinding[] {
  const normalized = withoutComments(source).replaceAll('"', '');
  const findings: SweepFinding[] = [];

  for (const match of normalized.matchAll(DELETE_PATTERN)) {
    const statement = statementAt(normalized, match.index);
    if (allowlisted || /\bvisibility\b/i.test(statement)) continue;
    const line = normalized.slice(0, match.index).split('\n').length;
    findings.push({ file, line, statement });
  }
  return findings;
}

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_ROOT)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => path.join(MIGRATIONS_ROOT, name));
}

function sweepFindings(): SweepFinding[] {
  return migrationFiles().flatMap((file) => {
    const name = path.basename(file);
    return findingsInSource(
      relative(file),
      fs.readFileSync(file, 'utf8'),
      (PRE_B3_SWEEPS as readonly string[]).includes(name),
    );
  });
}

const REMEDY =
  'a new catalogue sweep must add `and visibility = $$public$$` (or an equivalent predicate) to its ' +
  'delete from subscription_plans, because an unlisted contract plan is created at runtime ' +
  '(see 20261127120000_plan_visibility_assignments.sql)';

describe('a plan catalogue sweep spares unlisted plans (#1495)', () => {
  it('finds a delete in every allowlisted sweep, so the allowlist cannot go stale', () => {
    const files = migrationFiles().map((file) => path.basename(file));

    for (const allowlisted of PRE_B3_SWEEPS) {
      expect(files, allowlisted).toContain(allowlisted);
      const source = fs.readFileSync(path.join(MIGRATIONS_ROOT, allowlisted), 'utf8');
      const deletes = [...withoutComments(source).replaceAll('"', '').matchAll(DELETE_PATTERN)];
      expect(
        deletes.length,
        `${allowlisted} no longer deletes from subscription_plans — remove it from the allowlist`,
      ).toBeGreaterThan(0);
    }
  });

  it('scans a non-empty set of migration files', () => {
    // A missing or empty directory would make the main assertion pass for the
    // wrong reason.
    expect(migrationFiles().length).toBeGreaterThan(0);
  });

  it('no sweep after B3 deletes a plan without a visibility predicate', () => {
    const findings = sweepFindings().map(
      (finding) => `${finding.file}:${finding.line} runs ${finding.statement} — ${REMEDY}`,
    );
    expect(findings).toEqual([]);
  });

  it('the AI seat owning file deletes no plan row (#1511)', () => {
    // `20261127090000` sweeps every plan its eight-row matrix does not list, so
    // the licence matrix must not inherit that shape: a replay of this file may
    // not remove a plan (a pool on `ai_lite` would be left dangling).
    const source = withoutComments(
      fs.readFileSync(path.join(MIGRATIONS_ROOT, '20261128090000_ai_seat_licences.sql'), 'utf8'),
    );
    expect([...source.matchAll(DELETE_PATTERN)]).toEqual([]);
  });
});

describe('findingsInSource()', () => {
  it('reports a matrix sweep without the predicate', () => {
    const source = [
      'delete from public.subscription_plans pl',
      'where not exists (',
      '  select 1 from plan_catalog_plans m where m.plan_key = pl.key',
      ');',
    ].join('\n');

    expect(findingsInSource('migrations/x.sql', source)).toEqual([
      {
        file: 'migrations/x.sql',
        line: 1,
        statement:
          'delete from public.subscription_plans pl where not exists ( select 1 from plan_catalog_plans m where m.plan_key = pl.key );',
      },
    ]);
  });

  it('accepts the same sweep with a visibility predicate on a later line', () => {
    const source = [
      'delete from public.subscription_plans pl',
      'where pl.visibility = $$public$$',
      '  and not exists (',
      '    select 1 from plan_catalog_plans m where m.plan_key = pl.key',
      '  );',
    ].join('\n');

    expect(findingsInSource('migrations/x.sql', source)).toEqual([]);
  });

  it('reports a targeted delete that still has no predicate', () => {
    const source = "delete from public.subscription_plans where key = 'pro';";
    expect(findingsInSource('migrations/x.sql', source).map((finding) => finding.line)).toEqual([
      1,
    ]);
  });

  it('matches a quoted schema and reports the line it starts on', () => {
    const source = ['select 1;', '', '"DELETE FROM "public"."subscription_plans";'].join('\n');
    expect(findingsInSource('migrations/x.sql', source).map((finding) => finding.line)).toEqual([
      3,
    ]);
  });

  it('does not report the rule in a comment', () => {
    const source = [
      '-- a sweep must add: delete from public.subscription_plans ... and visibility = $$public$$',
      '/* delete from public.subscription_plans; */',
      'select 1;',
    ].join('\n');

    expect(findingsInSource('migrations/x.sql', source)).toEqual([]);
  });

  it('skips an allowlisted file even without the predicate', () => {
    const source = 'delete from public.subscription_plans pl;';
    expect(findingsInSource('migrations/x.sql', source, true)).toEqual([]);
  });
});
