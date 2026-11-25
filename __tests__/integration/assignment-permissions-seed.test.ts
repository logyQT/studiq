import { SYSTEM_ROLE_NAMES, SYSTEM_ROLE_TEMPLATES, type SystemRoleName } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// #1256 pinned the `assignment.*` family on the org-creation trigger and on
// the seed's repair call. Both now go through `seed_system_role_permissions()`
// (the seed itself retired in #1502), so this asserts the stronger contract: a
// freshly created organization (trigger) and the organizations `01_seed.sql`
// inserts carry exactly the `SYSTEM_ROLE_TEMPLATES` matrix — content, group and
// org keys alike. The TypeScript matrix is the pin; the SQL mirror is what
// could drift from it.

const ROLES: readonly SystemRoleName[] = SYSTEM_ROLE_NAMES;

/** An organization `01_seed.sql` inserts, so the trigger creates its roles. */
const SEEDED_ORG_ID = '00000000-0000-4000-8000-000000000001';

describe('system-role permissions on the org roles', () => {
  const service: SupabaseClient<Database> = createServiceClient();
  let createdOrgId: string;

  async function roleScopes(
    orgId: string,
    roleName: SystemRoleName,
  ): Promise<Record<string, string>> {
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
      .select('permission_key, scope')
      .eq('org_role_id', role.id);
    if (error) throw new Error(`permissions read failed: ${error.message}`);
    return Object.fromEntries(dbRows(data).map((row) => [row.permission_key, row.scope]));
  }

  beforeAll(async () => {
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

  it.each(ROLES)('grants a newly created organization the template rows for %s', async (role) => {
    expect(await roleScopes(createdOrgId, role)).toEqual(SYSTEM_ROLE_TEMPLATES[role].permissions);
  });

  it.each(ROLES)('grants the seeded organizations the same rows for %s', async (role) => {
    expect(await roleScopes(SEEDED_ORG_ID, role)).toEqual(SYSTEM_ROLE_TEMPLATES[role].permissions);
  });

  it('gives the seeded organizations the profiles the trigger wrote', async () => {
    // `01_seed.sql` inserts organizations with a plain INSERT and the trigger is
    // AFTER INSERT, so the trigger creates the three roles — and their profiles
    // — before the seed's own `org_roles` rows conflict and do nothing.
    const { data, error } = await service
      .from('org_roles')
      .select('name, entitlement_profile')
      .eq('organization_id', SEEDED_ORG_ID);
    if (error) throw new Error(`role profiles read failed: ${error.message}`);

    expect(
      Object.fromEntries(dbRows(data).map((row) => [row.name, row.entitlement_profile])),
    ).toEqual({ admin: 'all', teacher: 'all', member: 'learner' });
  });
});
