import { PlanLimitService } from '@admin/server/services/plan-limit.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('PlanLimitService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: PlanLimitService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new PlanLimitService(async () => mock as any);
  });

  describe('getByPlanKey', () => {
    it('returns limits for plan key', async () => {
      const limits = [{ id: 'l-1', plan_key: 'base', limit_key: 'max_groups', limit_value: 3 }];
      mock.from.mockReturnValueOnce(qb(limits));

      const result = await service.getByPlanKey('base');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(limits);
      expect(mock.from).toHaveBeenCalledWith('plan_limits');
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getByPlanKey('base');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getAll', () => {
    it('returns all limits', async () => {
      const limits = [{ id: 'l-1', plan_key: 'base', limit_key: 'max_groups', limit_value: 3 }];
      mock.from.mockReturnValueOnce(qb(limits));

      const result = await service.getAll();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(limits);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getAll();

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('create', () => {
    it('creates a plan limit', async () => {
      const limit = { id: 'l-1', plan_key: 'base', limit_key: 'max_groups', limit_value: 3 };
      mock.from.mockReturnValueOnce(qb(limit));

      const result = await service.create({
        planKey: 'base',
        limitKey: 'max_groups',
        limitValue: 3,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(limit);
      expect(mock.from).toHaveBeenCalledWith('plan_limits');
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.create({
        planKey: 'base',
        limitKey: 'max_groups',
        limitValue: 3,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('update', () => {
    it('updates a plan limit', async () => {
      const limit = { id: 'l-1', plan_key: 'base', limit_key: 'max_groups', limit_value: 5 };
      mock.from.mockReturnValueOnce(qb(limit));

      const result = await service.update('l-1', { limitValue: 5 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(limit);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.update('l-1', { limitValue: 5 });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('delete', () => {
    it('deletes an existing plan limit', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'l-1' }));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.delete('l-1');

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when limit does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.delete('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns error on delete failure', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'l-1' }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.delete('l-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });
});
