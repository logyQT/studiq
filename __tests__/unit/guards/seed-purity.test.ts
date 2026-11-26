/**
 * Guard for #1502, extending #1494: `supabase/seeds/` holds test data only.
 *
 * A reset without the seeds must still give a working app, so app
 * configuration and schema belong in `supabase/migrations/`. Two seed files
 * broke that rule:
 *
 * - `09_perms.sql` re-inserted the closed `permissions` catalog (already
 *   inserted by the migration chain) and re-ran `seed_system_role_permissions`
 *   for every org;
 * - `99_realtime.sql` dropped and re-created the `supabase_realtime`
 *   publication and added tables to it, although the app has no realtime
 *   client.
 *
 * #1494 closed the same hole for the plan catalogue: `00_plans.sql` DELETEd and
 * re-inserted every `subscription_plans`, `plan_entitlements` and `plan_limits`
 * row, so `db reset` and CI read the matrix from the seed while production
 * (`db push`, which never runs seeds) had none.
 *
 * This is a source scan, not a behavioural test: it needs no database, and it
 * fails in both directions — a config write or DDL reintroduced under
 * `supabase/seeds/` is reported, and the seed directory / `00_plans.sql`
 * disappearing (which would make the scan vacuous) is reported too. The matcher
 * is exercised against synthetic sources below so the scan itself cannot
 * silently stop matching.
 *
 * The scan covers the files `[db.seed] sql_paths = ['./seeds/*.sql']` runs:
 * the top-level `*.sql` files only. `supabase/seeds/demo/*.sql` is demo content
 * outside that glob, so its `CREATE TEMP TABLE` statements are not part of the
 * seed set and are not scanned.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SEEDS_ROOT = path.join(process.cwd(), 'supabase/seeds');
const CONFIG_FILE = path.join(process.cwd(), 'supabase/config.toml');

/** Configuration tables a seed must never write; the migration chain owns them. */
const CONFIG_TABLES = [
  'permissions',
  'subscription_plans',
  'plan_entitlements',
  'plan_limits',
  'entitlement_catalog',
  'entitlement_flags',
  'limit_catalog',
] as const;

/**
 * `INSERT INTO` / `UPDATE` / `DELETE FROM` / `TRUNCATE` / `MERGE INTO` / `COPY`
 * against a config table.
 */
const TABLE_WRITE_PATTERN = new RegExp(
  String.raw`\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?|merge\s+into|copy)\s+` +
    String.raw`(?:public\.)?(?:${CONFIG_TABLES.join('|')})\b`,
  'gi',
);

/**
 * A `do` block. `codeOnly()` blanks its dollar-quoted body, so the statement is
 * opaque: any write can be inside it. The `on conflict … do nothing` / `do
 * update` forms are the only `do` in ordinary DML and stay out.
 */
const DO_PATTERN = /\bdo\b(?!\s+(?:nothing|update)\b)/gi;

/** A `public.*` function call from `select`/`perform`; the body may write config. */
const FUNCTION_CALL_PATTERN = /\b(?:select|perform)\b[^;]*?\bpublic\.\w+\s*\(/gi;

/** DDL a seed must never run: the migration chain owns schema and grants. */
const DDL_PATTERN = /\b(?:create|alter|drop|grant|revoke|publication)\b/gi;

type SeedFinding = { file: string; line: number; statement: string };

function relative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

/** Top-level `*.sql` files, the set `[db.seed] sql_paths = ['./seeds/*.sql']` runs. */
function seedFiles(): string[] {
  return fs
    .readdirSync(SEEDS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => path.join(SEEDS_ROOT, entry.name));
}

/** The `[db.seed] sql_paths` entries `config.toml` declares. */
function configuredSeedPaths(): string[] {
  const config = fs.readFileSync(CONFIG_FILE, 'utf8');
  const block = /sql_paths\s*=\s*\[([^\]]*)\]/.exec(config);
  return [...(block?.[1] ?? '').matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
}

/** Replace every character except a newline, so line numbers survive the strip. */
function blank(text: string): string {
  return text.replaceAll(/[^\n]/g, ' ');
}

/** Remove SQL comments and string literals. */
function codeOnly(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, blank)
    .replaceAll(/--[^\n]*/g, '')
    .replaceAll(/'(?:''|[^'])*'/g, blank)
    .replaceAll(/\$(\w*)\$[\s\S]*?\$\1\$/g, blank);
}

function statementAt(source: string, index: number): string {
  const start = source.lastIndexOf('\n', index) + 1;
  const end = source.indexOf('\n', index);
  return source
    .slice(start, end === -1 ? undefined : end)
    .trim()
    .replaceAll(/\s+/g, ' ');
}

/** Every config-table write and DDL statement in one SQL source, with file and line. */
function findingsInSource(file: string, source: string): SeedFinding[] {
  // Identifiers are quoted in some seed files (`"public"."organizations"`), so
  // the scan normalizes the quotes instead of trying to match both spellings
  // with one pattern.
  const normalized = codeOnly(source).replaceAll('"', '');
  const findings = new Map<string, SeedFinding>();
  for (const pattern of [TABLE_WRITE_PATTERN, DO_PATTERN, FUNCTION_CALL_PATTERN, DDL_PATTERN]) {
    for (const match of normalized.matchAll(pattern)) {
      const line = normalized.slice(0, match.index).split('\n').length;
      const statement = statementAt(normalized, match.index);
      // Two keywords on one statement (`create publication …`) are one finding.
      findings.set(`${line}:${statement}`, { file, line, statement });
    }
  }
  return [...findings.values()].toSorted((a, b) => a.line - b.line);
}

function seedFindings(): SeedFinding[] {
  return seedFiles().flatMap((file) =>
    findingsInSource(relative(file), fs.readFileSync(file, 'utf8')),
  );
}

const REMEDY =
  'seeds hold test data only: put configuration tables and DDL in supabase/migrations/ ' +
  '(see 20261125170000_plan_catalog_owned_by_migrations.sql), never in supabase/seeds/';

describe('supabase/seeds holds test data only (#1502)', () => {
  it('scans exactly the files the seed glob runs', () => {
    // The parsed list, not a substring: a second `sql_paths` entry (such as
    // `./seeds/demo/*.sql`) would put files outside the scan's reach.
    expect(configuredSeedPaths()).toEqual(['./seeds/*.sql']);

    const files = seedFiles().map(relative);
    expect(files).toContain('supabase/seeds/00_plans.sql');
    expect(files).toContain('supabase/seeds/01_seed.sql');
  });

  it('scans a non-empty set of seed files', () => {
    // A missing or empty top-level set would make the main assertion pass for
    // the wrong reason.
    expect(seedFiles().length).toBeGreaterThan(0);
  });

  it('no seed writes a config table or runs DDL', () => {
    const findings = seedFindings().map(
      (finding) => `${finding.file}:${finding.line} runs ${finding.statement} — ${REMEDY}`,
    );
    expect(findings).toEqual([]);
  });
});

describe('findingsInSource()', () => {
  it('reports a write against every config table', () => {
    const source = CONFIG_TABLES.map(
      (table) => `insert into public.${table} (key) values ('x');`,
    ).join('\n');

    expect(findingsInSource('seeds/x.sql', source).map((finding) => finding.line)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('reports every write shape and quoted identifiers', () => {
    const source = [
      'INSERT INTO public.permissions (key) VALUES ($$base$$);',
      'insert into "public"."plan_entitlements" (plan_key) values ($$base$$);',
      'UPDATE subscription_plans SET is_active = false;',
      'delete from public.plan_limits where plan_key = $$base$$;',
      'TRUNCATE TABLE public.entitlement_flags;',
    ].join('\n');

    expect(findingsInSource('seeds/x.sql', source).map((finding) => finding.line)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('reports every DDL keyword', () => {
    const source = [
      'CREATE TABLE public.x (id int);',
      'alter table public.permissions add column x int;',
      'DROP TABLE public.x;',
      'grant select on public.x to anon;',
      'revoke all on public.x from anon;',
      'create publication supabase_realtime;',
      'alter publication supabase_realtime add table public.x;',
    ].join('\n');

    expect(findingsInSource('seeds/x.sql', source).map((finding) => finding.line)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('reports a do block, whose blanked body is opaque', () => {
    const source = [
      'select 1;',
      "do $$ begin insert into public.permissions (key) values ('base'); end $$;",
    ].join('\n');
    expect(findingsInSource('seeds/x.sql', source).map((finding) => finding.line)).toEqual([2]);
  });

  it('reports merge into a config table', () => {
    const source =
      'merge into public.permissions as p using (select $$base$$ as key) as v on p.key = v.key ' +
      'when not matched then insert (key) values (v.key);';
    expect(findingsInSource('seeds/x.sql', source).map((finding) => finding.line)).toEqual([1]);
  });

  it('reports copy against a config table', () => {
    const source = "copy public.permissions (key) from '/tmp/permissions.csv';";
    expect(findingsInSource('seeds/x.sql', source).map((finding) => finding.line)).toEqual([1]);
  });

  it('reports a public function call from select or perform', () => {
    const source = [
      'select public.seed_system_role_permissions(id) from public.organizations;',
      'perform public.seed_system_role_permissions(id);',
    ].join('\n');
    expect(findingsInSource('seeds/x.sql', source).map((finding) => finding.line)).toEqual([1, 2]);
  });

  it('reports the line and statement of a write on a later line', () => {
    const source = 'select 1;\n\n  delete from public.plan_limits;\n';
    expect(findingsInSource('seeds/x.sql', source)).toEqual([
      { file: 'seeds/x.sql', line: 3, statement: 'delete from public.plan_limits;' },
    ]);
  });

  it('does not report reads, other tables, or text in a comment or a string', () => {
    const source = [
      '-- CREATE PUBLICATION belongs in a migration, never here',
      '-- DELETE FROM public.permissions is forbidden too',
      '/* DROP TABLE public.plan_limits; */',
      'select * from public.subscription_plans;',
      'select count(*) from plan_limits;',
      "insert into public.organizations (id, name) values ($$org$$, 'Create and drop');",
      "insert into public.topics (name) values ('grant revoked');",
      'insert into public.topics (id) values (1) on conflict (id) do nothing;',
      'insert into public.topics (id) values (1) on conflict (id) do update set name = $$x$$;',
    ].join('\n');
    expect(findingsInSource('seeds/x.sql', source)).toEqual([]);
  });
});
