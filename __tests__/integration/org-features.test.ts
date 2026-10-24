import type { RequestContext } from '@studiq/authz';
import { LimitsResolver } from '@studiq/server/services/limits.resolver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
} from '#test/integration/helpers';

forEachCopy((copyId) => {
  describe(`Org Features (trigger) [${copyId}]`, () => {
    registerMock(copyId, null);

    const PREFIX = 'of-test-org-';
    let orgId: string;

    beforeEach(async () => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);

      const supabase = createServiceClient();
      const name = `${PREFIX}${copyId}-${Date.now()}`;

      const { data: org } = await supabase.from('organizations').insert({ name }).select().single();

      if (!org) throw new Error('Failed to create org');
      orgId = org.id;
    });

    afterEach(async () => {
      if (orgId) {
        await cleanupOrganizationDeep(orgId);
      }
    });

    it('creates default roles with correct names', async () => {
      const supabase = createServiceClient();

      const { data: roles } = await supabase
        .from('org_roles')
        .select('name, is_system')
        .eq('organization_id', orgId)
        .order('name');

      expect(roles).toHaveLength(3);
      expect(roles).toEqual([
        { name: 'admin', is_system: true },
        { name: 'member', is_system: true },
        { name: 'teacher', is_system: true },
      ]);
    });

    it('seeds permissions for all roles', async () => {
      const supabase = createServiceClient();

      const { data: roles } = await supabase
        .from('org_roles')
        .select('id, name')
        .eq('organization_id', orgId);

      const roleIds: Record<string, string> = Object.fromEntries(
        (roles ?? []).map((r) => [r.name, r.id]),
      );

      for (const [roleName, expectedScopeFn] of Object.entries({
        admin: (_name: string) => 'organization',
        teacher: (_name: string) => 'own',
        member: (name: string) => (name.endsWith('.read') ? 'group' : 'own'),
      })) {
        const { data: perms } = await supabase
          .from('org_role_permissions')
          .select('permission_name, scope')
          .eq('org_role_id', roleIds[roleName]);

        expect(perms?.length).toBeGreaterThan(0);
        for (const perm of perms ?? []) {
          expect(perm.scope).toBe(expectedScopeFn(perm.permission_name));
        }
      }
    });

    it('seeds features for admin role from plan template', async () => {
      const supabase = createServiceClient();

      const { data: adminRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'admin')
        .single();

      const { data: features } = await supabase
        .from('org_role_features')
        .select('feature_key, is_enabled')
        .eq('org_role_id', adminRole?.id);

      // Admin should get all features from the default 'launch' plan
      expect(features?.length).toBeGreaterThanOrEqual(5);
      expect(features?.every((f) => f.is_enabled)).toBe(true);
      expect(features?.map((f) => f.feature_key)).toContain('flashcards');
      expect(features?.map((f) => f.feature_key)).toContain('group.manage');
      expect(features?.map((f) => f.feature_key)).toContain('member.manage');
    });

    it('seeds features for teacher role excluding member.manage and role.builder', async () => {
      const supabase = createServiceClient();

      const { data: teacherRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'teacher')
        .single();

      const { data: features } = await supabase
        .from('org_role_features')
        .select('feature_key, is_enabled')
        .eq('org_role_id', teacherRole?.id);

      const featureKeys = features?.map((f) => f.feature_key) ?? [];
      expect(featureKeys).toContain('flashcards');
      expect(featureKeys).toContain('group.manage');
      expect(featureKeys).not.toContain('member.manage');
      expect(featureKeys).not.toContain('role.builder');
      expect(features?.every((f) => f.is_enabled)).toBe(true);
    });

    it('seeds features for member role limited to basic features', async () => {
      const supabase = createServiceClient();

      const { data: memberRole } = await supabase
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'member')
        .single();

      const { data: features } = await supabase
        .from('org_role_features')
        .select('feature_key, is_enabled')
        .eq('org_role_id', memberRole?.id);

      const featureKeys = features?.map((f) => f.feature_key) ?? [];
      // launch plan includes flashcards, quiz, documents
      expect(featureKeys).toEqual(['flashcards', 'quiz', 'documents']);
      expect(features?.every((f) => f.is_enabled)).toBe(true);
    });

    it('derives org limits from plan_limits (no snapshot)', async () => {
      const supabase = createServiceClient();
      const resolver = new LimitsResolver(async () => supabase);

      // The org defaults to the 'launch' plan. Limits are no longer copied into
      // an org_limits snapshot (#229) — they resolve live from the plan template.
      const ctx: RequestContext = {
        traceId: 'org-features',
        userId: '00000000-0000-4000-8000-000000000000',
        accountType: 'STUDENT',
        activeOrgId: orgId,
        orgRoleId: null,
        url: '/api/v1/features/me',
        method: 'GET',
        groupIds: [],
        permissionScopes: {},
      };

      await expect(resolver.getEffectiveLimit(ctx, 'max_flashcards')).resolves.toBe(100);
      await expect(resolver.getEffectiveLimit(ctx, 'max_questions')).resolves.toBe(50);
      await expect(resolver.getEffectiveLimit(ctx, 'max_decks')).resolves.toBe(10);
    });
  });
});
