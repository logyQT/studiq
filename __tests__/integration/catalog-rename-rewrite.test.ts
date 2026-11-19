import postgres from 'postgres';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';
import { latestShippedFunction } from '#test/integration/test-utils';

// `public.migrate_org_role_permission_names()` is the replayable form of the
// rewrite: phase 1b ran it inline (a `db reset` executes migrations before any
// organization exists, so it only ever acted on production rows), phase 2b calls
// it again before the rename and re-creates it against `permission_key`. The
// callable form is the contract, so it has to keep working on a database that
// already has the foreign key — which is what this suite calls.
//
// The body installed here is the shipped post-rename one, read from the migration
// rather than copied, so an edit to that file reaches the database and this suite
// can see it.

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/**
 * The database URL the install needs. A run without it must fail instead of
 * skipping: skipping would leave the suite asserting against whatever body a
 * previous run installed, so the pre-rename body would survive its own file.
 */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      "catalog-rename-rewrite needs SUPABASE_DB_URL pointing at this checkout's local " +
        'Supabase to install the shipped function. Run the suite through ' +
        '`bun run env:run -- bun run test:integration`: a bare `bun run test:integration` ' +
        'in a fresh worktree has no database URL, and skipping the install would let a ' +
        'reverted body pass.',
    );
  }
  return localDatabaseUrl;
}

const SHIPPED_FUNCTION = latestShippedFunction('migrate_org_role_permission_names');
if (!SHIPPED_FUNCTION.includes('permission_key')) {
  throw new Error("latestShippedFunction returned phase 1b's pre-rename body");
}

async function withDirect<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** The rows a role holds, as `key@scope`, for a before/after comparison. */
function fingerprint(rows: Array<{ permission_key: string; scope: string }>): string[] {
  return rows.map((row) => `${row.permission_key}@${row.scope}`).toSorted();
}

describe('org_role_permissions catalog rewrite (migrate_org_role_permission_names)', () => {
  const service: SupabaseClient<Database> = createServiceClient();
  let orgId: string;
  let roleIds: string[];

  /** Every row the org trigger seeded, read through PostgREST in the renamed column. */
  async function orgRows(): Promise<Array<{ permission_key: string; scope: string }>> {
    const { data, error } = await service
      .from('org_role_permissions')
      .select('permission_key, scope')
      .in('org_role_id', roleIds);
    if (error) throw new Error(`role permissions read failed: ${error.message}`);
    return dbRows(data);
  }

  async function rewrite(): Promise<void> {
    const { error } = await service.rpc('migrate_org_role_permission_names');
    expect(error, 'the replay must not raise').toBeNull();
  }

  beforeAll(async () => {
    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: `catalog-rewrite-${crypto.randomUUID().slice(0, 8)}` })
      .select('id')
      .single();
    if (orgError) throw new Error(`org create failed: ${orgError.message}`);
    orgId = org.id;

    const { data: roles, error: rolesError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId);
    if (rolesError) throw new Error(`role read failed: ${rolesError.message}`);
    roleIds = dbRows(roles).map((role) => role.id);

    await withDirect((sql) => sql.unsafe(SHIPPED_FUNCTION));
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('runs on a database with catalog rows without raising, and is idempotent', async () => {
    const before = fingerprint(await orgRows());
    // The rows the org trigger writes are catalog keys, so nothing moves: this is
    // the replay drive on a populated database, not a rewrite. The trigger seeds
    // admin, teacher and member, so the batch is real rows and `permissions` is
    // full — the state in which the sweep actually runs.
    expect(roleIds.length).toBe(3);
    expect(before.length).toBeGreaterThan(0);

    await rewrite();
    const afterFirst = fingerprint(await orgRows());
    await rewrite();
    const afterSecond = fingerprint(await orgRows());

    expect(afterFirst).toEqual(before);
    expect(afterSecond).toEqual(before);
  });

  // The reachable half: an unknown key cannot be inserted while the foreign key
  // exists, so an out-of-catalog row is one the catalog left behind. Reaching that
  // state means the catalog moved while the constraint was not enforcing, so the
  // constraint is dropped and restored inside the same rolled-back transaction —
  // the only way to build the input this sweep exists for.
  it('sweeps a role row whose catalog row has been removed', async () => {
    const before = fingerprint(await orgRows());
    const key = 'deck.read';
    // Rows written after the foreign key existed hold catalog keys only; the one
    // this test takes out of the catalog is the trigger's own group-scoped read.
    expect(before).toContain(`${key}@group`);

    await withDirect(async (sql) => {
      await sql
        .begin(async (tx) => {
          await tx.unsafe(
            'alter table public.org_role_permissions drop constraint org_role_permissions_permission_key_fkey',
          );
          await tx.unsafe('delete from public.permissions where key = $1', [key]);
          await tx.unsafe(
            'alter table public.org_role_permissions add constraint org_role_permissions_permission_key_fkey foreign key (permission_key) references public.permissions(key) not valid',
          );

          const missing = await tx.unsafe<{ n: number }[]>(
            `select count(*)::int as n from public.org_role_permissions
             where org_role_id = any($1::uuid[])
               and not exists (select 1 from public.permissions p where p.key = permission_key)`,
            [roleIds],
          );
          expect(missing[0]?.n, `${key} rows are out of catalog before the run`).toBeGreaterThan(0);

          await tx.unsafe('select public.migrate_org_role_permission_names()');

          const left = await tx.unsafe<{ n: number }[]>(
            `select count(*)::int as n from public.org_role_permissions where permission_key = $1`,
            [key],
          );
          expect(left[0]?.n, `${key} rows are swept`).toBe(0);

          // The catalog-valid rows the trigger wrote are untouched by the sweep.
          const survivors = await tx.unsafe<{ n: number }[]>(
            `select count(*)::int as n from public.org_role_permissions
             where org_role_id = any($1::uuid[])`,
            [roleIds],
          );
          expect(survivors[0]?.n, 'the catalog-valid rows survive').toBe(
            before.length - missing[0]!.n,
          );

          const stillOut = await tx.unsafe<{ n: number }[]>(
            `select count(*)::int as n from public.org_role_permissions
             where not exists (select 1 from public.permissions p where p.key = permission_key)`,
          );
          expect(stillOut[0]?.n, 'no out-of-catalog row survives').toBe(0);

          // The catalog row and the constraint go back with the rollback.
          throw new Error('rollback: catalog restored');
        })
        .catch((error: Error) => {
          if (!error.message.startsWith('rollback:')) throw error;
        });
    });

    // Rolled back: the catalog and this org's rows are exactly as before.
    const { data: catalogRow } = await service
      .from('permissions')
      .select('key')
      .eq('key', key)
      .maybeSingle();
    expect(catalogRow?.key).toBe(key);
    expect(fingerprint(await orgRows())).toEqual(before);
  });
});
