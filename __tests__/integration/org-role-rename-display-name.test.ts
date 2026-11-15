import { AccountType, type RequestContext } from '@studiq/authz';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealSupabase, cleanupOrganizationDeep } from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';

const suiteId = crypto.randomUUID().slice(0, 8);

// Regression test for issue #260: renaming a custom role only wrote
// org_roles.name, so display_name kept the pre-rename label and every member /
// invite picker (which renders displayName) showed the old name while
// /manage/roles showed the new one.
//
// The service is injected with a SERVICE-ROLE client (no RLS), so these tests
// prove the app-layer sync from updateRole()/listRoles(), not the #191 policies.

describe(`OrgRoleService.rename display_name sync`, () => {
  const tag = `${suiteId}-${Date.now()}`;

  let service: SupabaseClient<Database>;
  let orgId: string;
  let customRoleId: string;

  function ctx(): RequestContext {
    return {
      traceId: `rename-display-name-${suiteId}`,
      userId: `user-${suiteId}`,
      accountType: AccountType.MANAGER,
      activeOrgId: orgId,
      orgRoleId: null,
      url: '/api/v1/organization/roles',
      method: 'PUT',
      groupIds: [],
      permissionScopes: {},
    };
  }

  async function labelsOf(roleId: string) {
    const { data, error } = await service
      .from('org_roles')
      .select('name, display_name')
      .eq('id', roleId)
      .single();
    if (error) throw new Error(`role read failed: ${error.message}`);
    return data;
  }

  beforeAll(async () => {
    service = createTypedServiceClient();

    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: `rename-display-${tag}` })
      .select('id')
      .single();
    if (orgError) throw new Error(`org create failed: ${orgError.message}`);
    orgId = org.id;

    // Custom roles start with display_name = name (createRole() behaviour).
    const { data: role, error: roleError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: `asystent-${tag}`,
        display_name: `asystent-${tag}`,
        description: 'Pomocnik prowadzącego — podgląd treści grup',
        is_system: false,
      })
      .select('id')
      .single();
    if (roleError) throw new Error(`custom role create failed: ${roleError.message}`);
    customRoleId = role.id;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId).catch(() => {});
  });

  it('updates name and display_name together on rename', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));
    const newName = `Asystent Lektora ${tag}`;

    const result = await orgRoleService.updateRole(ctx(), customRoleId, { name: newName });

    expect(result.success).toBe(true);
    expect(await labelsOf(customRoleId)).toEqual({ name: newName, display_name: newName });
  });

  it('serves the renamed label through listRoles (what the member pickers read)', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));
    const newName = `Asystent Lektora ${tag}`;

    const result = await orgRoleService.listRoles(ctx());

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(`listRoles failed: ${result.error}`);
    const role = result.data.find((r) => r.id === customRoleId);
    expect(role).toBeDefined();
    expect(role?.displayName).toBe(newName);
  });

  it('leaves display_name untouched on a description-only update', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));
    const newName = `Asystent Lektora ${tag}`;
    const before = await labelsOf(customRoleId);

    const result = await orgRoleService.updateRole(ctx(), customRoleId, {
      description: 'Opis po drugiej edycji',
    });

    expect(result.success).toBe(true);
    expect(await labelsOf(customRoleId)).toEqual({
      name: before.name,
      display_name: before.display_name,
    });
    expect(await labelsOf(customRoleId)).toEqual({ name: newName, display_name: newName });
  });
});
