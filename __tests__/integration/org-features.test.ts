import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  useRealSupabase,
} from '#test/integration/helpers';

describe('Org Features (trigger)', () => {
  const PREFIX = 'of-test-org-';
  let orgId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();

    const supabase = createServiceClient();
    const name = `${PREFIX}${Date.now()}`;

    const { data: org } = await supabase
      .from('organizations')
      .insert({ name })
      .select()
      .single();

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

    const roleIds = (roles ?? []).reduce(
      (acc, r) => ({ ...acc, [r.name]: r.id }),
      {} as Record<string, string>,
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
    expect(features?.map((f) => f.feature_key)).toContain('group_manage');
    expect(features?.map((f) => f.feature_key)).toContain('member_manage');
  });

  it('seeds features for teacher role excluding member_manage and role_builder', async () => {
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
    expect(featureKeys).toContain('group_manage');
    expect(featureKeys).not.toContain('member_manage');
    expect(featureKeys).not.toContain('role_builder');
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

  it('seeds org limits from plan template', async () => {
    const supabase = createServiceClient();

    const { data: limits } = await supabase
      .from('org_limits')
      .select('limit_key, max_value')
      .eq('organization_id', orgId);

    expect(limits?.length).toBeGreaterThan(0);

    // Org defaults to 'launch' plan — check launch plan limits
    const launchLimits = [
      { limit_key: 'max_flashcards', max_value: 100 },
      { limit_key: 'max_questions', max_value: 50 },
      { limit_key: 'max_decks', max_value: 10 },
    ];

    for (const expected of launchLimits) {
      const match = limits?.find((l) => l.limit_key === expected.limit_key);
      expect(match).toBeDefined();
      expect(match?.max_value).toBe(expected.max_value);
    }
  });
});
