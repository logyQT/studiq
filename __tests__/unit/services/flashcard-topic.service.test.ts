import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardTopicService } from '@/server/services/flashcard-topic.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

describe('FlashcardTopicService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts topic and returns it', async () => {
      const mockProfile = { id: userId, organization_id: 'uni-1' };
      const mockTopic = { id: 't-1', name: 'Math Topics' };

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockTopic, error: null }),
          }),
        }),
      });

      const result = await flashcardTopicService.create({ name: 'Math Topics' }, userId);

      expect(result).toEqual(mockTopic);
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(flashcardTopicService.create({ name: 'Math Topics' }, userId)).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('list', () => {
    it('returns topics for user', async () => {
      const mockProfile = { id: userId, organization_id: null };
      const topics = [{ id: 't-1', name: 'Math Topics', flashcard_topic_assignments: [] }];

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: topics, error: null }),
        }),
      });

      const result = await flashcardTopicService.list(userId);

      expect(result).toBeDefined();
      expect(result.length).toBe(1);
    });

    it('throws INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        }),
      });

      await expect(flashcardTopicService.list(userId)).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns topic when found', async () => {
      const topic = { id: 't-1', name: 'Math Topics' };
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: topic, error: null }),
          }),
        }),
      });

      const result = await flashcardTopicService.getById('t-1');

      expect(result).toEqual(topic);
    });

    it('throws NOT_FOUND when topic does not exist', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      await expect(flashcardTopicService.getById('nonexistent')).rejects.toThrow('ERROR_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates topic and returns it', async () => {
      const updated = { id: 't-1', name: 'Updated' };
      mock.from.mockReturnValue({
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

      const result = await flashcardTopicService.update('t-1', { name: 'Updated' }, userId);

      expect(result).toEqual(updated);
    });

    it('throws FORBIDDEN when topic not owned by user', async () => {
      mock.from.mockReturnValue({
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
        flashcardTopicService.update('t-1', { name: 'Updated' }, userId),
      ).rejects.toThrow('ERROR_FORBIDDEN');
    });
  });

  describe('delete', () => {
    it('deletes topic successfully', async () => {
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 't-1' }, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(flashcardTopicService.delete('t-1', userId)).resolves.toBeUndefined();
    });
  });
});
