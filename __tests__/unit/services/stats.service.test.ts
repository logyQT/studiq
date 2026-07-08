import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { StatsService } from '@/server/services/stats.service';
import { success, failure } from '@/lib/service-result';
import type { RequestContext } from '@/lib/request-context';
import { AccountType } from '@/types';

describe('StatsService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
  };
  const service = new StatsService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('getTeacherStats', () => {
    it('returns basic stats', async () => {
      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }], error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'fc-1' }], error: null }),
        }),
      });

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ totalQuestions: 1, totalFlashcards: 1 });
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

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: attempts, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: practice, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }], error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lte: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
          }),
        }),
      });

      const result = await service.getStudentStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.totalQuizzes).toBe(2);
      expect(result.data.avgScore).toBe(70);
      expect(result.data.totalQuestionsCreated).toBe(1);
      expect(result.data.flashcardsPracticed).toBe(2);
      expect(result.data.flashcardAccuracy).toBe(50);
      expect(result.data.attemptsOverTime.length).toBe(2);
    });

    it('returns zero stats when no data exists', async () => {
      const c: any = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn(() => c);
      c.order = vi.fn(() => c);
      c.lte = vi.fn(() => c);
      c.then = (onfulfilled: any) => Promise.resolve({ data: [], error: null }).then(onfulfilled);
      mock.from.mockReturnValue(c);

      const result = await service.getStudentStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.totalQuizzes).toBe(0);
      expect(result.data.avgScore).toBe(0);
      expect(result.data.flashcardsPracticed).toBe(0);
      expect(result.data.flashcardAccuracy).toBe(0);
    });
  });
});
