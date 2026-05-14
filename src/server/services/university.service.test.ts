import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universityService } from './university.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

describe('UniversityService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts university and returns it', async () => {
      const university = { id: 'uni-1', name: 'Test University', slug: 'test' };
      const mockChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: university, error: null }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      const result = await universityService.create({ name: 'Test University', slug: 'test' });

      expect(result).toEqual(university);
      expect(mock.from).toHaveBeenCalledWith('universities');
      expect(mockChain.insert).toHaveBeenCalledWith({ name: 'Test University', slug: 'test' });
    });

    it('throws CONFLICT on duplicate slug (23505)', async () => {
      const mockChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key' },
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.create({ name: 'Test', slug: 'taken' })).rejects.toThrow(
        'ERROR_CONFLICT',
      );
    });

    it('throws INTERNAL_SERVER on other errors', async () => {
      const mockChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'other', message: 'error' },
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.create({ name: 'Test', slug: 'test' })).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });
});
