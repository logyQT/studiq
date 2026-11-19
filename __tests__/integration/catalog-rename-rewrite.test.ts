import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// Phase 1b rewrites the `org_role_permissions` rows of existing organizations to
// the closed catalog. A `db reset` runs that migration before any organization
// exists, so the inline form was a no-op in every automated run — the statement
// list now ships as `migrate_org_role_permission_names()` precisely so this
// suite can exercise it on real rows.
//
// The function is read from the migration verbatim and installed over the direct
// connection before it is called through PostgREST (same harness as
// `student-answers-dedupe.test.ts`): a copy here could pass while production
// ships something else, and mutating the shipped statement has to turn this
// suite red.

const MIGRATION = 'supabase/migrations/20261119140000_catalog_rename.sql';

const shippedFunction = (() => {
  const source = readFileSync(MIGRATION, 'utf8');
  const start = source.indexOf(
    'create or replace function public.migrate_org_role_permission_names()',
  );
  if (start < 0) throw new Error(`${MIGRATION} has no migrate_org_role_permission_names()`);
  const bodyStart = source.indexOf('$$', start);
  const bodyEnd = source.indexOf('$$;', bodyStart + 2);
  if (bodyEnd < 0) throw new Error(`${MIGRATION} has an unterminated function body`);
  return source.slice(start, bodyEnd + 3);
})();

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/** Rows whose names the old role editor could have written by hand. */
const LEGACY_AND_INVALID = [
  'member.manage',
  'role.builder',
  'org.manage',
  'ai.chat',
  'documents',
  'study.create',
  'deck.publish',
];

describe('org_role_permissions catalog rewrite (phase 1b)', () => {
  const service: SupabaseClient<Database> = createServiceClient();
  let orgId: string;
  let adminRoleId: string;
  let customRoleId: string;
  let adminBefore: Array<[string, string]>;

  async function roleRows(roleId: string): Promise<Array<[string, string]>> {
    const { data, error } = await service
      .from('org_role_permissions')
      .select('permission_name, scope')
      .eq('org_role_id', roleId)
      .order('permission_name');
    if (error) throw new Error(`role permissions read failed: ${error.message}`);
    return dbRows(data).map((row) => [row.permission_name, row.scope]);
  }

  async function rewrite(): Promise<void> {
    const { error } = await service.rpc('migrate_org_role_permission_names');
    expect(error).toBeNull();
  }

  beforeAll(async () => {
    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: `catalog-rewrite-${crypto.randomUUID().slice(0, 8)}` })
      .select('id')
      .single();
    if (orgError) throw new Error(`org create failed: ${orgError.message}`);
    orgId = org.id;

    const { data: adminRole, error: adminError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    if (adminError) throw new Error(`admin role read failed: ${adminError.message}`);
    adminRoleId = adminRole.id;

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

    // Both names on the same role exercises the dedupe (the unique key is
    // `(org_role_id, permission_name)`), and the rest covers the mapping, the
    // entitlement-name deletes and the catalog sweep.
    const { error: seedError } = await service.from('org_role_permissions').insert([
      { org_role_id: customRoleId, permission_name: 'member.manage', scope: 'own' },
      { org_role_id: customRoleId, permission_name: 'org.member.manage', scope: 'group' },
      { org_role_id: customRoleId, permission_name: 'role.builder', scope: 'own' },
      { org_role_id: customRoleId, permission_name: 'org.manage', scope: 'organization' },
      { org_role_id: customRoleId, permission_name: 'ai.chat', scope: 'own' },
      { org_role_id: customRoleId, permission_name: 'documents', scope: 'own' },
      { org_role_id: customRoleId, permission_name: 'study.create', scope: 'own' },
      { org_role_id: customRoleId, permission_name: 'deck.publish', scope: 'own' },
    ]);
    if (seedError) throw new Error(`role permission seed failed: ${seedError.message}`);

    adminBefore = await roleRows(adminRoleId);

    // Install the shipped function over the direct connection: the mutation gate
    // edits the migration and this is where that edit reaches the database.
    const sql = postgres(localDatabaseUrl!, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(shippedFunction);
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it.skipIf(!localDatabaseUrl)(
    'normalises live rows to the catalog and is idempotent',
    async () => {
      await rewrite();

      const rows = await roleRows(customRoleId);
      const names = rows.map(([name]) => name);

      // One row per (role, new name): the old name is gone, the new name
      // survives once (with the scope the row it replaced carried).
      expect(rows).toEqual([
        ['org.member.manage', 'group'],
        ['org.role.manage', 'own'],
      ]);
      for (const removed of LEGACY_AND_INVALID) {
        expect(names, `${removed} should not survive the rewrite`).not.toContain(removed);
      }

      // A name the catalog knows is untouched.
      expect(await roleRows(adminRoleId)).toEqual(adminBefore);

      // A second run changes nothing.
      await rewrite();
      expect(await roleRows(customRoleId)).toEqual(rows);
      expect(await roleRows(adminRoleId)).toEqual(adminBefore);
    },
  );
});
