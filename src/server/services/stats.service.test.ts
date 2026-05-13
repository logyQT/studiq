import { describe, it, expect, vi, beforeEach } from 'vitest';
import { statsService } from './stats.service';
import { createClient } from '@/lib/supabase/server';
import { questionService } from '@/server/services';

vi.mock('@/server/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services')>();
  return {
    ...actual,
    questionService: {
      getStatsBySubject: vi.fn(),
    },
  };
});

describe('StatsService', () => {
  const userId = 'test-user-id';
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    vi.mocked(createClient).mockResolvedValue(mockSupabase);
  });

  describe('getTeacherStats', () => {
    it('returns basic stats without subjectId', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }], error: null }),
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'fc-1' }], error: null }),
        }),
      });

      const result = await statsService.getTeacherStats(userId);

      expect(result).toEqual({ totalQuestions: 1, totalFlashcards: 1 });
    });

    it('returns stats with subject details when subjectId provided', async () => {
      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }], error: null }),
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'fc-1' }], error: null }),
        }),
      });

      vi.mocked(questionService.getStatsBySubject).mockResolvedValueOnce({
        totalQuestions: 5,
        byType: { mcq: 3, true_false: 2 },
        byDifficulty: { easy: 2, medium: 3 },
        problematicQuestions: [],
      });

      const result = await statsService.getTeacherStats(userId, 'sub-1');

      expect(result.totalQuestions).toBe(1);
      expect(result.totalFlashcards).toBe(1);
      expect((result as any).subject).toBeDefined();
      expect((result as any).subject?.totalQuestions).toBe(5);
    });
  });

  describe('getStudentStats', () => {
    it('returns student stats with attempts and practice', async () => {
      const attempts = [
        { score: 8, total_questions: 10, started_at: '2024-01-01', config: {} },
        { score: 6, total_questions: 10, started_at: '2024-01-02', config: {} },
      ];
      const practice = [
        { was_correct: true, practiced_at: '2024-01-01' },
        { was_correct: false, practiced_at: '2024-01-02' },
      ];

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: attempts, error: null }),
          }),
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: practice, error: null }),
          }),
        }),
      });

      mockSupabase.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }], error: null }),
        }),
      });

      const result = await statsService.getStudentStats(userId);

      expect(result.totalQuizzes).toBe(2);
      expect(result.avgScore).toBe(70);
      expect(result.totalQuestionsCreated).toBe(1);
      expect(result.flashcardsPracticed).toBe(2);
      expect(result.flashcardAccuracy).toBe(50);
      expect(result.attemptsOverTime.length).toBe(2);
    });

    it('returns zero stats when no data exists', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const result = await statsService.getStudentStats(userId);

      expect(result.totalQuizzes).toBe(0);
      expect(result.avgScore).toBe(0);
      expect(result.flashcardsPracticed).toBe(0);
      expect(result.flashcardAccuracy).toBe(0);
    });
  });
});
