import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universityService } from './university.service';
import { createClient } from '@/lib/supabase/server';

const mockSupabase = {
  from: vi.fn(),
};

vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

describe('UniversityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      mockSupabase.from.mockReturnValue(mockChain);

      const result = await universityService.create({ name: 'Test University', slug: 'test' });

      expect(result).toEqual(university);
      expect(mockSupabase.from).toHaveBeenCalledWith('universities');
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
      mockSupabase.from.mockReturnValue(mockChain);

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
      mockSupabase.from.mockReturnValue(mockChain);

      await expect(universityService.create({ name: 'Test', slug: 'test' })).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });
});
