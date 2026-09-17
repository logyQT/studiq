import { RequestContext } from '@studiq/authz';
import { ActivityService } from '@studiq/server/services/activity.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', () => ({
  check: vi.fn().mockResolvedValue(undefined),
  Permission: { DECK_UPDATE: 'deck.update' },
}));

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.gte = vi.fn(() => b);
  b.lte = vi.fn(() => b);
  b.gt = vi.fn(() => b);
  b.lt = vi.fn(() => b);
  b.not = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('ActivityService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: ActivityService;
  const ctx: RequestContext = {
    userId: 'teacher-1',
    accountType: 'educator' as any,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new ActivityService(async () => mock as any);
  });

  describe('getClassActivity', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.getClassActivity({ ...ctx, activeOrgId: null }, { range: '7d' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns empty when no students', async () => {
      mock.from.mockReturnValueOnce(qb([])); // org_members

      const result = await service.getClassActivity(ctx, { range: '7d' });

      expect(result.success).toBe(true);
      expect(result.data.students).toEqual([]);
      expect(result.data.dailyActivity).toEqual([]);
    });

    it('returns error on member query failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getClassActivity(ctx, { range: '7d' });

      expect(result.success).toBe(false);
    });

    it('returns activity with students and quizzes', async () => {
      const students = [{ user_id: 's-1' }];
      const profiles = [{ id: 's-1', email: 's@test.com', full_name: 'Student' }];
      const activity = [
        {
          user_id: 's-1',
          date: new Date().toISOString().split('T')[0],
          reviews_count: 10,
          reviews_correct: 8,
          quizzes_count: 2,
          quizzes_score: 18,
          quizzes_total: 20,
        },
      ];
      const lastPractice = [{ user_id: 's-1', practiced_at: new Date().toISOString() }];
      const attempts = [
        {
          score: 90,
          total_questions: 10,
          config: { difficulty: 'medium' },
          completed_at: new Date().toISOString(),
        },
      ];

      mock.from.mockReturnValueOnce(qb(students)); // org_members
      mock.from.mockReturnValueOnce(qb(profiles)); // profiles
      mock.from.mockReturnValueOnce(qb(activity)); // user_daily_activity
      mock.from.mockReturnValueOnce(qb(lastPractice)); // flashcard_practice
      mock.from.mockReturnValueOnce(qb(attempts)); // quiz_attempts

      const result = await service.getClassActivity(ctx, { range: '7d' });

      expect(result.success).toBe(true);
      expect(result.data.students).toHaveLength(1);
      expect(result.data.students[0].name).toBe('Student');
    });

    it('handles 30d range', async () => {
      mock.from.mockReturnValueOnce(qb([{ user_id: 's-1' }]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getClassActivity(ctx, { range: '30d' });

      expect(result.success).toBe(true);
    });

    it('handles 90d range', async () => {
      mock.from.mockReturnValueOnce(qb([{ user_id: 's-1' }]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getClassActivity(ctx, { range: '90d' });

      expect(result.success).toBe(true);
    });
  });
});
