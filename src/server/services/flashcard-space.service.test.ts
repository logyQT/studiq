import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardSpaceService } from './flashcard-space.service';
import { createClient } from '@/lib/supabase/server';

describe('FlashcardSpaceService', () => {
  const userId = 'test-user-id';
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    vi.mocked(createClient).mockResolvedValue(mockSupabase);
  });

  describe('create', () => {
    it('inserts space and returns it', async () => {
      const mockSpace = { id: 's-1', name: 'Study Space', created_by: userId };
      mockSupabase.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockSpace, error: null }),
          }),
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockSpace, error: null }),
            }),
          }),
        }),
      });

      const result = await flashcardSpaceService.create({ name: 'Study Space' }, userId);

      expect(result).toBeDefined();
      expect(mockSupabase.from).toHaveBeenCalledWith('flashcard_spaces');
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(flashcardSpaceService.create({ name: 'Study Space' }, userId)).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('list', () => {
    it('returns spaces for user', async () => {
      const spaces = [{ id: 's-1', name: 'Study Space', flashcard_space_assignments: [] }];
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: spaces, error: null }),
          }),
        }),
      });

      const result = await flashcardSpaceService.list(userId);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('throws INTERNAL_SERVER when query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(flashcardSpaceService.list(userId)).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns space when found', async () => {
      const space = { id: 's-1', name: 'Study Space', flashcard_space_assignments: [] };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: space, error: null }),
            }),
          }),
        }),
      });

      const result = await flashcardSpaceService.getById('s-1', userId);

      expect(result).toBeDefined();
    });

    it('throws NOT_FOUND when space does not exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      await expect(flashcardSpaceService.getById('nonexistent', userId)).rejects.toThrow(
        'ERROR_NOT_FOUND',
      );
    });
  });

  describe('update', () => {
    it('updates space and returns it', async () => {
      const updated = { id: 's-1', name: 'Updated', flashcard_space_assignments: [] };
      mockSupabase.from.mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: updated, error: null }),
              }),
            }),
          }),
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updated, error: null }),
            }),
          }),
        }),
      });

      const result = await flashcardSpaceService.update('s-1', { name: 'Updated' }, userId);

      expect(result).toBeDefined();
    });

    it('throws FORBIDDEN when space not owned by user', async () => {
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(
        flashcardSpaceService.update('s-1', { name: 'Updated' }, userId),
      ).rejects.toThrow('ERROR_FORBIDDEN');
    });
  });

  describe('delete', () => {
    it('deletes space successfully', async () => {
      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 's-1' }, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(flashcardSpaceService.delete('s-1', userId)).resolves.toBeUndefined();
    });
  });
});
