import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `db reset` and `db push` must end with the same privileges. They did not while
// `supabase/seeds/99_dev_grants.sql` existed: the seed ran after every migration,
// re-opened `GRANT ALL ON ALL TABLES`, blanket-revoked function EXECUTE and then
// re-granted a hand-maintained allowlist — a second grant system that production
// (`db push` never runs seeds) did not have. 2a-2 is the cost on record: every
// role write answered 42501 after a reset while the suite stayed green, because
// the allowlist was missing the helper its own policies call (R19).
//
// The seed is gone and the migrations own grants. This file is the guard that was
// missing. It reads `pg_catalog` instead of listing names, so a new policy or a
// new revoked column is covered the day it lands; only the sensitive-column
// contract is enumerated, because that one is a product decision per column.
//
// Each assertion fails in the direction drift actually takes it: a blanket
// `GRANT ALL ON ALL TABLES … TO authenticated`, an `ALTER DEFAULT PRIVILEGES`
// grant to `anon`, or a dropped `GRANT EXECUTE` on a helper a policy calls.

  // `entitlement_catalog` is pricing metadata: `PlanInfo.seatEligible` embeds it
  // from `plan_entitlements` on every plan read, and the public catalogue is
  // anonymous (phase 4a).
  const PRICING_TABLES = [
    'entitlement_catalog',
    'plan_entitlements',
    'plan_limits',
    'subscription_plans',
  ];

/** Columns an answer key may not leak to a signed-in session. */
const ANSWER_KEY_COLUMNS: Array<[table: string, column: string]> = [
  ['question_options', 'is_correct'], // #1165/#1170
  ['questions', 'model_answer'], // #1173
  ['questions', 'explanation'], // #1180 — granted by 20261115120000, closed by 20261115130000
  ['questions', 'search_vector'],
  ['assignment_questions', 'snapshot_key'], // #1171 — frozen key, service role only
];

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/**
 * A run without the direct connection must fail, not skip: a skipped parity check
 * is exactly the green-on-a-broken-database state it exists to prevent (R19).
 */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      "grant-parity needs SUPABASE_DB_URL pointing at this checkout's local Supabase. " +
        'Run the suite through `bun run env:run -- bun run test:integration`.',
    );
  }
  return localDatabaseUrl;
}

describe('reset and db push end with the same grants', () => {
  let sql: ReturnType<typeof postgres>;
  /**
   * Highest `pg_proc` oid at the start of this file. Other integration files run
   * in parallel lanes and create throwaway functions (`public.test_reject_answer_insert`,
   * `public.test_fail_group_member_*`) with later oids; those are not the
   * migration contract and would make the catalog assertions flake.
   */
  let maxMigrationOid: number;

  beforeAll(async () => {
    sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    const [ceiling] = await sql<Array<{ ceiling: string }>>`
      select coalesce(max(oid), 0)::text as ceiling
      from pg_proc
      where pronamespace = 'public'::regnamespace`;
    maxMigrationOid = Number(ceiling.ceiling);
  });

  afterAll(async () => {
    await sql.end();
  });

  it('lets authenticated execute every RLS helper a policy calls', async () => {
    // Derived from the policy text, not from a list: the 2a-2 defect was a
    // helper that a policy called and no grant covered.
    const helpers = await sql<Array<{ helper: string }>>`
      select distinct m[1] as helper
      from pg_policies p
      cross join lateral regexp_matches(
        coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
        'rls_caller_[a-z_]+',
        'g'
      ) as m
      where p.schemaname = 'public'
      order by 1`;

    // Control: the extraction found the 2a-2 predicate, so an empty or broken
    // match cannot make the loop below pass vacuously.
    expect(helpers.map((row) => row.helper)).toContain('rls_caller_has_permission');

    for (const { helper } of helpers) {
      const overloads = await sql<Array<{ signature: string; executable: boolean }>>`
        select p.oid::regprocedure::text as signature,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as executable
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = ${helper}
        order by 1`;

      expect(
        overloads.length,
        `${helper} is referenced by a policy but does not exist`,
      ).toBeGreaterThan(0);
      for (const { signature, executable } of overloads) {
        expect(executable, `authenticated may execute ${signature}`).toBe(true);
      }
    }
  });

  it('keeps the answer-key columns unreadable by authenticated', async () => {
    for (const [table, column] of ANSWER_KEY_COLUMNS) {
      const [row] = await sql<Array<{ selectable: boolean }>>`
        select has_column_privilege('authenticated', ${`public.${table}`}, ${column}, 'SELECT')
               as selectable`;
      expect(row.selectable, `authenticated cannot select ${table}.${column}`).toBe(false);
    }

    // The mechanism: the table-wide grant is gone and the reader columns are
    // re-granted by name. A blanket `GRANT ALL ON ALL TABLES` restores both.
    for (const table of ['questions', 'question_options', 'assignment_questions']) {
      const [row] = await sql<Array<{ selectable: boolean }>>`
        select has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') as selectable`;
      expect(row.selectable, `authenticated has no table-wide SELECT on ${table}`).toBe(false);
    }

    // Positive control: the same call says yes for a value column on the table
    // whose frozen key is revoked, so the assertions above are not passing
    // because the argument order is wrong.
    const [value] = await sql<Array<{ selectable: boolean }>>`
      select has_column_privilege(
               'authenticated', 'public.assignment_questions', 'snapshot', 'SELECT'
             ) as selectable`;
    expect(value.selectable, 'authenticated selects assignment_questions.snapshot').toBe(true);
  });

  it('gives anon SELECT on the pricing tables and nothing else', async () => {
    const granted = await sql<Array<{ table: string; privilege: string }>>`
      select c.relname as table, a.privilege_type as privilege
      from pg_class c
      cross join lateral aclexplode(c.relacl) a
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and a.grantee::regrole::text = 'anon'
      order by 1, 2`;

    expect(granted.map((row) => `${row.table}|${row.privilege}`)).toEqual(
      PRICING_TABLES.map((table) => `${table}|SELECT`).toSorted(),
    );

    // Reading them needs schema USAGE; a function anon can execute is the other
    // way a blanket grant leaks (`ALTER DEFAULT PRIVILEGES … GRANT ALL`).
    const [schema] = await sql<Array<{ usable: boolean }>>`
      select has_schema_privilege('anon', 'public', 'USAGE') as usable`;
    expect(schema.usable, 'anon can reach the pricing tables').toBe(true);

    const executable = await sql<Array<{ signature: string }>>`
      select p.oid::regprocedure::text as signature
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.oid <= ${maxMigrationOid}
        and has_function_privilege('anon', p.oid, 'EXECUTE')
      order by 1`;
    expect(
      executable.map((row) => row.signature),
      'anon executes no public function',
    ).toEqual([]);
  });

  it('keeps the destructive table privileges off authenticated', async () => {
    // TRUNCATE bypasses RLS, and the three are what
    // `20261024124757_rls_function_and_grant_hardening.sql` revokes after the
    // blanket grant. (MAINTAIN is not asserted: `20260703000008` granted ALL
    // before PostgreSQL 17 added it, so it is present on both a reset and a
    // deploy — parity, not a leak through PostgREST, which issues none of them.)
    const destructive = await sql<Array<{ table: string; privilege: string }>>`
      select c.relname as table, a.privilege_type as privilege
      from pg_class c
      cross join lateral aclexplode(c.relacl) a
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and a.grantee::regrole::text = 'authenticated'
        and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
      order by 1, 2`;

    expect(destructive.map((row) => `${row.table}|${row.privilege}`)).toEqual([]);
  });
});
