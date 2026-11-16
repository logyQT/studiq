import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

// #1256: `DEFAULT_ROLE_PERMISSIONS` declares `assignment.*` for `admin` (organization) and `teacher`
// (own), but the family was missing from the `permissions` catalogue, so neither the
// `handle_new_organization` trigger nor `09_perms.sql` granted a single row — and the manager
// override answered 404 for a manager who did not author the run. This pins the data contract both
// seeders owe: a freshly created organization (trigger) and the organizations `01_seed.sql` created
// (then `09_perms.sql`) carry the same rows, and `member` carries none of them.

const ASSIGNMENT_PERMISSIONS = [
  'assignment.create',
  'assignment.delete',
  'assignment.grade',
  'assignment.publish',
  'assignment.read',
  'assignment.update',
] as const;

const ALL_ORGANIZATION = Object.fromEntries(
  ASSIGNMENT_PERMISSIONS.map((name) => [name, 'organization']),
);
const ALL_OWN = Object.fromEntries(ASSIGNMENT_PERMISSIONS.map((name) => [name, 'own']));

/** An organization `01_seed.sql` inserts (and `09_perms.sql` then grants). */
const SEEDED_ORG_ID = '00000000-0000-4000-8000-000000000001';

describe('assignment.* permissions on the seeded org roles (#1256)', () => {
  const service: SupabaseClient<Database> = createServiceClient();
  let createdOrgId: string;

  /** `permission_name → scope` for the assessment family on one of an org's system roles. */
  async function assignmentScopes(
    orgId: string,
    roleName: 'admin' | 'teacher' | 'member',
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
      .select('permission_name, scope')
      .eq('org_role_id', role.id)
      .like('permission_name', 'assignment.%');
    if (error) throw new Error(`permissions read failed: ${error.message}`);
    return Object.fromEntries(dbRows(data).map((row) => [row.permission_name, row.scope]));
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

  it('grants a newly created organization the declared family per role', async () => {
    expect(await assignmentScopes(createdOrgId, 'admin')).toEqual(ALL_ORGANIZATION);
    expect(await assignmentScopes(createdOrgId, 'teacher')).toEqual(ALL_OWN);
    expect(
      await assignmentScopes(createdOrgId, 'member'),
      'writing an assessment is staff-only',
    ).toEqual({});
  });

  it('grants the seeded organizations the same rows', async () => {
    expect(await assignmentScopes(SEEDED_ORG_ID, 'admin')).toEqual(ALL_ORGANIZATION);
    expect(await assignmentScopes(SEEDED_ORG_ID, 'teacher')).toEqual(ALL_OWN);
    expect(await assignmentScopes(SEEDED_ORG_ID, 'member')).toEqual({});
  });
});
