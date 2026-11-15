import { AccountType, type RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { ActivityService } from '@studiq/server/services/activity.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', () => ({
  check: vi.fn().mockResolvedValue(undefined),
  Permission: { DECK_UPDATE: 'deck.update' },
}));

type QueryResult = { data: unknown; error: unknown };

/** A chainable Supabase query builder stub that is also awaitable. */
type QueryBuilder = {
  select: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  eq: Mock;
  in: Mock;
  gte: Mock;
  lte: Mock;
  gt: Mock;
  lt: Mock;
  is: Mock;
  not: Mock;
  order: Mock;
  single: Mock;
  maybeSingle: Mock;
} & Pick<Promise<QueryResult>, 'then' | 'catch' | 'finally'>;

/** Narrows a service result to its data, failing the test when the call failed. */
function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

function qb(data: unknown, error: unknown = null): QueryBuilder {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: QueryBuilder = {
    select: vi.fn(() => b),
    insert: vi.fn(() => b),
    update: vi.fn(() => b),
    delete: vi.fn(() => b),
    eq: vi.fn(() => b),
    in: vi.fn(() => b),
    gte: vi.fn(() => b),
    lte: vi.fn(() => b),
    gt: vi.fn(() => b),
    lt: vi.fn(() => b),
    is: vi.fn(() => b),
    not: vi.fn(() => b),
    order: vi.fn(() => b),
    single: vi.fn().mockResolvedValue({ data: data ?? null, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data: data ?? null, error }),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return b;
}

describe('ActivityService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: ActivityService;
  const ctx: RequestContext = {
    userId: 'teacher-1',
    accountType: AccountType.EDUCATOR,
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
    service = new ActivityService(() => Promise.resolve(mock));
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
      expect(expectSuccess(result).students).toEqual([]);
      expect(expectSuccess(result).dailyActivity).toEqual([]);
    });

    it('returns error on member query failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getClassActivity(ctx, { range: '7d' });

      expect(result.success).toBe(false);
    });

    it('returns summary, daily activity and students', async () => {
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

      mock.from.mockReturnValueOnce(qb(students)); // org_members
      mock.from.mockReturnValueOnce(qb(profiles)); // profiles
      mock.from.mockReturnValueOnce(qb(activity)); // user_daily_activity
      mock.from.mockReturnValueOnce(qb(lastPractice)); // flashcard_practice

      const result = await service.getClassActivity(ctx, { range: '7d' });

      expect(result.success).toBe(true);
      expect(expectSuccess(result).students).toHaveLength(1);
      expect(expectSuccess(result).students[0]?.name).toBe('Student');
      // The dead difficulty breakdown is gone: the endpoint must no longer read
      // quiz_attempts at all (#208).
      expect(mock.from).toHaveBeenCalledTimes(4);
      expect(mock.from.mock.calls.map((call: unknown[]) => call[0])).not.toContain('quiz_attempts');
      expect(result.data).not.toHaveProperty('quizzes');
    });

    it('handles 30d range', async () => {
      mock.from.mockReturnValueOnce(qb([{ user_id: 's-1' }]));
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

      const result = await service.getClassActivity(ctx, { range: '90d' });

      expect(result.success).toBe(true);
    });
  });
});
