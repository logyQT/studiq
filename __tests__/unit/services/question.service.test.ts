import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { questionService } from '@/server/services/question.service';

describe('QuestionService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('create', () => {
    it('inserts question and answers and returns it', async () => {
      const mockQuestion = { id: 'q-1', type: 'mcq', content: 'Q1' };
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: mockQuestion, error: null }),
          }),
        }),
      });

      const result = await questionService.create(
        {
          type: 'mcq',
          content: 'Q1',
          difficulty: 'easy',
          answers: [{ content: 'A1', isCorrect: true, orderIndex: 0 }],
        },
        userId,
      );

      expect(result).toBeDefined();
      expect(mock.from).toHaveBeenCalledWith('questions');
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      mock.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(
        questionService.create(
          {
            type: 'mcq',
            content: 'Q1',
            difficulty: 'easy',
            answers: [{ content: 'A1', isCorrect: true, orderIndex: 0 }],
          },
          userId,
        ),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('list', () => {
    it('returns all questions when no filter', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];
      mock.from.mockReturnValue({
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
      mock.from.mockReturnValue({
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
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: question, error: null }),
          }),
        }),
      });

      const result = await questionService.getById('q-1');

      expect(result).toEqual(question);
    });

    it('throws NOT_FOUND when question does not exist', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      await expect(questionService.getById('nonexistent')).rejects.toThrow('ERROR_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('updates question and returns it', async () => {
      const updated = { id: 'q-1', content: 'Updated' };
      mock.from.mockReturnValueOnce({
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

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      });

      const result = await questionService.update('q-1', { content: 'Updated' }, userId);

      expect(result).toBeDefined();
    });

    it('throws FORBIDDEN when question not owned by user', async () => {
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

      await expect(questionService.update('q-1', { content: 'Updated' }, userId)).rejects.toThrow(
        'ERROR_FORBIDDEN',
      );
    });

    it('updates question with answers replacement', async () => {
      const updated = { id: 'q-1', content: 'Updated' };
      mock.from.mockReturnValueOnce({
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

      mock.from.mockReturnValueOnce({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: updated, error: null }),
          }),
        }),
      });

      const result = await questionService.update(
        'q-1',
        {
          content: 'Updated',
          answers: [{ content: 'A1', isCorrect: true, orderIndex: 0 }],
        },
        userId,
      );

      expect(result).toBeDefined();
      expect(mock.from).toHaveBeenCalledWith('question_answers');
    });
  });

  describe('delete', () => {
    it('deletes question successfully', async () => {
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'q-1' }, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(questionService.delete('q-1', userId)).resolves.toBeUndefined();
    });

    it('throws FORBIDDEN when question not owned by user', async () => {
      mock.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      await expect(questionService.delete('q-1', userId)).rejects.toThrow('ERROR_FORBIDDEN');
    });
  });

  describe('getStatsBySubject', () => {
    it('returns stats with questions and attempts', async () => {
      const questions = [
        { id: 'q-1', type: 'mcq', difficulty: 'easy' },
        { id: 'q-2', type: 'mcq', difficulty: 'hard' },
      ];
      const attempts = [
        { question_id: 'q-1', is_correct: true },
        { question_id: 'q-1', is_correct: false },
        { question_id: 'q-2', is_correct: false },
      ];

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: questions, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: attempts, error: null }),
        }),
      });

      const result = await questionService.getStatsBySubject('sub-1');

      expect(result.totalQuestions).toBe(2);
      expect(result.byType).toEqual({ mcq: 2 });
      expect(result.byDifficulty).toEqual({ easy: 1, hard: 1 });
      expect(result.problematicQuestions.length).toBeGreaterThan(0);
    });

    it('returns zero stats when no questions exist', async () => {
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      });

      const result = await questionService.getStatsBySubject('sub-1');

      expect(result.totalQuestions).toBe(0);
      expect(result.byType).toEqual({});
      expect(result.byDifficulty).toEqual({});
      expect(result.problematicQuestions).toEqual([]);
    });
  });
});
