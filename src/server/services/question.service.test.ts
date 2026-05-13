import { describe, it, expect, vi, beforeEach } from 'vitest';
import { questionService } from './question.service';
import { createClient } from '@/lib/supabase/server';

describe('QuestionService', () => {
  const userId = 'test-user-id';
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    vi.mocked(createClient).mockResolvedValue(mockSupabase);
  });

  describe('create', () => {
    it('inserts question and answers and returns it', async () => {
      const mockQuestion = { id: 'q-1', type: 'mcq', content: 'Q1' };
      const fromMock = vi.fn();
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockQuestion, error: null }),
          }),
        }),
      });

      const result = await questionService.create(
        { type: 'mcq', content: 'Q1', answers: [{ content: 'A1', isCorrect: true }] },
        userId,
      );

      expect(result).toBeDefined();
      expect(mockSupabase.from).toHaveBeenCalledWith('questions');
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(
        questionService.create(
          { type: 'mcq', content: 'Q1', answers: [{ content: 'A1', isCorrect: true }] },
          userId,
        ),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('list', () => {
    it('returns all questions when no filter', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: questions, error: null }),
        }),
      });

      const result = await questionService.list();

      expect(result).toEqual(questions);
    });

    it('filters by subjectId when provided', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];
      const eqFn = vi.fn().mockResolvedValue({ data: questions, error: null });
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({ eq: eqFn }),
        }),
      });

      const result = await questionService.list({ subjectId: 'sub-1' });

      expect(result).toEqual(questions);
    });
  });

  describe('getById', () => {
    it('returns question when found', async () => {
      const question = { id: 'q-1', content: 'Q1' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: question, error: null }),
            }),
          }),
        }),
      });

      const result = await questionService.getById('q-1');

      expect(result).toEqual(question);
    });

    it('throws NOT_FOUND when question does not exist', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      });

      await expect(questionService.getById('nonexistent')).rejects.toThrow('ERROR_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates question and returns it', async () => {
      const updated = { id: 'q-1', content: 'Updated' };
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
            order: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updated, error: null }),
            }),
          }),
        }),
      });

      const result = await questionService.update('q-1', { content: 'Updated' }, userId);

      expect(result).toBeDefined();
    });

    it('throws FORBIDDEN when question not owned by user', async () => {
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

      await expect(questionService.update('q-1', { content: 'Updated' }, userId)).rejects.toThrow(
        'ERROR_FORBIDDEN',
      );
    });
  });

  describe('delete', () => {
    it('deletes question successfully', async () => {
      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ error: null }),
          }),
        }),
      });

      await expect(questionService.delete('q-1', userId)).resolves.toBeUndefined();
    });
  });
});
