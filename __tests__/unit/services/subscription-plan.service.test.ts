import { AccountType, type RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { SubscriptionPlanService } from '@studiq/server/services/subscription-plan.service';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { mockResolverTables } from '#test/helpers/entitlement-resolver-mock';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type DbError = { message?: string; code?: string };
type QueryResult<T> = { data: T | null; error: DbError | null };

interface FakeQueryBuilder<T> {
  select: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  eq: Mock;
  neq: Mock;
  in: Mock;
  order: Mock;
  limit: Mock;
  single: Mock;
  maybeSingle: Mock;
  then: Promise<QueryResult<T>>['then'];
  catch: Promise<QueryResult<T>>['catch'];
  finally: Promise<QueryResult<T>>['finally'];
}

function qb<T>(data: T, error: DbError | null = null): FakeQueryBuilder<T> {
  const result: QueryResult<T> = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: FakeQueryBuilder<T> = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  for (const method of [
    b.select,
    b.insert,
    b.update,
    b.delete,
    b.eq,
    b.neq,
    b.in,
    b.order,
    b.limit,
  ]) {
    method.mockImplementation(() => b);
  }
  return b;
}

/** Narrows a service result to its data, failing the test when the call failed. */
function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

function planRow(key: string, scope: string = 'personal') {
  return {
    id: `p-${key}`,
    key,
    name: key,
    description: null,
    price_monthly: 0,
    price_yearly: 0,
    currency: 'PLN',
    sort_order: 0,
    is_active: true,
    visibility: 'public',
    billing_mode: 'stripe',
    scope,
  };
}

/** Resolver tables plus the `subscription_plans` catalog row for `key`. */
function mockPlanTables(
  mock: ReturnType<typeof mockSupabaseClient>,
  opts: Parameters<typeof mockResolverTables>[1],
  planKey: string | null,
  scope: string = 'personal',
) {
  mockResolverTables(mock, opts);
  const baseImpl: (table: string) => unknown = vi.mocked(mock.from).getMockImplementation()!;
  mock.from.mockImplementation((table: string) => {
    if (table !== 'subscription_plans') return baseImpl(table);
    // Key-aware catalog read: a lookup for any other key finds no row, so a
    // wrong plan key resolves NOT_FOUND instead of silently passing.
    const row = planKey ? planRow(planKey, scope) : null;
    const plansQb = qb(row);
    plansQb.eq = vi.fn((column: string, value: unknown) =>
      column === 'key' && value !== planKey ? qb(null) : plansQb,
    );
    return plansQb;
  });
}

describe('SubscriptionPlanService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: SubscriptionPlanService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new SubscriptionPlanService(() => Promise.resolve(mock));
  });

  describe('listActive', () => {
    it('returns active plans with features and limits', async () => {
      const plans = [
        {
          id: 'p-1',
          key: 'free',
          name: 'Base',
          description: null,
          price_monthly: 0,
          currency: 'PLN',
          sort_order: 0,
          is_active: true,
          visibility: 'public',
          billing_mode: 'stripe',
        },
      ];
      const features = [{ plan_key: 'free', entitlement_key: 'quiz' }];
      const limits = [{ plan_key: 'free', limit_key: 'max_groups', limit_value: 3 }];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb(limits));

      const result = await service.listActive();

      expect(expectSuccess(result)).toHaveLength(1);
      expect(expectSuccess(result)[0]?.features).toEqual(['quiz']);
      expect(expectSuccess(result)[0]?.limits.max_groups).toBe(3);
    });

    it('maps scope to the PlanInfo field', async () => {
      const plans = [
        { id: 'p-1', key: 'hub', name: 'Hub', scope: 'organization' },
        { id: 'p-2', key: 'pro', name: 'Pro', scope: 'personal' },
      ];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.scope).toBe('organization');
      expect(expectSuccess(result)[1]?.scope).toBe('personal');
    });

    it('derives seatEligible from the catalog embed: all keys seat-eligible', async () => {
      const plans = [planRow('pro')];
      const features = [
        {
          plan_key: 'pro',
          entitlement_key: 'flashcards',
          entitlement_catalog: { seat_eligible: true },
        },
        {
          plan_key: 'pro',
          entitlement_key: 'ai.chat',
          entitlement_catalog: { seat_eligible: true },
        },
      ];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb([{ key: 'ai.chat', is_enabled: true }]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.seatEligible).toBe(true);
      expect(expectSuccess(result)[0]?.features).toEqual(['flashcards', 'ai.chat']);
    });

    it('marks a plan with a non-seat-eligible key, or no keys, as not seat-eligible', async () => {
      const plans = [planRow('hub'), planRow('empty')];
      const features = [
        {
          plan_key: 'hub',
          entitlement_key: 'branding',
          entitlement_catalog: { seat_eligible: false },
        },
      ];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb([{ key: 'branding', is_enabled: true }]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.seatEligible).toBe(false);
      expect(expectSuccess(result)[1]?.seatEligible).toBe(false);
    });

    it('filters by scope', async () => {
      const plansQb = qb([]);
      mock.from.mockReturnValueOnce(plansQb);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive({ scope: 'personal' });

      expect(result.success).toBe(true);
      expect(plansQb.eq).toHaveBeenCalledWith('is_active', true);
      expect(plansQb.eq).toHaveBeenCalledWith('scope', 'personal');
    });

    it('asks only for publicly listed plans (B3)', async () => {
      // An unlisted contract plan must never reach a public read, so the
      // filter is part of the query, not a post-filter of the rows.
      const plansQb = qb([]);
      mock.from.mockReturnValueOnce(plansQb);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(result.success).toBe(true);
      expect(plansQb.eq).toHaveBeenCalledWith('visibility', 'public');
    });

    it('returns error on plans query failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listActive();

      expect(result.success).toBe(false);
    });

    it('drops a plan_entitlements row for a key the TS catalog does not know', async () => {
      // A DB-ahead key advertises nothing: the resolver drops it, so pricing
      // must too. The enabled flag row proves the catalog filter is what drops
      // it, not the flag gate.
      const features = [
        {
          plan_key: 'hub',
          entitlement_key: 'voice.probe',
          entitlement_catalog: { seat_eligible: true },
        },
        { plan_key: 'hub', entitlement_key: 'quiz', entitlement_catalog: { seat_eligible: true } },
      ];
      mock.from.mockReturnValueOnce(qb([planRow('hub')]));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb([{ key: 'voice.probe', is_enabled: true }]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.features).toEqual(['quiz']);
    });

    it('drops a surface key whose flag row is disabled', async () => {
      const features = [
        {
          plan_key: 'max',
          entitlement_key: 'stats.insights',
          entitlement_catalog: { seat_eligible: true },
        },
        { plan_key: 'max', entitlement_key: 'quiz', entitlement_catalog: { seat_eligible: true } },
      ];
      mock.from.mockReturnValueOnce(qb([planRow('max')]));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb([{ key: 'stats.insights', is_enabled: false }]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.features).toEqual(['quiz']);
    });

    it('drops a surface key with no flag row because the resolver fails closed', async () => {
      const features = [
        {
          plan_key: 'max',
          entitlement_key: 'stats.insights',
          entitlement_catalog: { seat_eligible: true },
        },
        { plan_key: 'max', entitlement_key: 'quiz', entitlement_catalog: { seat_eligible: true } },
      ];
      mock.from.mockReturnValueOnce(qb([planRow('max')]));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.features).toEqual(['quiz']);
    });

    it('keeps a baseline key with no flag row: baseline keys are never gated', async () => {
      const features = [
        { plan_key: 'free', entitlement_key: 'quiz', entitlement_catalog: { seat_eligible: true } },
        {
          plan_key: 'free',
          entitlement_key: 'flashcards',
          entitlement_catalog: { seat_eligible: true },
        },
      ];
      mock.from.mockReturnValueOnce(qb([planRow('free')]));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.features).toEqual(['quiz', 'flashcards']);
    });

    it('keeps seatEligible derived from the unfiltered rows', async () => {
      // `branding` is not seat-eligible and is filtered out of `features`, but
      // it still decides `seatEligible` — the rule `addPool` mirrors, which
      // reads `plan_entitlements` regardless of flags.
      const features = [
        { plan_key: 'hub', entitlement_key: 'quiz', entitlement_catalog: { seat_eligible: true } },
        {
          plan_key: 'hub',
          entitlement_key: 'branding',
          entitlement_catalog: { seat_eligible: false },
        },
      ];
      mock.from.mockReturnValueOnce(qb([planRow('hub')]));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb([{ key: 'branding', is_enabled: false }]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.features).toEqual(['quiz']);
      expect(expectSuccess(result)[0]?.seatEligible).toBe(false);
    });

    it('returns error on the flag query failure', async () => {
      mock.from.mockReturnValueOnce(qb([planRow('free')]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listActive();

      expect(result.success).toBe(false);
    });

    it('returns error on features query failure', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'p-1', key: 'free', name: 'Base' }]));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listActive();

      expect(result.success).toBe(false);
    });
  });

  describe('getMyPlan', () => {
    it('returns the seat plan to a seated student in an active org, with the effective union, #270', async () => {
      mockPlanTables(
        mock,
        {
          orgPlan: 'launch',
          roleProfile: 'learner',
          seatPlanKey: 'pro',
          personalPlanKey: 'free',
          planEntitlements: {
            launch: ['flashcards', 'quiz'],
            pro: ['flashcards', 'quiz', 'ai.chat', 'stats.insights'],
            free: ['flashcards', 'quiz'],
          },
          planLimits: {
            launch: {
              max_flashcards: 100,
              max_quiz_attempts_per_day: 10,
              max_ai_tokens_per_day: 0,
              max_students: 5,
              max_groups: 3,
            },
            pro: {
              max_flashcards: 2000,
              max_quiz_attempts_per_day: -1,
              max_ai_tokens_per_day: 200000,
              max_students: -1,
              max_groups: -1,
            },
            free: {
              max_flashcards: 100,
              max_quiz_attempts_per_day: 10,
              max_ai_tokens_per_day: 0,
              max_students: -1,
              max_groups: -1,
            },
          },
        },
        'pro',
      );

      const result = await service.getMyPlan({
        ...ctx,
        activeOrgId: 'org-1',
        orgRoleId: 'role-member',
      });

      expect(result.success).toBe(true);
      const plan = expectSuccess(result);
      expect(plan.key).toBe('pro');
      // features/limits are the effective resolved set: the seat's ai.chat is
      // not in the launch ceiling, so it is not effective; the user-scope
      // limits are max(org, seat, personal) and org-scope limits stay the org's.
      expect(plan.features).toEqual(['flashcards', 'quiz']);
      expect(plan.limits.max_flashcards).toBe(2000);
      expect(plan.limits.max_ai_tokens_per_day).toBe(200000);
      expect(plan.limits.max_students).toBe(5);
      expect(plan.sources).toEqual([
        { planKey: 'launch', origin: 'org' },
        { planKey: 'pro', origin: 'seat' },
        { planKey: 'free', origin: 'personal' },
      ]);
    });

    it('returns the org plan for a member holding org.billing.manage in an active org, never the seat, #181/D34', async () => {
      mockPlanTables(
        mock,
        {
          orgPlan: 'hub',
          roleProfile: 'all',
          seatPlanKey: null,
          personalPlanKey: 'solo',
        },
        'hub',
        'organization',
        null,
      );

      const result = await service.getMyPlan({
        ...ctx,
        accountType: AccountType.MANAGER,
        activeOrgId: 'org-1',
        orgRoleId: 'role-admin',
        permissionScopes: { 'org.billing.manage': 'organization' },
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('hub');
    });

    it('returns the personal plan for an org member without org.billing.manage, #181/D34', async () => {
      mockPlanTables(
        mock,
        {
          orgPlan: 'hub',
          roleProfile: 'learner',
          seatPlanKey: null,
          personalPlanKey: 'max',
        },
        'max',
        'personal',
        'student',
      );

      const result = await service.getMyPlan({
        ...ctx,
        activeOrgId: 'org-1',
        orgRoleId: 'role-member',
        permissionScopes: { 'deck.read': 'own' },
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('max');
    });

    it('returns the personal plan for an unseated student member, #181', async () => {
      mockPlanTables(
        mock,
        { orgPlan: 'launch', roleProfile: 'learner', personalPlanKey: 'free' },
        'free',
        'student',
      );

      const result = await service.getMyPlan({
        ...ctx,
        activeOrgId: 'org-1',
        orgRoleId: 'role-member',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('free');
    });

    it('a forged active_org_id with a stale seat row resolves the personal plan, never the seat, 3b', async () => {
      mockPlanTables(
        mock,
        {
          member: false, // no org_members row for the cookie's org
          orgPlan: 'hub',
          roleProfile: 'all',
          seatPlanKey: 'pro', // stale seat row in the foreign org
          personalPlanKey: 'free',
        },
        'free',
        'student',
      );

      const result = await service.getMyPlan({
        ...ctx,
        activeOrgId: 'org-foreign',
        orgRoleId: 'role-x',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('free');
      expect(mock.from).not.toHaveBeenCalledWith('org_seat_assignments');
    });

    it('falls back to the personal plan for a manager with no verified org (forged active_org_id)', async () => {
      mockPlanTables(
        mock,
        { member: false, orgPlan: null, personalPlanKey: 'solo' },
        'solo',
        'personal',
        'manager',
      );

      const result = await service.getMyPlan({
        ...ctx,
        accountType: AccountType.MANAGER,
        activeOrgId: 'org-1',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('solo');
    });

    it('returns the manager free personal plan (solo) with no active org, #228/D2', async () => {
      mockPlanTables(mock, { personalPlanKey: 'solo' }, 'solo', 'personal', 'manager');

      const result = await service.getMyPlan({ ...ctx, accountType: AccountType.MANAGER });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('solo');
      expect(mock.from).not.toHaveBeenCalledWith('org_members');
    });

    it('returns personal plan when no org', async () => {
      mockPlanTables(mock, { personalPlanKey: 'free' }, 'free');

      const result = await service.getMyPlan(ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('free');
    });

    it('returns NOT_FOUND when no plan key resolves', async () => {
      mockPlanTables(mock, { personalPlanKey: null }, null);

      const result = await service.getMyPlan({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      // Short-circuits on the missing key instead of reading the plan catalogue.
      expect(mock.from).not.toHaveBeenCalledWith('subscription_plans');
    });

    it('returns NOT_FOUND when the resolved plan key has no catalog row', async () => {
      mockPlanTables(mock, { personalPlanKey: 'free' }, null);

      const result = await service.getMyPlan({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('getPersonalPlan', () => {
    it('returns personal plan', async () => {
      const profile = { personal_plan_key: 'free' };
      const plan = {
        id: 'p-2',
        key: 'free',
        name: 'Free',
        description: null,
        price_monthly: 0,
        currency: 'PLN',
        sort_order: 0,
        is_active: true,
        visibility: 'public',
        billing_mode: 'stripe',
      };
      mock.from.mockReturnValueOnce(qb(profile));
      mock.from.mockReturnValueOnce(qb(plan));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getPersonalPlan(ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('free');
    });

    it('returns the stored plan verbatim — the legacy org-plan fallback is deleted in phase 4a (D34)', async () => {
      // A legacy row can still name an organization-scope plan; the migration
      // backfill moves managers off those, so the stored plan is the answer.
      const storedPlan = {
        id: 'p-hub',
        key: 'hub',
        name: 'StudiQ Hub',
        description: null,
        price_monthly: 29900,
        price_yearly: 0,
        currency: 'PLN',
        sort_order: 9,
        is_active: true,
        visibility: 'public',
        billing_mode: 'stripe',
        scope: 'organization',
      };
      mock.from
        .mockReturnValueOnce(qb({ personal_plan_key: 'hub' }))
        .mockReturnValueOnce(qb(storedPlan))
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(qb([]));

      const result = await service.getPersonalPlan({ ...ctx, accountType: AccountType.MANAGER });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('hub');
      expect(expectSuccess(result).scope).toBe('organization');
      expect(mock.from).toHaveBeenCalledTimes(4);
    });

    it('returns solo for a manager, with no extra catalog lookup (#228/D2)', async () => {
      const soloPlan = {
        id: 'p-solo',
        key: 'solo',
        name: 'StudiQ Solo',
        description: null,
        price_monthly: 0,
        price_yearly: 0,
        currency: 'PLN',
        sort_order: 13,
        is_active: true,
        visibility: 'public',
        billing_mode: 'stripe',
        scope: 'personal',
      };
      mock.from
        .mockReturnValueOnce(qb({ personal_plan_key: 'solo' }))
        .mockReturnValueOnce(qb(soloPlan))
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(qb([]));

      const result = await service.getPersonalPlan({ ...ctx, accountType: AccountType.MANAGER });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('solo');
      expect(mock.from).toHaveBeenCalledTimes(4);
    });

    it('returns NOT_FOUND when no plan key', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getPersonalPlan(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('getAllAdmin', () => {
    it('returns all plans', async () => {
      const plansQb = qb([{ id: 'p-1', key: 'free', name: 'Base' }]);
      mock.from.mockReturnValueOnce(plansQb);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getAllAdmin();

      expect(result.success).toBe(true);
      expect(plansQb.order).toHaveBeenCalledWith('sort_order', { ascending: true });
      expect(expectSuccess(result).map((plan) => plan.key)).toEqual(['free']);
    });

    it('derives selfServe from visibility and billing mode (B3)', async () => {
      // The admin read returns unlisted plans too, so it is the one place the
      // derived boolean can be observed for every combination.
      mock.from
        .mockReturnValueOnce(
          qb([
            planRow('free'),
            { ...planRow('legacy'), billing_mode: 'invoice' },
            { ...planRow('contract'), visibility: 'unlisted' },
          ]),
        )
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(qb([]));

      const result = await service.getAllAdmin();

      expect(expectSuccess(result).map((plan) => plan.selfServe)).toEqual([true, false, false]);
      expect(expectSuccess(result)[2]?.visibility).toBe('unlisted');
      expect(expectSuccess(result)[1]?.billingMode).toBe('invoice');
    });
  });

  describe('getByKey', () => {
    it('returns plan by key', async () => {
      const plan = {
        id: 'p-1',
        key: 'free',
        name: 'Base',
        description: null,
        price_monthly: 0,
        currency: 'PLN',
        sort_order: 0,
        is_active: true,
        visibility: 'public',
        billing_mode: 'stripe',
      };
      const plansQb = qb(plan);
      mock.from.mockReturnValueOnce(plansQb);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getByKey('free');

      expect(result.success).toBe(true);
      expect(plansQb.eq).toHaveBeenCalledWith('key', 'free');
      expect(expectSuccess(result).key).toBe('free');
    });

    it('applies the same public filter as the list', async () => {
      const plan = planRow('max');
      const features = [
        {
          plan_key: 'max',
          entitlement_key: 'voice.probe',
          entitlement_catalog: { seat_eligible: true },
        },
        {
          plan_key: 'max',
          entitlement_key: 'stats.insights',
          entitlement_catalog: { seat_eligible: true },
        },
        { plan_key: 'max', entitlement_key: 'quiz', entitlement_catalog: { seat_eligible: true } },
      ];
      mock.from.mockReturnValueOnce(qb(plan));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(
        qb([
          { key: 'voice.probe', is_enabled: true },
          { key: 'stats.insights', is_enabled: false },
        ]),
      );
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getByKey('max');

      expect(expectSuccess(result).features).toEqual(['quiz']);
    });

    it('returns NOT_FOUND when not found', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getByKey('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('answers NOT_FOUND for an unlisted plan (B3)', async () => {
      // The public `[key]` route and the checkout form both read this method,
      // so an unlisted contract plan must be indistinguishable from a missing
      // one. Only the catalog lookup runs: the plan is never composed.
      mock.from.mockReturnValueOnce(qb({ ...planRow('contract'), visibility: 'unlisted' }));

      const result = await service.getByKey('contract');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('getById', () => {
    it('returns plan by id', async () => {
      const plan = { id: 'p-1', key: 'free' };
      const findQb = qb(plan);
      mock.from.mockReturnValueOnce(findQb);

      const result = await service.getById('p-1');

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual(plan);
      expect(findQb.eq).toHaveBeenCalledWith('id', 'p-1');
    });

    it('returns NOT_FOUND when not found', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getById('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('listAssignments', () => {
    it('names each assigned organization and falls back to its id', async () => {
      mock.from.mockReturnValueOnce(
        qb([
          { organization_id: 'org-1', organizations: { name: 'Acme' } },
          { organization_id: 'org-2', organizations: null },
        ]),
      );

      const result = await service.listAssignments('contract');

      expect(expectSuccess(result)).toEqual([
        { organizationId: 'org-1', name: 'Acme' },
        { organizationId: 'org-2', name: 'org-2' },
      ]);
    });

    it('returns a database failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listAssignments('contract');

      expect(result.success).toBe(false);
    });
  });

  describe('assignOrganization', () => {
    it('pins the plan and moves the organization through one RPC', async () => {
      // `assign_plan_to_org` owns both writes: a pin without the move is a
      // contract that grants nothing (B3 follow-up).
      mock.rpc.mockResolvedValueOnce({ data: null, error: null });
      mock.from.mockReturnValueOnce(qb({ name: 'Acme' }));

      const result = await service.assignOrganization('contract', 'org-1');

      expect(mock.rpc).toHaveBeenCalledWith('assign_plan_to_org', {
        p_plan_key: 'contract',
        p_org_id: 'org-1',
      });
      expect(expectSuccess(result)).toEqual({ organizationId: 'org-1', name: 'Acme' });
    });

    it('maps a missing plan or organization to NOT_FOUND', async () => {
      mock.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: 'P0002', message: 'not found' },
      });

      const result = await service.assignOrganization('contract', 'org-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('maps the unassigned unlisted refusal to CONFLICT', async () => {
      mock.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'unlisted and not assigned' },
      });

      const result = await service.assignOrganization('contract', 'org-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT');
    });
  });

  describe('setOrganizationPlan', () => {
    it('moves the organization through change_org_plan', async () => {
      mock.rpc.mockResolvedValueOnce({ data: null, error: null });

      const result = await service.setOrganizationPlan('org-1', 'hub');

      expect(mock.rpc).toHaveBeenCalledWith('change_org_plan', {
        p_org_id: 'org-1',
        p_plan: 'hub',
      });
      expect(expectSuccess(result)).toEqual({ plan: 'hub' });
    });

    it('maps an unassigned unlisted plan to CONFLICT', async () => {
      mock.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'unlisted and not assigned' },
      });

      const result = await service.setOrganizationPlan('org-1', 'contract');

      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT');
    });

    it('maps an unknown plan to NOT_FOUND', async () => {
      mock.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: 'P0002', message: 'not found' },
      });

      const result = await service.setOrganizationPlan('org-1', 'nope');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('maps any other database failure through the shared mapper', async () => {
      mock.rpc.mockResolvedValueOnce({ data: null, error: { code: '08006', message: 'offline' } });

      const result = await service.setOrganizationPlan('org-1', 'hub');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('unassignOrganization', () => {
    it('refuses to unpin the organization that is on the plan', async () => {
      mock.from.mockReturnValueOnce(qb({ plan: 'contract' }));

      const result = await service.unassignOrganization('contract', 'org-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT');
      // The delete never runs: the check is the guard, not the report.
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('removes the pin when the organization is on another plan', async () => {
      const deleteQb = qb([{ plan_key: 'contract' }]);
      mock.from.mockReturnValueOnce(qb({ plan: 'launch' })).mockReturnValueOnce(deleteQb);

      const result = await service.unassignOrganization('contract', 'org-1');

      expect(result.success).toBe(true);
      expect(deleteQb.delete).toHaveBeenCalled();
      expect(deleteQb.eq).toHaveBeenCalledWith('plan_key', 'contract');
      expect(deleteQb.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('returns NOT_FOUND when the organization does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.unassignOrganization('contract', 'org-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when the pin does not exist', async () => {
      mock.from.mockReturnValueOnce(qb({ plan: 'launch' })).mockReturnValueOnce(qb([]));

      const result = await service.unassignOrganization('contract', 'org-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('maps the trigger refusal to CONFLICT', async () => {
      // The service check can pass while a concurrent plan change makes the
      // trigger refuse the delete; that must read as the same conflict.
      mock.from
        .mockReturnValueOnce(qb({ plan: 'launch' }))
        .mockReturnValueOnce(qb(null, { code: '23503', message: 'still the plan' }));

      const result = await service.unassignOrganization('contract', 'org-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT');
    });
  });

  describe('create', () => {
    it('creates a plan', async () => {
      const plan = { id: 'p-1', key: 'new', name: 'New Plan' };
      const insertQb = qb(plan);
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.create({ key: 'new', name: 'New Plan' });

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual(plan);
      expect(insertQb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'new', name: 'New Plan' }),
      );
    });

    it('writes scope from the input', async () => {
      const b = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b);

      await service.create({ key: 'hub', name: 'Hub', scope: 'organization' });

      expect(b.insert).toHaveBeenCalledWith(expect.objectContaining({ scope: 'organization' }));

      const b2 = qb({ id: 'p-2' });
      mock.from.mockReturnValueOnce(b2);

      await service.create({ key: 'max', name: 'Max', scope: 'personal' });

      expect(b2.insert).toHaveBeenCalledWith(expect.objectContaining({ scope: 'personal' }));
    });

    it('writes visibility and billing mode from the input (B3)', async () => {
      const b = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b);

      await service.create({
        key: 'contract',
        name: 'Contract',
        scope: 'organization',
        visibility: 'unlisted',
        billingMode: 'invoice',
      });

      expect(b.insert).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'unlisted', billing_mode: 'invoice' }),
      );
    });
  });

  describe('update', () => {
    it('updates a plan', async () => {
      const plan = { id: 'p-1', key: 'free', name: 'Updated' };
      const updateQb = qb(plan);
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.update('p-1', { name: 'Updated' });

      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated' }));
      expect(updateQb.eq).toHaveBeenCalledWith('id', 'p-1');
    });

    it('only writes scope when explicitly provided', async () => {
      const b = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b);

      await service.update('p-1', { name: 'Updated' });

      expect(b.update).toHaveBeenCalledWith(
        expect.not.objectContaining({ scope: expect.anything() as unknown }) as unknown,
      );

      const b2 = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b2);

      await service.update('p-1', { scope: 'organization' });

      expect(b2.update).toHaveBeenCalledWith(expect.objectContaining({ scope: 'organization' }));
    });

    it('only writes visibility and billing mode when explicitly provided (B3)', async () => {
      const b = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b);

      await service.update('p-1', { name: 'Updated' });

      expect(b.update).toHaveBeenCalledWith(
        expect.not.objectContaining({ visibility: expect.anything() as unknown }) as unknown,
      );

      const b2 = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b2);

      await service.update('p-1', { visibility: 'unlisted', billingMode: 'none' });

      expect(b2.update).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'unlisted', billing_mode: 'none' }),
      );
    });
  });

  describe('delete', () => {
    it('deletes an existing plan', async () => {
      const deleteQb = qb(undefined);
      mock.from.mockReturnValueOnce(qb({ id: 'p-1' }));
      mock.from.mockReturnValueOnce(deleteQb);

      const result = await service.delete('p-1');

      expect(result.success).toBe(true);
      expect(deleteQb.delete).toHaveBeenCalled();
      expect(deleteQb.eq).toHaveBeenCalledWith('id', 'p-1');
    });

    it('returns NOT_FOUND when plan does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.delete('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns CONFLICT when a plan is still referenced by organizations or users', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'p-1' }));
      mock.from.mockReturnValueOnce(
        qb(undefined, { code: '23503', message: 'violates foreign key constraint' }),
      );

      const result = await service.delete('p-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT');
    });
  });
});
