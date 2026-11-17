import { UserOverrideService } from '@admin/server/services/user-override.service';
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
    single: vi.fn(),
    maybeSingle: vi.fn(),
    then: vi.fn(),
    catch: vi.fn(),
    finally: vi.fn(),
  };
  for (const method of CHAIN_METHODS) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = vi.fn(promise.then.bind(promise));
  builder.catch = vi.fn(promise.catch.bind(promise));
  builder.finally = vi.fn(promise.finally.bind(promise));
  return builder;
}

describe('UserOverrideService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: UserOverrideService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new UserOverrideService(() => Promise.resolve(mock));
  });

  describe('getAll', () => {
    it('returns all overrides', async () => {
      const listQb = qb([{ id: 'ov-1' }]);
      mock.from.mockReturnValueOnce(listQb);
      const result = await service.getAll();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(mock.from).toHaveBeenCalledWith('user_feature_overrides');
      expect(listQb.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });
    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));
      const result = await service.getAll();
      expect(result.success).toBe(false);
    });
  });

  describe('getById', () => {
    it('returns override when found', async () => {
      const findQb = qb({ id: 'ov-1' });
      mock.from.mockReturnValueOnce(findQb);
      const result = await service.getById('ov-1');
      expect(result.success).toBe(true);
      expect(findQb.eq).toHaveBeenCalledWith('id', 'ov-1');
      expect(result.data).toEqual({ id: 'ov-1' });
    });
    it('returns NOT_FOUND when not found', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));
      const result = await service.getById('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('create', () => {
    it('creates an override', async () => {
      const ov = { id: 'ov-1', user_id: 'u-1', feature_key: 'quiz', is_enabled: true };
      const insertQb = qb(ov);
      mock.from.mockReturnValueOnce(insertQb);
      const result = await service.create({ userId: 'u-1', featureKey: 'quiz', isEnabled: true });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(ov);
      expect(insertQb.insert).toHaveBeenCalledWith({
        user_id: 'u-1',
        feature_key: 'quiz',
        is_enabled: true,
        reason: null,
        expires_at: null,
      });
    });
    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));
      const result = await service.create({ userId: 'u-1', featureKey: 'quiz', isEnabled: true });
      expect(result.success).toBe(false);
    });
  });

  describe('update', () => {
    it('updates an override', async () => {
      const updateQb = qb({ id: 'ov-1', is_enabled: false });
      mock.from.mockReturnValueOnce(updateQb);
      const result = await service.update('ov-1', { isEnabled: false });
      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith({ is_enabled: false });
      expect(updateQb.eq).toHaveBeenCalledWith('id', 'ov-1');
    });
    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));
      const result = await service.update('ov-1', { isEnabled: false });
      expect(result.success).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes an existing override', async () => {
      const existsQb = qb({ id: 'ov-1' });
      const deleteQb = qb(undefined);
      mock.from.mockReturnValueOnce(existsQb);
      mock.from.mockReturnValueOnce(deleteQb);
      const result = await service.delete('ov-1');
      expect(result.success).toBe(true);
      // Select-then-delete: the existence probe scopes the read to the same id.
      expect(existsQb.select).toHaveBeenCalledWith('id');
      expect(existsQb.eq).toHaveBeenCalledWith('id', 'ov-1');
      expect(deleteQb.delete).toHaveBeenCalled();
      expect(deleteQb.eq).toHaveBeenCalledWith('id', 'ov-1');
    });
    it('returns NOT_FOUND when not found', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));
      const result = await service.delete('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
    it('returns error on delete failure', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'ov-1' }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));
      const result = await service.delete('ov-1');
      expect(result.success).toBe(false);
    });
  });
});
