import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universityService } from '@/server/services/university.service';
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

  describe('getAll', () => {
    it('returns array of universities', async () => {
      const universities = [
        { id: 'uni-1', name: 'University 1', slug: 'uni-1' },
        { id: 'uni-2', name: 'University 2', slug: 'uni-2' },
      ];
      const mockChain = {
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: universities, error: null }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      const result = await universityService.getAll();

      expect(result).toEqual(universities);
      expect(mock.from).toHaveBeenCalledWith('universities');
    });

    it('throws INTERNAL_SERVER on error', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.getAll()).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns university by id', async () => {
      const university = { id: 'uni-1', name: 'Test University', slug: 'test' };
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: university, error: null }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      const result = await universityService.getById('uni-1');

      expect(result).toEqual(university);
      expect(mock.from).toHaveBeenCalledWith('universities');
    });

    it('throws NOT_FOUND when university does not exist', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116', message: 'not found' },
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.getById('nonexistent')).rejects.toThrow('ERROR_NOT_FOUND');
    });

    it('throws INTERNAL_SERVER on other errors', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'other', message: 'error' },
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.getById('uni-1')).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('update', () => {
    it('updates university and returns it', async () => {
      const updated = { id: 'uni-1', name: 'Updated Name', slug: 'test' };
      const mockChain = {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updated, error: null }),
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      const result = await universityService.update('uni-1', { name: 'Updated Name' });

      expect(result).toEqual(updated);
      expect(mock.from).toHaveBeenCalledWith('universities');
      expect(mockChain.update).toHaveBeenCalledWith({ name: 'Updated Name' });
    });

    it('throws CONFLICT on duplicate slug (23505)', async () => {
      const mockChain = {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23505', message: 'duplicate key' },
              }),
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.update('uni-1', { slug: 'taken' })).rejects.toThrow(
        'ERROR_CONFLICT',
      );
    });

    it('throws NOT_FOUND when university does not exist', async () => {
      const mockChain = {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST116', message: 'not found' },
              }),
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.update('nonexistent', { name: 'New' })).rejects.toThrow(
        'ERROR_NOT_FOUND',
      );
    });

    it('throws INTERNAL_SERVER on other errors', async () => {
      const mockChain = {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'other', message: 'error' },
              }),
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.update('uni-1', { name: 'New' })).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('delete', () => {
    it('deletes university successfully', async () => {
      const checkChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'uni-1' }, error: null }),
          }),
        }),
      };
      const deleteChain = {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
      const updateChain = {
        delete: vi.fn().mockReturnValue(deleteChain),
      };
      mock.from.mockReturnValueOnce(checkChain).mockReturnValueOnce(updateChain);

      const result = await universityService.delete('uni-1');

      expect(result).toEqual({ success: true });
    });

    it('throws NOT_FOUND when university does not exist', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(universityService.delete('nonexistent')).rejects.toThrow('ERROR_NOT_FOUND');
    });

    it('throws INTERNAL_SERVER on delete error', async () => {
      const checkChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'uni-1' }, error: null }),
          }),
        }),
      };
      const deleteChain = {
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: { message: 'db error' } }),
        }),
      };
      mock.from.mockReturnValueOnce(checkChain).mockReturnValueOnce(deleteChain);

      await expect(universityService.delete('uni-1')).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });
});
