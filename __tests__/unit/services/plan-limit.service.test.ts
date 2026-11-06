import { PlanLimitService } from '@admin/server/services/plan-limit.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type QueryResult = { data: unknown; error: unknown };

/** A chainable Supabase query builder stub that is also awaitable. */
type QueryBuilder = {
  select: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  eq: Mock;
  order: Mock;
  single: Mock;
  maybeSingle: Mock;
} & Pick<Promise<QueryResult>, 'then' | 'catch' | 'finally'>;

function qb(data: unknown, error: unknown = null): QueryBuilder {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: QueryBuilder = {
    select: vi.fn(() => b),
    insert: vi.fn(() => b),
    update: vi.fn(() => b),
    delete: vi.fn(() => b),
    eq: vi.fn(() => b),
    order: vi.fn(() => b),
    single: vi.fn().mockResolvedValue({ data: data ?? null, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data: data ?? null, error }),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return b;
}

describe('PlanLimitService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: PlanLimitService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new PlanLimitService(() => Promise.resolve(mock));
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
