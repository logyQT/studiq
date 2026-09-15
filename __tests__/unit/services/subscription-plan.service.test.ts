import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { SubscriptionPlanService } from '@/server/services/subscription-plan.service';

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.neq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('SubscriptionPlanService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: SubscriptionPlanService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: 'student' as any,
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
    service = new SubscriptionPlanService(async () => mock as any);
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
      const features = [{ plan_key: 'base', feature_key: 'quiz' }];
      const limits = [{ plan_key: 'base', limit_key: 'max_groups', limit_value: 3 }];
      mock.from.mockReturnValueOnce(qb(plans));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb(limits));

      const result = await service.listActive();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].features).toEqual(['quiz']);
      expect(result.data[0].limits.max_groups).toBe(3);
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
    it('returns org plan when activeOrgId set', async () => {
      const org = { plan: 'base' };
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
      const features = [{ feature_key: 'quiz' }];
      const limits = [{ plan_key: 'base', limit_key: 'max_groups', limit_value: 3 }];
      mock.from.mockReturnValueOnce(qb(org));
      mock.from.mockReturnValueOnce(qb(plan));
      mock.from.mockReturnValueOnce(qb(features));
      mock.from.mockReturnValueOnce(qb(limits));

      const result = await service.getMyPlan({ ...ctx, activeOrgId: 'org-1' });

      expect(result.success).toBe(true);
      expect(result.data.key).toBe('base');
    });

    it('returns personal plan when no org', async () => {
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
      mock.from.mockReturnValueOnce(qb(profile)); // profile
      mock.from.mockReturnValueOnce(qb(plan)); // plan
      mock.from.mockReturnValueOnce(qb([])); // features
      mock.from.mockReturnValueOnce(qb([])); // limits

      const result = await service.getMyPlan(ctx);

      expect(result.success).toBe(true);
      expect(result.data.key).toBe('free');
    });

    it('returns NOT_FOUND when no plan key', async () => {
      mock.from.mockReturnValueOnce(qb(null, null)); // no profile

      const result = await service.getMyPlan({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when plan not found', async () => {
      mock.from.mockReturnValueOnce(qb(null, null)); // no profile
      // no org, falls to profile
      const result = await service.getMyPlan({ ...ctx, activeOrgId: null });

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
      expect(result.data).toEqual(plan);
    });
  });

  describe('update', () => {
    it('updates a plan', async () => {
      const plan = { id: 'p-1', key: 'base', name: 'Updated' };
      mock.from.mockReturnValueOnce(qb(plan));

      const result = await service.update('p-1', { name: 'Updated' });

      expect(result.success).toBe(true);
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
  });
});
