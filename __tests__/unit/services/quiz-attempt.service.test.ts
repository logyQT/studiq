import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { quizAttemptService } from '@/server/services/quiz-attempt.service';

describe('QuizAttemptService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('list', () => {
    it('returns attempts for user', async () => {
      const attempts = [{ id: 'a-1', user_id: userId, score: 5 }];
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: attempts, error: null }),
          }),
        }),
      });

      const result = await quizAttemptService.list(userId);

      expect(result).toEqual(attempts);
    });

    it('throws INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(quizAttemptService.list(userId)).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns attempt with questions and answers', async () => {
      const attempt = { id: 'a-1', user_id: userId };
      const attemptQuestions = [{ order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } }];
      const answers = [{ question_id: 'q-1', selected_answer_id: 'ans-1', is_correct: true }];

      const eqChain = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: attempt, error: null }),
      });
      const eqFirst = vi.fn().mockReturnValue({ eq: eqChain });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({ eq: eqFirst }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: attemptQuestions, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: answers, error: null }),
        }),
      });

      const result = await quizAttemptService.getById('a-1', userId);

      expect(result).toBeDefined();
      expect(result.questions).toBeDefined();
      expect(result.answers).toBeDefined();
    });

    it('throws NOT_FOUND when attempt does not exist', async () => {
      const eqChain = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const eqFirst = vi.fn().mockReturnValue({ eq: eqChain });

      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: eqFirst }),
      });

      await expect(quizAttemptService.getById('nonexistent', userId)).rejects.toThrow(
        'ERROR_NOT_FOUND',
      );
    });
  });

  describe('submit', () => {
    it('submits answers and returns score', async () => {
      const attempt = { id: 'a-1', user_id: userId, completed_at: null };
      const answer = { id: 'ans-1', is_correct: true };

      const eqChain = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: attempt, error: null }),
      });
      const eqFirst = vi.fn().mockReturnValue({ eq: eqChain });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({ eq: eqFirst }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: answer, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await quizAttemptService.submit(
        {
          attemptId: 'a-1',
          answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }],
        },
        userId,
      );

      expect(result).toBeDefined();
      expect(result.score).toBe(1);
    });

    it('throws NOT_FOUND when attempt does not exist', async () => {
      const eqChain = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      const eqFirst = vi.fn().mockReturnValue({ eq: eqChain });

      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: eqFirst }),
      });

      await expect(
        quizAttemptService.submit({ attemptId: 'nonexistent', answers: [] }, userId),
      ).rejects.toThrow('ERROR_NOT_FOUND');
    });

    it('throws BAD_REQUEST when attempt already completed', async () => {
      const attempt = { id: 'a-1', user_id: userId, completed_at: '2024-01-01' };

      const eqChain = vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: attempt, error: null }),
      });
      const eqFirst = vi.fn().mockReturnValue({ eq: eqChain });

      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: eqFirst }),
      });

      await expect(
        quizAttemptService.submit({ attemptId: 'a-1', answers: [] }, userId),
      ).rejects.toThrow('ERROR_BAD_REQUEST');
    });
  });
});
