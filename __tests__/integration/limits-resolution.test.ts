import { AccountType, type LimitKey, type RequestContext } from '@studiq/authz';
import { EntitlementResolver } from '@studiq/server/services/entitlement.resolver';
import { checkOrgLimit } from '@studiq/server/services/limits';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';

const suiteId = crypto.randomUUID().slice(0, 8);

// Issue #230 + ADR-0015 §6.2 (phase 3b): limits resolve live from the plan
// tables through the single resolver's composition — `max(org, seat, personal)`
// for user-scope keys, the org plan for org-scope keys, missing row = 0, `-1`
// short-circuits — and never from a per-org snapshot. These tests change
// `organizations.plan` directly — deliberately NOT through `change_org_plan()`,
// which moves the plan and nothing else — and assert the resolver follows the
// new plan on the next resolution. They also pin the membership gate:
// `active_org_id` is a client-controlled cookie, so a forged id plus a stale
// seat row must resolve the personal plan (user keys) / 0 (org keys), never the
// foreign org's or the seat's values.
describe(`Limits resolve live through the single resolver (ADR-0015 §6.2)`, () => {
  let fixture!: BeforeResult;
  let service!: SupabaseClient<Database>;
  let resolver!: EntitlementResolver;
  let adminRoleId!: string;
  let memberRoleId!: string;
  let foreignOrgId!: string;
  let student!: TestUserFixture;

  function memberCtx(overrides: Partial<RequestContext> = {}): RequestContext {
    return {
      traceId: `limits-${suiteId}`,
      userId: fixture.user.id,
      accountType: AccountType.MANAGER,
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

  /** Effective limit straight from one resolution (the wrappers read this). */
  async function effectiveLimit(ctx: RequestContext, key: LimitKey): Promise<number> {
    const { limits } = await resolver.resolveEntitlements(ctx);
    return limits[key] ?? 0;
  }

  async function orgPlan(orgId: string): Promise<string | undefined> {
    const { data } = await service.from('organizations').select('plan').eq('id', orgId).single();
    return data?.plan;
  }

  async function seatUser(orgId: string, userId: string, planKey: string): Promise<void> {
    const { data: pool, error: poolError } = await service
      .from('org_seat_pools')
      .insert({ organization_id: orgId, plan_key: planKey, total: 5 })
      .select('id')
      .single();
    if (poolError) throw new Error(`seat pool create failed: ${poolError.message}`);
    const { error: assignError } = await service
      .from('org_seat_assignments')
      .insert({ organization_id: orgId, pool_id: pool.id, user_id: userId });
    if (assignError) throw new Error(`seat assignment failed: ${assignError.message}`);
  }

  beforeAll(async () => {
    fixture = await before({ role: 'manager', org: true });
    service = createTypedServiceClient();
    resolver = new EntitlementResolver(() => Promise.resolve(service));

    const { data: roles, error } = await service
      .from('org_roles')
      .select('id, name')
      .eq('organization_id', fixture.orgId!);
    if (error) throw new Error(`role lookup failed: ${error.message}`);
    adminRoleId = roles.find((r) => r.name === 'admin')!.id;
    memberRoleId = roles.find((r) => r.name === 'member')!.id;

    // A student member of the fixture org, for the personal-layer cases.
    student = await createTestUser({ role: 'student' });
    await seedOrgMembership({
      organizationId: fixture.orgId!,
      userId: student.id,
      orgRoleId: memberRoleId,
    });

    // Org the fixture user is NOT a member of: used to prove the membership
    // gate does not depend on RLS (the resolver runs on the service client
    // here, which bypasses it).
    const { data: foreign, error: foreignError } = await service
      .from('organizations')
      .insert({ name: `limits-foreign-${suiteId}-${Date.now()}` })
      .select('id')
      .single();
    if (foreignError) {
      throw new Error(`foreign org create failed: ${foreignError.message}`);
    }
    foreignOrgId = foreign.id;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();
    // Each case starts from the creation default; no case depends on test order.
    await service.from('organizations').update({ plan: 'launch' }).eq('id', fixture.orgId!);
    await service.from('org_seat_assignments').delete().eq('organization_id', fixture.orgId!);
    await service.from('org_seat_pools').delete().eq('organization_id', fixture.orgId!);
    await service.from('org_seat_assignments').delete().eq('organization_id', foreignOrgId);
    await service.from('org_seat_pools').delete().eq('organization_id', foreignOrgId);
  });

  afterAll(async () => {
    if (fixture.orgId) {
      await cleanupOrganizationDeep(fixture.orgId);
    }
    if (foreignOrgId) {
      await cleanupOrganizationDeep(foreignOrgId);
    }
    await service.auth.admin.deleteUser(student.id).catch(() => {});
  });

  it('follows a plan change made without change_org_plan() — narrows and widens with no snapshot', async () => {
    // Creation default is `launch` (max_flashcards 100, max_groups 3,
    // max_ai_tokens_per_day 0).
    expect(await orgPlan(fixture.orgId!)).toBe('launch');
    await expect(effectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(100);

    // Direct service-role update: no RPC, no snapshot writer.
    const { error } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', fixture.orgId!);
    expect(error).toBeNull();
    expect(await orgPlan(fixture.orgId!)).toBe('hub');

    // hub max_flashcards = 2000. The manager's personal plan (launch, 100) is
    // excluded inside a verified org (#228), so the value can only come from
    // the live org plan (#230).
    await expect(effectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(2000);
    // Narrowing works the same way: back to launch, the next resolution is 100.
    await service.from('organizations').update({ plan: 'launch' }).eq('id', fixture.orgId!);
    await expect(effectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(100);
  });

  it('enforces org-only limits from the new plan through checkOrgLimit', async () => {
    const { error } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', fixture.orgId!);
    expect(error).toBeNull();

    // hub max_groups = 20 (launch said 3).
    await expect(
      checkOrgLimit(fixture.orgId!, 'max_groups', 19, 1, service),
    ).resolves.toBeUndefined();
    await expect(checkOrgLimit(fixture.orgId!, 'max_groups', 20, 1, service)).rejects.toThrow(
      'USAGE_LIMIT_EXCEEDED',
    );
    // hub max_students = 50: the invite-accept path sees the new capacity.
    await expect(
      checkOrgLimit(fixture.orgId!, 'max_students', 49, 1, service),
    ).resolves.toBeUndefined();
    await expect(checkOrgLimit(fixture.orgId!, 'max_students', 50, 1, service)).rejects.toThrow(
      'USAGE_LIMIT_EXCEEDED',
    );
  });

  it('a base seat in a hub org keeps the hub allowance (phase-3 exit case: never 0 tokens)', async () => {
    await service.from('organizations').update({ plan: 'hub' }).eq('id', fixture.orgId!);
    await seatUser(fixture.orgId!, fixture.user.id, 'base');

    // max(org hub 200000, seat base 0) = 200000 — the seat's 0 must not win.
    await expect(effectiveLimit(memberCtx(), 'max_ai_tokens_per_day')).resolves.toBe(200000);
    // max(hub 2000, base 100) = 2000.
    await expect(effectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(2000);
    // Org-scope capacity stays the org plan's: hub max_students = 50, never
    // the seat plan's -1.
    await expect(effectiveLimit(memberCtx(), 'max_students')).resolves.toBe(50);

    const { entitlements, sources } = await resolver.resolveEntitlements(memberCtx());
    // ai.chat is in the hub ceiling and its quota is 200000 ≠ 0 → effective.
    expect(entitlements).toContain('ai.chat');
    expect(sources.seat).toEqual({ planKey: 'base', origin: 'seat' });
  });

  it('a forged active_org_id with a stale seat row resolves the personal plan for user keys and 0 for org keys', async () => {
    // The foreign org sits on hub (max_flashcards 2000) and the fixture user
    // has a stale `base` seat row in it — but no org_members row.
    await service.from('organizations').update({ plan: 'hub' }).eq('id', foreignOrgId);
    await seatUser(foreignOrgId, fixture.user.id, 'base');

    const { data: profile } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', fixture.user.id)
      .single();
    const personalPlanKey = profile!.personal_plan_key;
    const { data: personalLimit } = await service
      .from('plan_limits')
      .select('limit_value')
      .eq('plan_key', personalPlanKey)
      .eq('limit_key', 'max_flashcards')
      .single();

    // A spoofed cookie: membership is verified first, so the foreign org's
    // hub plan and the stale seat row must both be ignored.
    const spoofed = memberCtx({
      activeOrgId: foreignOrgId,
      orgRoleId: null,
      userId: fixture.user.id,
    });
    await expect(effectiveLimit(spoofed, 'max_flashcards')).resolves.toBe(
      personalLimit!.limit_value,
    );
    expect(personalLimit!.limit_value).not.toBe(2000);
    // Org-scope keys are 0 outside a verified org.
    await expect(effectiveLimit(spoofed, 'max_students')).resolves.toBe(0);

    const { sources } = await resolver.resolveEntitlements(spoofed);
    expect(sources.org).toBeNull();
    expect(sources.seat).toBeNull();
  });

  it('a student personal plan raises (never lowers) a user-scope limit inside the org', async () => {
    // Org on launch (max_flashcards 100, max_ai_tokens_per_day 0); the student
    // member's personal plan is `pro` (Max: 25000 cards, 500000 tokens).
    await service.from('profiles').update({ personal_plan_key: 'pro' }).eq('id', student.id);
    const studentCtx: RequestContext = {
      traceId: `limits-student-${suiteId}`,
      userId: student.id,
      accountType: AccountType.STUDENT,
      activeOrgId: fixture.orgId,
      orgRoleId: memberRoleId,
      url: '/api/v1/flashcards',
      method: 'POST',
      groupIds: [],
      permissionScopes: {},
    };

    await expect(effectiveLimit(studentCtx, 'max_flashcards')).resolves.toBe(25000);
    await expect(effectiveLimit(studentCtx, 'max_ai_tokens_per_day')).resolves.toBe(500000);
    // Org-scope capacity is untouched by the personal plan: launch max_students = 5.
    await expect(effectiveLimit(studentCtx, 'max_students')).resolves.toBe(5);
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
    await expect(effectiveLimit(memberWithoutRole, 'max_flashcards')).resolves.toBe(2000);
  });

  it('lets the org plan govern a member with an unlimited organization-scope personal plan (#233 Q1, D34)', async () => {
    const { data: profile } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', fixture.user.id)
      .single();
    const originalPlan = profile!.personal_plan_key;

    // `campus` is scope='organization': inside a verified org such a personal
    // plan never applies (the legacy org-buyer mirror), so its -1 must not
    // widen either key.
    await service
      .from('profiles')
      .update({ personal_plan_key: 'campus' })
      .eq('id', fixture.user.id);

    try {
      // launch: max_flashcards 100, max_ai_tokens_per_day 0.
      await expect(effectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(100);
      await expect(effectiveLimit(memberCtx(), 'max_ai_tokens_per_day')).resolves.toBe(0);

      // Outside the org the stored personal plan applies in full.
      await expect(
        effectiveLimit(memberCtx({ activeOrgId: null }), 'max_flashcards'),
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
        scope: 'organization',
        audience: null,
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
      // The personal plan points at the same test plan, so its row is missing
      // `max_decks` too — no fallback anywhere.
      const { data: profileRow } = await service
        .from('profiles')
        .select('personal_plan_key')
        .eq('id', fixture.user.id)
        .single();
      const originalPersonal = profileRow!.personal_plan_key;
      await service
        .from('profiles')
        .update({ personal_plan_key: planKey })
        .eq('id', fixture.user.id);

      try {
        // Missing user key in org context → 0 (org and personal rows both miss it).
        await expect(effectiveLimit(memberCtx(), 'max_decks')).resolves.toBe(0);
      } finally {
        await service
          .from('profiles')
          .update({ personal_plan_key: originalPersonal })
          .eq('id', fixture.user.id);
      }
      // Present key still resolves from the org plan.
      await expect(effectiveLimit(memberCtx(), 'max_flashcards')).resolves.toBe(100);
      // Missing org key → blocked (0), never unlimited.
      await expect(effectiveLimit(memberCtx(), 'max_groups')).resolves.toBe(0);
    } finally {
      await service.from('organizations').update({ plan: 'launch' }).eq('id', fixture.orgId!);
      await service.from('plan_limits').delete().eq('plan_key', planKey);
      await service.from('subscription_plans').delete().eq('key', planKey);
    }
  });

  it('the resolution reports the effective primary plan and the union sources', async () => {
    await service.from('organizations').update({ plan: 'hub' }).eq('id', fixture.orgId!);
    await seatUser(fixture.orgId!, fixture.user.id, 'base');

    const { plan, sources } = await resolver.resolveEntitlements(memberCtx());

    expect(plan.primary).toBe('hub');
    expect(sources.org).toEqual({ planKey: 'hub', origin: 'org' });
    expect(sources.seat).toEqual({ planKey: 'base', origin: 'seat' });
    // The manager's personal plan is `base` (personal scope), which applies
    // inside the org for limits/portable keys (D34).
    expect(plan.sources).toEqual([
      { planKey: 'hub', origin: 'org' },
      { planKey: 'base', origin: 'seat' },
      { planKey: 'base', origin: 'personal' },
    ]);
  });
});
