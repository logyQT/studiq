import postgres from 'postgres';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/** The catalog check reads `pg_constraint`, so it needs the direct connection. */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      "org-role-permission-key-fk needs SUPABASE_DB_URL pointing at this checkout's local " +
        'Supabase to read the foreign key. Run the suite through ' +
        '`bun run env:run -- bun run test:integration`.',
    );
  }
  return localDatabaseUrl;
}

// Phase 2b renames `org_role_permissions.permission_name` to `permission_key` and
// points it at `permissions(key)`. Two things about that are invisible from the
// migration text:
//
//   1. Supabase records a migration as applied from the file name, so a renumbered
//      file whose ledger entry already exists is skipped while every later
//      migration still runs. This schema then has no `permission_key`, and every
//      later `create or replace function` that writes it fails on its first call —
//      which is exactly how a half-applied database fails, long after the reset.
//   2. The scope CHECK accepts only the three scopes the editor can send, so a
//      write that worked before (`any`/`granted`, which nothing resolved) now fails.
//
// Every refusal names the constraint it came from: `23503` alone is what a dropped
// `org_role_id` foreign key also returns, so a constraint that silently stopped
// being enforced would otherwise pass this suite.
//
// #961 adds `guard_org_role_permission_scope`, a BEFORE INSERT OR UPDATE trigger
// that refuses any (key, scope) pair outside `permissions.allowed_scopes` with
// `22023`. It fires before both constraints below, so the two refusal tests assert
// the guard's code and message. The constraints are pinned separately, with the
// trigger disabled inside a transaction that rolls back.

describe('org_role_permissions.permission_key', () => {
  const service: SupabaseClient<Database> = createServiceClient();
  let orgId: string;
  let customRoleId: string;

  beforeAll(async () => {
    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: `permission-key-${crypto.randomUUID().slice(0, 8)}` })
      .select('id')
      .single();
    if (orgError) throw new Error(`org create failed: ${orgError.message}`);
    orgId = org.id;

    const { data: customRole, error: customError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: `custom-${crypto.randomUUID().slice(0, 8)}`,
        display_name: 'Custom',
        description: null,
        is_system: false,
      })
      .select('id')
      .single();
    if (customError) throw new Error(`custom role create failed: ${customError.message}`);
    customRoleId = customRole.id;
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('refuses a key the catalog does not know, before the foreign key sees it', async () => {
    const { error } = await service.from('org_role_permissions').insert({
      org_role_id: customRoleId,
      permission_key: 'deck.publish',
      scope: 'own',
    });

    // The service maps this to BAD_REQUEST; `org-role.service.test.ts` pins that.
    expect(error?.code).toBe('22023');
    expect(error?.message).toMatch(/scope own is not allowed for deck\.publish/);
  });

  it('refuses a scope outside own | group | organization, before the scope CHECK sees it', async () => {
    for (const scope of ['any', 'granted']) {
      const { error } = await service.from('org_role_permissions').insert({
        org_role_id: customRoleId,
        permission_key: 'topic.read',
        scope,
      });
      expect(error?.code, `${scope} is outside the closed set`).toBe('22023');
      expect(error?.message, `${scope} is refused by the catalog guard`).toMatch(
        new RegExp(`scope ${scope} is not allowed for topic\\.read`),
      );
    }
  });

  /**
   * Insert through the direct connection with the catalog guard disabled for one
   * transaction. The rollback restores the trigger, so no later test sees it off.
   */
  async function insertWithCatalogGuardDisabled(values: {
    permissionKey: string;
    scope: string;
  }): Promise<{ code: string; message: string }> {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe('begin');
      await sql.unsafe(
        'alter table public.org_role_permissions disable trigger guard_org_role_permission_scope',
      );
      try {
        await sql.unsafe(
          `insert into public.org_role_permissions (org_role_id, permission_key, scope)
           values ($1, $2, $3)`,
          [customRoleId, values.permissionKey, values.scope],
        );
        throw new Error('the insert was accepted; the constraint under test did not fire');
      } finally {
        await sql.unsafe('rollback');
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        return {
          code: String(error.code),
          message: 'message' in error ? String(error.message) : '',
        };
      }
      throw error;
    } finally {
      await sql.end();
    }
  }

  it('keeps the foreign key refusing an unknown key when the catalog guard is off', async () => {
    const { code, message } = await insertWithCatalogGuardDisabled({
      permissionKey: 'deck.publish',
      scope: 'own',
    });
    expect(code).toBe('23503');
    expect(message).toMatch(/org_role_permissions_permission_key_fkey/);
  });

  it('keeps the scope CHECK refusing any | granted when the catalog guard is off', async () => {
    for (const scope of ['any', 'granted']) {
      const { code, message } = await insertWithCatalogGuardDisabled({
        permissionKey: 'topic.read',
        scope,
      });
      expect(code, `${scope} is outside the closed set`).toBe('23514');
      expect(message, `${scope} is refused by the scope CHECK`).toMatch(
        /org_role_permissions_scope_check/,
      );
    }
  });

  it('round-trips a catalog key at a scope the editor can send', async () => {
    const { error } = await service.from('org_role_permissions').insert({
      org_role_id: customRoleId,
      permission_key: 'deck.read',
      scope: 'group',
    });
    expect(error).toBeNull();

    const { data, error: readError } = await service
      .from('org_role_permissions')
      .select('permission_key, scope')
      .eq('org_role_id', customRoleId);
    expect(readError).toBeNull();
    expect(dbRows(data)).toEqual([{ permission_key: 'deck.read', scope: 'group' }]);
  });

  // With the guard off, the foreign key is the only thing that can answer for an
  // unknown key, and it must still point at `public.permissions`: a dropped or
  // misdirected constraint would leave the `23503` case above to a different
  // constraint (the `org_role_id` foreign key) and the suite green.
  it('keeps the foreign key pointing at public.permissions', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      const rows = await sql.unsafe<{ confrelid: string; confdeltype: string }[]>(
        `select confrelid::regclass::text as confrelid, confdeltype
           from pg_constraint
          where conname = 'org_role_permissions_permission_key_fkey'
            and conrelid = 'public.org_role_permissions'::regclass`,
      );
      expect(rows).toEqual([{ confrelid: 'permissions', confdeltype: 'a' }]);
    } finally {
      await sql.end();
    }
  });
});
