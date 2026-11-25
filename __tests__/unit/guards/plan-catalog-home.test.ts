/**
 * Guard for #1494: the plan catalogue has one home — the migration chain.
 *
 * Before the fix `supabase/seeds/00_plans.sql` DELETEd and re-inserted every
 * `subscription_plans`, `plan_entitlements` and `plan_limits` row, so `db reset`
 * and CI read the matrix from the seed while production (`db push`, which never
 * runs seeds) had none. A plan row added by a migration was silently wiped on
 * the next reset. The catalogue now lives in
 * `20261125170000_plan_catalog_owned_by_migrations.sql`, and the seed file stays
 * only because `supabase/config.toml` references `./seeds/*.sql`.
 *
 * This is a source scan, not a behavioural test: it needs no database, and it
 * fails in both directions — a write reintroduced under `supabase/seeds/` is
 * reported, and the seed directory / `00_plans.sql` disappearing (which would
 * make the scan vacuous) is reported too. The matcher is exercised against
 * synthetic sources below so the scan itself cannot silently stop matching.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SEEDS_ROOT = path.join(process.cwd(), 'supabase/seeds');

/** The tables the migration owns; a seed write to any of them is a second home. */
const OWNED_TABLES = [
  'subscription_plans',
  'plan_entitlements',
  'plan_limits',
  'entitlement_flags',
] as const;

/** `INSERT INTO` / `UPDATE` / `DELETE FROM` / `TRUNCATE` against an owned table. */
const TABLE_WRITE_PATTERN = new RegExp(
  String.raw`\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+` +
    String.raw`(?:public\.)?(?:${OWNED_TABLES.join('|')})\b`,
  'gi',
);

type SeedWrite = { file: string; line: number; statement: string };

function relative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

function sqlFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sqlFiles(target));
      continue;
    }
    if (entry.name.endsWith('.sql')) files.push(target);
  }
  return files;
}

/** Every owned-table write in one SQL source, with file and line. */
function writesInSource(file: string, source: string): SeedWrite[] {
  // Identifiers are quoted in some seed files (`"public"."organizations"`), so
  // the scan normalizes the quotes instead of trying to match both spellings
  // with one pattern.
  const normalized = source.replaceAll('"', '');
  const writes: SeedWrite[] = [];
  for (const match of normalized.matchAll(TABLE_WRITE_PATTERN)) {
    const line = normalized.slice(0, match.index).split('\n').length;
    writes.push({ file, line, statement: match[0].replaceAll(/\s+/g, ' ') });
  }
  return writes;
}

function seedWrites(): SeedWrite[] {
  return sqlFiles(SEEDS_ROOT).flatMap((file) =>
    writesInSource(relative(file), fs.readFileSync(file, 'utf8')),
  );
}

const REMEDY =
  'the plan catalogue is migration-owned: put plan/entitlement/limit/flag rows in ' +
  'supabase/migrations/ (see 20261125170000_plan_catalog_owned_by_migrations.sql), ' +
  'never in supabase/seeds/';

describe('the plan catalogue has one home (#1494)', () => {
  it('keeps the seed file config.toml references', () => {
    expect(sqlFiles(SEEDS_ROOT).map(relative)).toContain('supabase/seeds/00_plans.sql');
  });

  it('scans a non-empty set of seed files', () => {
    // A missing or empty directory would make the main assertion pass for the
    // wrong reason; the seed directory carries the demo seeds too.
    expect(sqlFiles(SEEDS_ROOT).length).toBeGreaterThan(3);
  });

  it('no file under supabase/seeds writes a migration-owned plan table', () => {
    const writes = seedWrites().map(
      (write) => `${write.file}:${write.line} writes ${write.statement} — ${REMEDY}`,
    );
    expect(writes).toEqual([]);
  });
});

describe('writesInSource()', () => {
  it('reports each write shape against every owned table', () => {
    const source = [
      'INSERT INTO public.subscription_plans (key) VALUES ($$base$$);',
      'insert into "public"."plan_entitlements" (plan_key) values ($$base$$);',
      'UPDATE subscription_plans SET is_active = false;',
      'delete from public.plan_limits where plan_key = $$base$$;',
      'TRUNCATE TABLE public.entitlement_flags;',
    ].join('\n');

    expect(writesInSource('seeds/x.sql', source).map((write) => write.line)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('reports the line of a write on a later line', () => {
    const source = 'select 1;\n\n  delete from public.plan_limits;\n';
    expect(writesInSource('seeds/x.sql', source)).toEqual([
      { file: 'seeds/x.sql', line: 3, statement: 'delete from public.plan_limits' },
    ]);
  });

  it('does not report reads or a table name that only appears in a comment', () => {
    const source = [
      '-- the plan_entitlements matrix lives in the migration',
      'select * from public.subscription_plans;',
      'select count(*) from plan_limits;',
    ].join('\n');
    expect(writesInSource('seeds/x.sql', source)).toEqual([]);
  });
});
