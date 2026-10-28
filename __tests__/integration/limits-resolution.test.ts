import type { RequestContext } from '@studiq/authz';
import { LimitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  createServiceClient,
} from '#test/integration/helpers';

const suiteId = crypto.randomUUID().slice(0, 8);

// Issue #230: org capacity is resolved live from `organizations.plan ->
// plan_limits`, never from the per-org `org_limits` snapshot that #229 dropped.
//
// These tests change `organizations.plan` directly — deliberately NOT through
// `apply_org_plan()` — and assert the resolver follows the new plan on the next
// request. That is the property the snapshot could not offer: a plan mutated by
// any other path (billing update, service-role fix) used to leave every limit
// check stale until `apply_org_plan()` re-synced the copy. The last case also
// pins the membership gate, because `active_org_id` is a client-controlled
// cookie.
describe(`Limits resolve live from organizations.plan`, () => {
  let fixture!: BeforeResult;
  let service!: SupabaseClient;
  let resolver!: LimitsResolver;
  let adminRoleId!: string;
  let foreignOrgId!: string;

  function memberCtx(overrides: Partial<RequestContext> = {}): RequestContext {
    return {
      traceId: `limits-${suiteId}`,
      userId: fixture.user.id,
      accountType: 'MANAGER',
      activeOrgId: fixture.orgId,
      // withAuth sets this only for a real org_members row; the fixture user
      // is the org's admin, so that is exactly what a live request carries.
      orgRoleId: adminRoleId,
      url: '/api/v1/flashcards',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
      ...overrides,
    };
  }

  async function orgPlan(): Promise<string> {
    const { data } = await service
      .from('organizations')
      .select('plan')
      .eq('id', fixture.orgId!)
      .single();
    return data?.plan;
  }

  beforeAll(async () => {
    fixture = await before({ role: 'manager', org: true });
    service = createServiceClient();
    resolver = new LimitsResolver(async () => service);

    const { data: role, error } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', fixture.orgId!)
      .eq('name', 'admin')
      .single();
    if (error || !role) throw new Error(`admin role lookup failed: ${error?.message}`);
    adminRoleId = role.id;

    // Org the fixture user is NOT a member of: used to prove the membership
    // gate below does not depend on RLS (the resolver runs on the service
    // client here, which bypasses it).
    const { data: foreign, error: foreignError } = await service
      .from('organizations')
      .insert({ name: `limits-foreign-${suiteId}-${Date.now()}` })
      .select('id')
      .single();
    if (foreignError || !foreign) {
      throw new Error(`foreign org create failed: ${foreignError?.message}`);
    }
    foreignOrgId = foreign.id;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();
    // Each case starts from the creation default; no case depends on test order.
    await service.from('organizations').update({ plan: 'launch' }).eq('id', fixture.orgId!);
  });

  afterAll(async () => {
    if (fixture?.orgId) {
      await cleanupOrganizationDeep(fixture.orgId);
    }
    if (foreignOrgId) {
      await cleanupOrganizationDeep(foreignOrgId);
    }
  });

  it('follows a plan change made without apply_org_plan()', async () => {
    // Creation default is `launch` (max_flashcards 100, max_groups 3,
    // max_ai_tokens_per_day 0).
    expect(await orgPlan()).toBe('launch');
    await expect(resolver.getEffectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(100);

    // Direct service-role update: no snapshot sync, no apply_org_plan().
    const { error } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', fixture.orgId!);
    expect(error).toBeNull();
    expect(await orgPlan()).toBe('hub');

    // hub max_flashcards = 2000. The org plan alone governs org-context
    // capacity (#233): the manager's personal plan (launch, 100) never widens
    // it, and the value can only come from the live org plan (#230).
    await expect(resolver.getEffectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(2000);
  });

  it('enforces org-only limits from the new plan through checkOrgLimit', async () => {
    const { error } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', fixture.orgId!);
    expect(error).toBeNull();

    // hub max_groups = 20 (the launch snapshot said 3).
    await expect(resolver.checkOrgLimit(fixture.orgId!, 'max_groups', 19)).resolves.toBeUndefined();
    await expect(resolver.checkOrgLimit(fixture.orgId!, 'max_groups', 20)).rejects.toThrow(
      'USAGE_LIMIT_EXCEEDED',
    );
    // hub max_students = 50: the invite-accept path sees the new capacity.
    await expect(
      resolver.checkOrgLimit(fixture.orgId!, 'max_students', 49),
    ).resolves.toBeUndefined();
    await expect(resolver.checkOrgLimit(fixture.orgId!, 'max_students', 50)).rejects.toThrow(
      'USAGE_LIMIT_EXCEEDED',
    );
  });

  it('reports the org-plan AI budget while keeping the personal plan key', async () => {
    const { error } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', fixture.orgId!);
    expect(error).toBeNull();

    // personal max_ai_tokens_per_day is 0 (manager personal plan `launch`);
    // org hub = 200000.
    const usage = await resolver.getUsage(memberCtx(), 'max_ai_tokens_per_day');
    expect(usage.limit).toBe(200000);

    // API shape is unchanged: `plan` stays the caller's personal plan key,
    // never the org plan.
    const { data: profile } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', fixture.user.id)
      .single();
    expect(usage.plan).toBe(profile?.personal_plan_key);
    expect(usage.plan).not.toBe('hub');
  });

  it('resolves the org plan for a member whose ctx has no orgRoleId', async () => {
    const { error } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', fixture.orgId!);
    expect(error).toBeNull();

    // Membership — not `orgRoleId` — decides the org branch. The fixture user
    // has a real org_members row, so losing the ctx role id must not drop the
    // org plan (hub max_flashcards = 2000).
    const memberWithoutRole = memberCtx({ orgRoleId: null });
    await expect(resolver.getEffectiveLimit(memberWithoutRole, 'max_flashcards')).resolves.toBe(
      2000,
    );
  });

  it('lets the org plan govern a member with an unlimited personal plan (#233 Q1)', async () => {
    const { data: profile } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', fixture.user.id)
      .single();
    const originalPlan = profile!.personal_plan_key!;

    await service.from('profiles').update({ personal_plan_key: 'pro' }).eq('id', fixture.user.id);

    try {
      // launch: max_flashcards 100, max_ai_tokens_per_day 0. The personal
      // `pro` plan used to short-circuit both to -1 (unlimited).
      await expect(resolver.getEffectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(100);
      await expect(resolver.getEffectiveLimit(memberCtx(), 'max_ai_tokens_per_day')).resolves.toBe(
        0,
      );

      // The personal plan still applies outside the org.
      await expect(
        resolver.getEffectiveLimit(memberCtx({ activeOrgId: null }), 'max_flashcards'),
      ).resolves.toBe(-1);
    } finally {
      await service
        .from('profiles')
        .update({ personal_plan_key: originalPlan })
        .eq('id', fixture.user.id);
    }
  });

  it('fails closed when the active plan omits a key (#233 Q2)', async () => {
    const planKey = `test-233-missing-${suiteId}-${Date.now()}`;

    try {
      const { error: planError } = await service.from('subscription_plans').insert({
        key: planKey,
        name: `Test #233 missing key ${suiteId}`,
        price_monthly: 0,
        currency: 'PLN',
        sort_order: 999,
        for_account_type: 'manager',
        is_active: false,
      });
      if (planError) throw new Error(`[limits] plan create failed: ${planError.message}`);

      // Deliberately omits `max_decks` (user scope) and `max_groups` (org scope).
      const { error: limitsError } = await service.from('plan_limits').insert([
        { plan_key: planKey, limit_key: 'max_flashcards', limit_value: 100 },
        { plan_key: planKey, limit_key: 'max_students', limit_value: 5 },
      ]);
      if (limitsError) {
        throw new Error(`[limits] plan limits create failed: ${limitsError.message}`);
      }

      await service.from('organizations').update({ plan: planKey }).eq('id', fixture.orgId!);

      // Missing user key in org context → 0, with no personal fallback.
      await expect(resolver.getEffectiveLimit(memberCtx(), 'max_decks')).resolves.toBe(0);
      // Present key still resolves from the org plan.
      await expect(resolver.getEffectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(100);
      // Missing org key in checkOrgLimit → blocked (was unlimited before #233).
      await expect(resolver.checkOrgLimit(fixture.orgId!, 'max_groups', 0)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
    } finally {
      await service.from('organizations').update({ plan: 'launch' }).eq('id', fixture.orgId!);
      await service.from('plan_limits').delete().eq('plan_key', planKey);
      await service.from('subscription_plans').delete().eq('key', planKey);
    }
  });

  it('does not trust active_org_id without a verified membership', async () => {
    const { error } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', foreignOrgId);
    expect(error).toBeNull();

    // A spoofed cookie: the fixture user belongs to a different org, so there
    // is no org_members row for this pair. The service client bypasses RLS, so
    // only the resolver's membership gate can keep this at the personal cap
    // instead of the foreign org's hub 2000.
    const spoofed = memberCtx({
      activeOrgId: foreignOrgId,
      orgRoleId: null,
      userId: fixture.user.id,
    });

    const { data: profile } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', fixture.user.id)
      .single();
    const { data: personalLimit } = await service
      .from('plan_limits')
      .select('limit_value')
      .eq('plan_key', profile!.personal_plan_key!)
      .eq('limit_key', 'max_flashcards')
      .single();

    await expect(resolver.getEffectiveLimit(spoofed, 'max_flashcards')).resolves.toBe(
      personalLimit!.limit_value,
    );
    expect(personalLimit!.limit_value).not.toBe(2000);
  });
});
