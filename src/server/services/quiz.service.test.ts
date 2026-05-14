import { describe, it, expect, vi, beforeEach } from 'vitest';
import { quizService } from './quiz.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

describe('QuizService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('generateQuiz', () => {
    it('generates quiz with questions and returns attempt', async () => {
      const questions = [
        { id: 'q-1', type: 'mcq', content: 'Q1', question_answers: [] },
        { id: 'q-2', type: 'mcq', content: 'Q2', question_answers: [] },
      ];
      const attempt = { id: 'attempt-1', user_id: userId, score: 0, total_questions: 2 };

      const eqFn = vi.fn();
      const queryChain: any = { then: undefined, catch: undefined, eq: eqFn };
      eqFn.mockReturnValue(queryChain);
      const promise = Promise.resolve({ data: questions, error: null });
      queryChain.then = promise.then.bind(promise);
      queryChain.catch = promise.catch.bind(promise);

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue(queryChain) }),
      });

      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: attempt, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await quizService.generateQuiz(
        { questionTypes: ['mcq'], questionCount: 2 },
        userId,
      );

      expect(result).toBeDefined();
      expect(result.questions).toBeDefined();
    });

    it('throws NOT_FOUND when no questions available', async () => {
      const eqFn = vi.fn();
      const queryChain: any = { then: undefined, catch: undefined, eq: eqFn };
      eqFn.mockReturnValue(queryChain);
      const promise = Promise.resolve({ data: [], error: null });
      queryChain.then = promise.then.bind(promise);
      queryChain.catch = promise.catch.bind(promise);

      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue(queryChain) }),
      });

      await expect(
        quizService.generateQuiz({ questionTypes: ['mcq'], questionCount: 5 }, userId),
      ).rejects.toThrow('ERROR_NOT_FOUND');
    });

    it('throws INTERNAL_SERVER when fetch fails', async () => {
      const eqFn = vi.fn();
      const queryChain: any = { then: undefined, catch: undefined, eq: eqFn };
      eqFn.mockReturnValue(queryChain);
      const promise = Promise.resolve({ data: null, error: { message: 'DB error' } });
      queryChain.then = promise.then.bind(promise);
      queryChain.catch = promise.catch.bind(promise);

      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({ in: vi.fn().mockReturnValue(queryChain) }),
      });

      await expect(
        quizService.generateQuiz({ questionTypes: ['mcq'], questionCount: 5 }, userId),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });
});
