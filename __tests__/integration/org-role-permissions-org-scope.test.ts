import type { RequestContext } from '@studiq/authz';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
} from '#test/integration/helpers';

// Regression tests for issue #263: PUT /organization/roles/{id}/permissions
// used to delete/insert org_role_permissions by org_role_id alone, so any org
// admin who knew a role id of another organization could replace that org's
// permission matrix. The service now (a) requires a verified membership for the
// active org (ctx.orgRoleId) and (b) scopes the role lookup to the active org.
//
// The service is injected with a SERVICE-ROLE client, which bypasses RLS, so the
// only thing that can block the cross-org write here is the service-level check
// — this test proves the app-layer fix rather than re-testing the #191 policies.

forEachCopy((copyId) => {
  describe(`OrgRoleService.setPermissions org scope [${copyId}]`, () => {
    registerMock(copyId, null);

    const tag = `${copyId}-${Date.now()}`;

    let service: SupabaseClient;
    let orgA: string;
    let orgB: string;
    let orgARoleId: string; // caller's role in org A (verified membership)
    let orgBMemberRole: string; // foreign role the attack targets
    let orgACustomRole: string; // happy-path target in the caller's own org

    async function createOrg(name: string): Promise<string> {
      const { data, error } = await service
        .from('organizations')
        .insert({ name })
        .select('id')
        .single();
      if (error || !data) throw new Error(`org create failed: ${error?.message}`);
      return data.id;
    }

    async function roleId(orgId: string, roleName: string): Promise<string> {
      const { data, error } = await service
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', roleName)
        .single();
      if (error || !data) throw new Error(`role ${roleName} not found: ${error?.message}`);
      return data.id;
    }

    async function permissionsOf(roleIdToRead: string) {
      const { data, error } = await service
        .from('org_role_permissions')
        .select('permission_name, scope')
        .eq('org_role_id', roleIdToRead)
        .order('permission_name');
      if (error) throw new Error(`permissions read failed: ${error.message}`);
      return data ?? [];
    }

    function ctx(overrides: Partial<RequestContext>): RequestContext {
      return {
        traceId: `org-scope-${copyId}`,
        userId: `user-${copyId}`,
        accountType: 'MANAGER',
        activeOrgId: orgA,
        orgRoleId: orgARoleId,
        url: '/api/v1/organization/roles/x/permissions',
        method: 'PUT',
        groupIds: [],
        permissionScopes: {},
        ...overrides,
      };
    }

    beforeAll(async () => {
      service = createServiceClient();

      orgA = await createOrg(`orgscope-a-${tag}`);
      orgB = await createOrg(`orgscope-b-${tag}`);

      // The org trigger seeds member/teacher/admin roles per organization.
      orgARoleId = await roleId(orgA, 'admin');
      orgBMemberRole = await roleId(orgB, 'member');

      const { data: customRole, error: customError } = await service
        .from('org_roles')
        .insert({
          organization_id: orgA,
          name: 'custom-scoped',
          display_name: 'custom-scoped',
          description: null,
          is_system: false,
        })
        .select('id')
        .single();
      if (customError || !customRole) {
        throw new Error(`custom role create failed: ${customError?.message}`);
      }
      orgACustomRole = customRole.id;
    });

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
    });

    afterAll(async () => {
      await cleanupOrganizationDeep(orgA).catch(() => {});
      await cleanupOrganizationDeep(orgB).catch(() => {});
    });

    it('returns NOT_FOUND for a role outside the active org and leaves its rows untouched', async () => {
      const orgRoleService = new OrgRoleService(async () => service);
      const before = await permissionsOf(orgBMemberRole);
      expect(before.length).toBeGreaterThan(0);

      const result = await orgRoleService.setPermissions(ctx({}), orgBMemberRole, {
        permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
      });

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error).toBe('NOT_FOUND');

      const after = await permissionsOf(orgBMemberRole);
      expect(after).toEqual(before);
    });

    it('returns FORBIDDEN when the active org cookie points at an org the caller is not a member of', async () => {
      const orgRoleService = new OrgRoleService(async () => service);
      const before = await permissionsOf(orgBMemberRole);

      // with-auth leaves orgRoleId null when no org_members row exists for
      // (cookie org, user) — a forged active_org_id cookie looks like this.
      const result = await orgRoleService.setPermissions(
        ctx({ activeOrgId: orgB, orgRoleId: null }),
        orgBMemberRole,
        { permissions: [{ permissionName: 'flashcard.read', scope: 'own' }] },
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error).toBe('FORBIDDEN');

      const after = await permissionsOf(orgBMemberRole);
      expect(after).toEqual(before);
    });

    it('replaces permissions for a role in the caller own org (happy path preserved)', async () => {
      const orgRoleService = new OrgRoleService(async () => service);

      const result = await orgRoleService.setPermissions(ctx({}), orgACustomRole, {
        permissions: [
          { permissionName: 'flashcard.read', scope: 'own' },
          { permissionName: 'quiz.read', scope: 'group' },
        ],
      });

      expect(result.success).toBe(true);

      const after = await permissionsOf(orgACustomRole);
      expect(after).toEqual([
        { permission_name: 'flashcard.read', scope: 'own' },
        { permission_name: 'quiz.read', scope: 'group' },
      ]);
    });
  });
});
