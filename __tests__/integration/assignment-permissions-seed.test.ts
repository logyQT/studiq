import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// #1256 pinned the `assignment.*` family on the org-creation trigger and on
// `09_perms.sql`. Phase 1b makes both seed the whole content catalog via the
// same `category = 'content'` predicate, so this asserts the stronger contract:
// a freshly created organization (trigger) and the organizations `01_seed.sql`
// created (then `09_perms.sql`) carry the same rows, and both agree with the
// catalog itself.
//
// The expected rows are derived from `permissions`, never hardcoded: a content
// key added to the catalog has to reach the system roles, and a key granted at
// the wrong scope fails here.

const ROLES = ['admin', 'teacher', 'member'] as const;
type SystemRole = (typeof ROLES)[number];

/** An organization `01_seed.sql` inserts (and `09_perms.sql` then grants). */
const SEEDED_ORG_ID = '00000000-0000-4000-8000-000000000001';

describe('content permissions on the org system roles', () => {
  const service: SupabaseClient<Database> = createServiceClient();
  let createdOrgId: string;
  let contentKeys: string[];

  async function roleScopes(orgId: string, roleName: SystemRole): Promise<Record<string, string>> {
    const { data: role, error: roleError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', roleName)
      .maybeSingle();
    if (roleError) throw new Error(`role ${roleName} read failed: ${roleError.message}`);
    if (!role) throw new Error(`organization ${orgId} has no ${roleName} role`);

    const { data, error } = await service
      .from('org_role_permissions')
      .select('permission_name, scope')
      .eq('org_role_id', role.id);
    if (error) throw new Error(`permissions read failed: ${error.message}`);
    return Object.fromEntries(dbRows(data).map((row) => [row.permission_name, row.scope]));
  }

  /** The catalog-derived rows the trigger and the seed both owe a role. */
  function expectedScopes(roleName: SystemRole): Record<string, string> {
    if (roleName === 'admin') {
      return Object.fromEntries(contentKeys.map((key) => [key, 'organization']));
    }
    if (roleName === 'teacher') {
      return Object.fromEntries(contentKeys.map((key) => [key, 'own']));
    }
    return Object.fromEntries(
      contentKeys
        .filter((key) => !key.startsWith('assignment.'))
        .map((key) => [key, key.endsWith('.read') ? 'group' : 'own']),
    );
  }

  beforeAll(async () => {
    const { data: content, error: contentError } = await service
      .from('permissions')
      .select('key')
      .eq('category', 'content');
    if (contentError) throw new Error(`permissions catalog read failed: ${contentError.message}`);
    contentKeys = dbRows(content).map((row) => row.key);

    const { data, error } = await service
      .from('organizations')
      .insert({ name: `assignment-perms-${crypto.randomUUID().slice(0, 8)}` })
      .select('id')
      .single();
    if (error) throw new Error(`org create failed: ${error.message}`);
    createdOrgId = data.id;
  });

  afterAll(async () => {
    if (createdOrgId) await cleanupOrganizationDeep(createdOrgId);
  });

  it.each(ROLES)('grants a newly created organization the catalog rows for %s', async (role) => {
    expect(await roleScopes(createdOrgId, role)).toEqual(expectedScopes(role));
  });

  it.each(ROLES)('grants the seeded organizations the same rows for %s', async (role) => {
    expect(await roleScopes(SEEDED_ORG_ID, role)).toEqual(expectedScopes(role));
  });
});
