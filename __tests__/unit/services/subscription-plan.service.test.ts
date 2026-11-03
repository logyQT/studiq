import { AccountType, type RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { SubscriptionPlanService } from '@studiq/server/services/subscription-plan.service';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
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

function planRow(key: string, forAccountType: string | null = null) {
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
    for_account_type: forAccountType,
  };
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

  function mockTables(
    tables: Record<string, unknown>,
    errors: Record<string, { message: string }> = {},
  ) {
    mock.from.mockImplementation((table: string) =>
      qb(tables[table] ?? null, errors[table] ?? null),
    );
  }

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
      const features = [{ plan_key: 'base', feature_key: 'quiz' }];
      const limits = [{ plan_key: 'base', limit_key: 'max_groups', limit_value: 3 }];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb(limits));

      const result = await service.listActive();

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toHaveLength(1);
      expect(expectSuccess(result)[0].features).toEqual(['quiz']);
      expect(expectSuccess(result)[0].limits.max_groups).toBe(3);
    });

    it('maps for_account_type to forAccountType, defaulting to null', async () => {
      const plans = [
        { id: 'p-1', key: 'hub', name: 'Hub', for_account_type: 'manager' },
        { id: 'p-2', key: 'base', name: 'Base', for_account_type: null },
      ];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive();

      expect(result.success).toBe(true);
      expect(expectSuccess(result)[0].forAccountType).toBe('manager');
      expect(expectSuccess(result)[1].forAccountType).toBeNull();
    });

    it('filters by account type', async () => {
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.listActive('student');

      expect(result.success).toBe(true);
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
    it('returns the seat plan to a seated student in an active org (#270)', async () => {
      mockTables({
        org_seat_assignments: { pool_id: 'pool-1' },
        org_seat_pools: { plan_key: 'ace' },
        subscription_plans: planRow('ace'),
        plan_features: [{ feature_key: 'ai.chat' }, { feature_key: 'advanced.stats' }],
        plan_limits: [
          { plan_key: 'ace', limit_key: 'max_ai_tokens_per_day', limit_value: 200000 },
          { plan_key: 'ace', limit_key: 'max_decks', limit_value: 200 },
        ],
      });

      const result = await service.getMyPlan({ ...ctx, activeOrgId: 'org-1' });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('ace');
      expect(expectSuccess(result).limits.max_ai_tokens_per_day).toBe(200000);
      expect(expectSuccess(result).limits.max_decks).toBe(200);
      expect(expectSuccess(result).features).toEqual(
        expect.arrayContaining(['ai.chat', 'advanced.stats']),
      );
      expect(mock.from).not.toHaveBeenCalledWith('profiles');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('returns the seat plan to a seated educator in an active org (#270)', async () => {
      mockTables({
        org_seat_assignments: { pool_id: 'pool-1' },
        org_seat_pools: { plan_key: 'ace' },
        subscription_plans: planRow('ace'),
        plan_features: [{ feature_key: 'ai.chat' }],
      });

      const result = await service.getMyPlan({
        ...ctx,
        accountType: AccountType.EDUCATOR,
        activeOrgId: 'org-1',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('ace');
      expect(mock.from).not.toHaveBeenCalledWith('profiles');
    });

    it('returns the org plan for a manager in an active org (#181)', async () => {
      mockTables({
        org_seat_assignments: { pool_id: 'pool-1' },
        organizations: { plan: 'hub' },
        subscription_plans: planRow('hub', 'manager'),
        plan_features: [{ feature_key: 'documents' }],
        plan_limits: [{ plan_key: 'hub', limit_key: 'max_groups', limit_value: 3 }],
      });

      const result = await service.getMyPlan({
        ...ctx,
        accountType: AccountType.MANAGER,
        activeOrgId: 'org-1',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('hub');
      expect(expectSuccess(result).limits.max_groups).toBe(3);
      // Managers are the org's billing contact: the seat never overrides the org plan.
      expect(mock.from).not.toHaveBeenCalledWith('org_seat_assignments');
    });

    it('returns the personal plan for an unseated student in an active org (#181)', async () => {
      mockTables({
        profiles: { personal_plan_key: 'base' },
        subscription_plans: planRow('base', 'student'),
      });

      const result = await service.getMyPlan({ ...ctx, activeOrgId: 'org-1' });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('base');
      expect(mock.from).toHaveBeenCalledWith('org_seat_assignments');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('returns the personal plan for an unseated educator in an active org (#181)', async () => {
      mockTables({
        profiles: { personal_plan_key: 'lite' },
        subscription_plans: planRow('lite', 'educator'),
      });

      const result = await service.getMyPlan({
        ...ctx,
        accountType: AccountType.EDUCATOR,
        activeOrgId: 'org-1',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('lite');
    });

    it('falls back to the personal plan when a manager has no org plan', async () => {
      mockTables({
        profiles: { personal_plan_key: 'launch' },
        subscription_plans: planRow('launch', 'manager'),
      });

      const result = await service.getMyPlan({
        ...ctx,
        accountType: AccountType.MANAGER,
        activeOrgId: 'org-1',
      });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('launch');
    });

    it('returns the manager free personal plan with no active org (#228)', async () => {
      mockTables({
        profiles: { personal_plan_key: 'launch' },
        subscription_plans: planRow('launch', 'manager'),
      });

      const result = await service.getMyPlan({ ...ctx, accountType: AccountType.MANAGER });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('launch');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('returns personal plan when no org', async () => {
      mockTables({
        profiles: { personal_plan_key: 'free' },
        subscription_plans: planRow('free'),
      });

      const result = await service.getMyPlan(ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('free');
      expect(mock.from).not.toHaveBeenCalledWith('org_seat_assignments');
    });

    it('returns NOT_FOUND when no plan key', async () => {
      mockTables({});

      const result = await service.getMyPlan({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when plan not found', async () => {
      mockTables({ profiles: { personal_plan_key: 'base' } });

      const result = await service.getMyPlan({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when the seat plan key has no plan row', async () => {
      mockTables({
        org_seat_assignments: { pool_id: 'pool-1' },
        org_seat_pools: { plan_key: 'ace' },
      });

      const result = await service.getMyPlan({ ...ctx, activeOrgId: 'org-1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns an error when the org query fails', async () => {
      mockTables({}, { organizations: { message: 'DB error' } });

      const result = await service.getMyPlan({
        ...ctx,
        accountType: AccountType.MANAGER,
        activeOrgId: 'org-1',
      });

      expect(result.success).toBe(false);
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
    });

    it('reports the free manager plan for a manager carrying a purchased org plan (#228)', async () => {
      // Legacy checkout rows copied the bought org plan into the personal plan.
      // Managers have no paid personal plan, so the row is inert: report the
      // free manager tier instead of the org plan.
      const paidOrgPlan = {
        id: 'p-hub',
        key: 'hub',
        name: 'StudiQ Hub',
        description: null,
        price_monthly: 1999,
        price_yearly: 0,
        currency: 'PLN',
        sort_order: 9,
        is_active: true,
        for_account_type: 'manager',
      };
      const freeManagerPlan = {
        id: 'p-launch',
        key: 'launch',
        name: 'StudiQ Launch',
        description: null,
        price_monthly: 0,
        price_yearly: 0,
        currency: 'PLN',
        sort_order: 3,
        is_active: true,
        for_account_type: 'manager',
      };
      mock.from
        .mockReturnValueOnce(qb({ personal_plan_key: 'hub' }))
        .mockReturnValueOnce(qb(paidOrgPlan))
        .mockReturnValueOnce(qb(freeManagerPlan))
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(qb([]));

      const result = await service.getPersonalPlan({ ...ctx, accountType: AccountType.MANAGER });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('launch');
    });

    it('keeps a manager on the free personal plan without an extra catalog lookup (#228)', async () => {
      const freeManagerPlan = {
        id: 'p-launch',
        key: 'launch',
        name: 'StudiQ Launch',
        description: null,
        price_monthly: 0,
        price_yearly: 0,
        currency: 'PLN',
        sort_order: 3,
        is_active: true,
        for_account_type: 'manager',
      };
      mock.from
        .mockReturnValueOnce(qb({ personal_plan_key: 'launch' }))
        .mockReturnValueOnce(qb(freeManagerPlan))
        .mockReturnValueOnce(qb([]))
        .mockReturnValueOnce(qb([]));

      const result = await service.getPersonalPlan({ ...ctx, accountType: AccountType.MANAGER });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).key).toBe('launch');
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
      mock.from.mockReturnValueOnce(qb([{ id: 'p-1', key: 'base', name: 'Base' }]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getAllAdmin();

      expect(result.success).toBe(true);
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
      mock.from.mockReturnValueOnce(qb(plan));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getByKey('base');

      expect(result.success).toBe(true);
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
      mock.from.mockReturnValueOnce(qb({ id: 'p-1', key: 'base' }));

      const result = await service.getById('p-1');

      expect(result.success).toBe(true);
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
      mock.from.mockReturnValueOnce(qb(plan));

      const result = await service.create({ key: 'new', name: 'New Plan' });

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toEqual(plan);
    });

    it('writes for_account_type from forAccountType, defaulting to null', async () => {
      const b = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b);

      await service.create({ key: 'hub', name: 'Hub', forAccountType: 'manager' });

      expect(b.insert).toHaveBeenCalledWith(
        expect.objectContaining({ for_account_type: 'manager' }),
      );

      const b2 = qb({ id: 'p-2' });
      mock.from.mockReturnValueOnce(b2);

      await service.create({ key: 'base', name: 'Base' });

      expect(b2.insert).toHaveBeenCalledWith(expect.objectContaining({ for_account_type: null }));
    });
  });

  describe('update', () => {
    it('updates a plan', async () => {
      const plan = { id: 'p-1', key: 'base', name: 'Updated' };
      mock.from.mockReturnValueOnce(qb(plan));

      const result = await service.update('p-1', { name: 'Updated' });

      expect(result.success).toBe(true);
    });

    it('only writes for_account_type when explicitly provided', async () => {
      const b = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b);

      await service.update('p-1', { name: 'Updated' });

      expect(b.update).toHaveBeenCalledWith(
        expect.not.objectContaining({ for_account_type: expect.anything() as unknown }) as unknown,
      );

      const b2 = qb({ id: 'p-1' });
      mock.from.mockReturnValueOnce(b2);

      await service.update('p-1', { forAccountType: null });

      expect(b2.update).toHaveBeenCalledWith(
        expect.objectContaining({ for_account_type: null }) as unknown,
      );
    });
  });

  describe('delete', () => {
    it('deletes an existing plan', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'p-1' }));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.delete('p-1');

      expect(result.success).toBe(true);
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
