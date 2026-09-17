import { FeatureFlagService } from '@studiq/server/services/feature-flag.service';
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

describe('FeatureFlagService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: FeatureFlagService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new FeatureFlagService(async () => mock as any);
  });

  describe('getAll', () => {
    it('returns all feature flags', async () => {
      const flags = [{ id: 'ff-1', key: 'quiz', name: 'Quiz', is_enabled: true }];
      mock.from.mockReturnValueOnce(qb(flags));

      const result = await service.getAll();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(flags);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getAll();

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns flag when found', async () => {
      const flag = { id: 'ff-1', key: 'quiz', name: 'Quiz' };
      mock.from.mockReturnValueOnce(qb(flag));

      const result = await service.getById('ff-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(flag);
    });

    it('returns NOT_FOUND when not found', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getById('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('create', () => {
    it('creates a feature flag', async () => {
      const flag = {
        id: 'ff-1',
        key: 'quiz',
        name: 'Quiz',
        is_enabled: true,
        rollout_percentage: 100,
      };
      mock.from.mockReturnValueOnce(qb(flag));

      const result = await service.create({ key: 'quiz', name: 'Quiz' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(flag);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.create({ key: 'quiz', name: 'Quiz' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('update', () => {
    it('updates a feature flag', async () => {
      const flag = { id: 'ff-1', key: 'quiz', name: 'Quiz Updated', is_enabled: false };
      mock.from.mockReturnValueOnce(qb(flag));

      const result = await service.update('ff-1', { name: 'Quiz Updated', isEnabled: false });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(flag);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.update('ff-1', { name: 'Quiz Updated' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('delete', () => {
    it('deletes a feature flag', async () => {
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.delete('ff-1');

      expect(result.success).toBe(true);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.delete('ff-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });
});
