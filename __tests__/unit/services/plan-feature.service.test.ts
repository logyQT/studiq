import { PlanFeatureService } from '@admin/server/services/plan-feature.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type ChainMock = ReturnType<typeof vi.fn>;

/** A thenable PostgREST builder stand-in: every chain method returns itself. */
interface QueryBuilder {
  select: ChainMock;
  insert: ChainMock;
  update: ChainMock;
  delete: ChainMock;
  eq: ChainMock;
  order: ChainMock;
  single: ChainMock;
  maybeSingle: ChainMock;
  then: ChainMock;
  catch: ChainMock;
  finally: ChainMock;
}

const CHAIN_METHODS = ['select', 'insert', 'update', 'delete', 'eq', 'order'] as const;

function qb(data: unknown, error: unknown = null): QueryBuilder {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const builder: QueryBuilder = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: vi.fn(promise.then.bind(promise)),
    catch: vi.fn(promise.catch.bind(promise)),
    finally: vi.fn(promise.finally.bind(promise)),
  };
  for (const method of CHAIN_METHODS) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
}

describe('PlanFeatureService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: PlanFeatureService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new PlanFeatureService(() => Promise.resolve(mock));
  });

  describe('getAll', () => {
    it('returns all plan features', async () => {
      const features = [{ id: 'f-1', plan_key: 'base', feature_key: 'quiz' }];
      mock.from.mockReturnValueOnce(qb(features));

      const result = await service.getAll();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(features);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getAll();

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getByPlanKey', () => {
    it('returns features for plan key', async () => {
      const features = [{ id: 'f-1', plan_key: 'base', feature_key: 'quiz' }];
      mock.from.mockReturnValueOnce(qb(features));

      const result = await service.getByPlanKey('base');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(features);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getByPlanKey('base');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('create', () => {
    it('creates a plan feature', async () => {
      const feature = { id: 'f-1', plan_key: 'base', feature_key: 'quiz' };
      mock.from.mockReturnValueOnce(qb(feature));

      const result = await service.create({ planKey: 'base', featureKey: 'quiz' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(feature);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.create({ planKey: 'base', featureKey: 'quiz' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('delete', () => {
    it('deletes an existing plan feature', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'f-1' }));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.delete('f-1');

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when feature does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.delete('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns error on delete failure', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'f-1' }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.delete('f-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });
});
