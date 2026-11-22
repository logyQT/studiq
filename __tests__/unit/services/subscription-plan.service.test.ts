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

function planRow(key: string, scope: string = 'personal', audience: string | null = 'student') {
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
    scope,
    audience,
  };
}

/** Resolver tables plus the `subscription_plans` catalog row for `key`. */
function mockPlanTables(
  mock: ReturnType<typeof mockSupabaseClient>,
  opts: Parameters<typeof mockResolverTables>[1],
  planKey: string | null,
  scope: string = 'personal',
  audience: string | null = 'student',
) {
  mockResolverTables(mock, opts);
  const baseImpl: (table: string) => unknown = vi.mocked(mock.from).getMockImplementation()!;
  mock.from.mockImplementation((table: string) => {
    if (table !== 'subscription_plans') return baseImpl(table);
    // Key-aware catalog read: a lookup for any other key finds no row, so a
    // wrong plan key resolves NOT_FOUND instead of silently passing.
    const row = planKey ? planRow(planKey, scope, audience) : null;
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
          key: 'base',
          name: 'Base',
          description: null,
          price_monthly: 0,
          currency: 'PLN',
          sort_order: 0,
          is_active: true,
        },
      ];
      const features = [{ plan_key: 'base', entitlement_key: 'quiz' }];
      const limits = [{ plan_key: 'base', limit_key: 'max_groups', limit_value: 3 }];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb(limits));

      const result = await service.listActive();

      expect(expectSuccess(result)).toHaveLength(1);
      expect(expectSuccess(result)[0]?.features).toEqual(['quiz']);
      expect(expectSuccess(result)[0]?.limits.max_groups).toBe(3);
    });

    it('maps scope/audience to the PlanInfo fields', async () => {
      const plans = [
        { id: 'p-1', key: 'hub', name: 'Hub', scope: 'organization', audience: null },
        { id: 'p-2', key: 'solo', name: 'Solo', scope: 'personal', audience: 'manager' },
        { id: 'p-3', key: 'base', name: 'Base', scope: 'personal', audience: 'student' },
      ];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.scope).toBe('organization');
      expect(expectSuccess(result)[0]?.audience).toBeNull();
      expect(expectSuccess(result)[1]?.scope).toBe('personal');
      expect(expectSuccess(result)[1]?.audience).toBe('manager');
    });

    it('derives seatEligible from the catalog embed: all keys seat-eligible', async () => {
      const plans = [planRow('ace')];
      const features = [
        {
          plan_key: 'ace',
          entitlement_key: 'flashcards',
          entitlement_catalog: { seat_eligible: true },
        },
        {
          plan_key: 'ace',
          entitlement_key: 'ai.chat',
          entitlement_catalog: { seat_eligible: true },
        },
      ];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb(features));
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
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(expectSuccess(result)[0]?.seatEligible).toBe(false);
      expect(expectSuccess(result)[1]?.seatEligible).toBe(false);
    });

    it('filters by scope and audience', async () => {
      const plansQb = qb([]);
      mock.from.mockReturnValueOnce(plansQb);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive({ scope: 'personal', audience: 'student' });

      expect(result.success).toBe(true);
      expect(plansQb.eq).toHaveBeenCalledWith('is_active', true);
      expect(plansQb.eq).toHaveBeenCalledWith('scope', 'personal');
      expect(plansQb.eq).toHaveBeenCalledWith('audience', 'student');
    });

    it('returns error on plans query failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listActive();

      expect(result.success).toBe(false);
    });

    it('returns error on features query failure', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'p-1', key: 'base', name: 'Base' }]));
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
          seatPlanKey: 'ace',
          personalPlanKey: 'base',
          planEntitlements: {
            launch: ['flashcards', 'quiz'],
            ace: ['flashcards', 'quiz', 'ai.chat', 'advanced.stats'],
            base: ['flashcards', 'quiz'],
          },
          planLimits: {
            launch: {
              max_flashcards: 100,
              max_quiz_attempts_per_day: 10,
              max_ai_tokens_per_day: 0,
              max_students: 5,
              max_groups: 3,
            },
            ace: {
              max_flashcards: 2000,
              max_quiz_attempts_per_day: -1,
              max_ai_tokens_per_day: 200000,
              max_students: -1,
              max_groups: -1,
            },
            base: {
              max_flashcards: 100,
              max_quiz_attempts_per_day: 10,
              max_ai_tokens_per_day: 0,
              max_students: -1,
              max_groups: -1,
            },
          },
        },
        'ace',
      );

      const result = await service.getMyPlan({
        ...ctx,
        activeOrgId: 'org-1',
        orgRoleId: 'role-member',
      });

      expect(result.success).toBe(true);
      const plan = expectSuccess(result);
      expect(plan.key).toBe('ace');
      // features/limits are the effective resolved set: the seat's ai.chat is
      // not in the launch ceiling, so it is not effective; the user-scope
      // limits are max(org, seat, personal) and org-scope limits stay the org's.
      expect(plan.features).toEqual(['flashcards', 'quiz']);
      expect(plan.limits.max_flashcards).toBe(2000);
      expect(plan.limits.max_ai_tokens_per_day).toBe(200000);
      expect(plan.limits.max_students).toBe(5);
      expect(plan.sources).toEqual([
        { planKey: 'launch', origin: 'org' },
        { planKey: 'ace', origin: 'seat' },
        { planKey: 'base', origin: 'personal' },
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
          personalPlanKey: 'pro',
        },
        'pro',
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
      expect(expectSuccess(result).key).toBe('pro');
    });

    it('returns the personal plan for an unseated student member, #181', async () => {
      mockPlanTables(
        mock,
        { orgPlan: 'launch', roleProfile: 'learner', personalPlanKey: 'base' },
        'base',
        'student',
      );

      const result = await service.getMyPlan({
        ...ctx,
        activeOrgId: 'org-1',
        orgRoleId: 'role-member',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('base');
    });

    it('a forged active_org_id with a stale seat row resolves the personal plan, never the seat, 3b', async () => {
      mockPlanTables(
        mock,
        {
          member: false, // no org_members row for the cookie's org
          orgPlan: 'hub',
          roleProfile: 'all',
          seatPlanKey: 'ace', // stale seat row in the foreign org
          personalPlanKey: 'base',
        },
        'base',
        'student',
      );

      const result = await service.getMyPlan({
        ...ctx,
        activeOrgId: 'org-foreign',
        orgRoleId: 'role-x',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('base');
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
      mockPlanTables(mock, { personalPlanKey: 'base' }, null);

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
        scope: 'organization',
        audience: null,
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
        scope: 'personal',
        audience: 'manager',
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
      const plansQb = qb([{ id: 'p-1', key: 'base', name: 'Base' }]);
      mock.from.mockReturnValueOnce(plansQb);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getAllAdmin();

      expect(result.success).toBe(true);
      expect(plansQb.order).toHaveBeenCalledWith('sort_order', { ascending: true });
      expect(expectSuccess(result).map((plan) => plan.key)).toEqual(['base']);
    });
  });

  describe('getByKey', () => {
    it('returns plan by key', async () => {
      const plan = {
        id: 'p-1',
        key: 'base',
        name: 'Base',
        description: null,
        price_monthly: 0,
        currency: 'PLN',
        sort_order: 0,
        is_active: true,
      };
      const plansQb = qb(plan);
      mock.from.mockReturnValueOnce(plansQb);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getByKey('base');

      expect(result.success).toBe(true);
      expect(plansQb.eq).toHaveBeenCalledWith('key', 'base');
      expect(expectSuccess(result).key).toBe('base');
    });

    it('returns NOT_FOUND when not found', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getByKey('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('getById', () => {
    it('returns plan by id', async () => {
      const plan = { id: 'p-1', key: 'base' };
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

    it('writes scope/audience from the input', async () => {
      const b = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b);

      await service.create({ key: 'hub', name: 'Hub', scope: 'organization', audience: null });

      expect(b.insert).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'organization', audience: null }),
      );

      const b2 = qb({ id: 'p-2' });
      mock.from.mockReturnValueOnce(b2);

      await service.create({ key: 'solo', name: 'Solo', scope: 'personal', audience: 'manager' });

      expect(b2.insert).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'personal', audience: 'manager' }),
      );
    });
  });

  describe('update', () => {
    it('updates a plan', async () => {
      const plan = { id: 'p-1', key: 'base', name: 'Updated' };
      const updateQb = qb(plan);
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.update('p-1', { name: 'Updated' });

      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated' }));
      expect(updateQb.eq).toHaveBeenCalledWith('id', 'p-1');
    });

    it('only writes scope/audience when explicitly provided', async () => {
      const b = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b);

      await service.update('p-1', { name: 'Updated' });

      expect(b.update).toHaveBeenCalledWith(
        expect.not.objectContaining({ scope: expect.anything() as unknown }) as unknown,
      );
      expect(b.update).toHaveBeenCalledWith(
        expect.not.objectContaining({ audience: expect.anything() as unknown }) as unknown,
      );

      const b2 = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b2);

      await service.update('p-1', { audience: null });

      expect(b2.update).toHaveBeenCalledWith(expect.objectContaining({ audience: null }));
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
