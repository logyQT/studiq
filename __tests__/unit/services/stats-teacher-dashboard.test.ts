import { AccountType, type RequestContext } from '@studiq/authz';
import { StatsController } from '@studiq/server/controllers/stats.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { TeacherDashboardQuerySchema } from '@studiq/server/models/stats.model';
import { StatsService } from '@studiq/server/services/stats.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// #654: the teacher dashboard reads two SQL aggregates (per-group results, activity feed). The
// service only forwards the caller's identity and organization; the scoping lives in the RPCs.

const ctx: RequestContext = {
  userId: 'teacher-1',
  accountType: AccountType.EDUCATOR,
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: 'org-1',
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

describe('StatsService teacher dashboard', () => {
  const rpc = vi.fn();
  const service = new StatsService(async () => ({ rpc }) as any);

  beforeEach(() => vi.clearAllMocks());

  it('asks for the group results of the caller in the active organization', async () => {
    const rows = {
      groups: [
        {
          groupId: 'g1',
          groupName: 'Grupa A',
          students: 4,
          completedAttempts: 9,
          awaitingGrade: 1,
          avgScore: 72,
          flashcardReviews: 30,
          flashcardAccuracy: 80,
        },
      ],
      totals: { students: 4, completedAttempts: 9, awaitingGrade: 1 },
    };
    rpc.mockResolvedValue({ data: rows, error: null });

    const result = await service.getTeacherGroupPerformance(ctx, 14);

    expect(rpc).toHaveBeenCalledWith('get_teacher_group_performance', {
      p_user_id: 'teacher-1',
      p_organization_id: 'org-1',
      p_days: 14,
    });
    expect(result.success && result.data).toEqual(rows);
  });

  it('defaults to a 30 day window and to 10 feed items', async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await service.getTeacherGroupPerformance(ctx);
    await service.getTeacherActivityFeed(ctx);

    expect(rpc).toHaveBeenNthCalledWith(1, 'get_teacher_group_performance', {
      p_user_id: 'teacher-1',
      p_organization_id: 'org-1',
      p_days: 30,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_teacher_activity_feed', {
      p_user_id: 'teacher-1',
      p_organization_id: 'org-1',
      p_limit: 10,
    });
  });

  it('answers an empty list without calling the database when no organization is active', async () => {
    const noOrg = { ...ctx, activeOrgId: null };

    const groups = await service.getTeacherGroupPerformance(noOrg);
    const feed = await service.getTeacherActivityFeed(noOrg);

    expect(groups.success && groups.data).toEqual({
      groups: [],
      totals: { students: 0, completedAttempts: 0, awaitingGrade: 0 },
    });
    expect(feed.success && feed.data).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('treats a null RPC result as an empty list', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await service.getTeacherActivityFeed(ctx);

    expect(result.success && result.data).toEqual([]);
  });

  it('forwards a custom feed limit and preserves the returned items', async () => {
    const items = [
      {
        kind: 'report_opened',
        at: '2026-10-28T10:00:00Z',
        personName: null,
        title: null,
        scorePct: null,
        needsGrading: false,
        assignmentId: null,
        questionId: 'q1',
      },
    ];
    rpc.mockResolvedValue({ data: items, error: null });

    const result = await service.getTeacherActivityFeed(ctx, 50);

    expect(rpc).toHaveBeenCalledWith('get_teacher_activity_feed', {
      p_user_id: 'teacher-1',
      p_organization_id: 'org-1',
      p_limit: 50,
    });
    expect(result.success && result.data).toEqual(items);
  });

  it('returns zero totals when the group RPC returns null', async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await service.getTeacherGroupPerformance(ctx);

    expect(result.success && result.data).toEqual({
      groups: [],
      totals: { students: 0, completedAttempts: 0, awaitingGrade: 0 },
    });
  });

  it('maps an RPC permission denial to forbidden for both dashboard reads', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });

    expect(await service.getTeacherGroupPerformance(ctx)).toEqual(failure('FORBIDDEN'));
    expect(await service.getTeacherActivityFeed(ctx)).toEqual(failure('FORBIDDEN'));
  });

  it('fails when the database does', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });

    expect((await service.getTeacherGroupPerformance(ctx)).success).toBe(false);
    expect((await service.getTeacherActivityFeed(ctx)).success).toBe(false);
  });
});

describe('TeacherDashboardQuerySchema', () => {
  it('defaults to 30 days and 10 items and coerces numbers from the query string', () => {
    expect(TeacherDashboardQuerySchema.parse({})).toEqual({ days: 30, limit: 10 });
    expect(TeacherDashboardQuerySchema.parse({ days: '7', limit: '25' })).toEqual({
      days: 7,
      limit: 25,
    });
  });

  it.each([
    [
      { days: '1', limit: '1' },
      { days: 1, limit: 1 },
    ],
    [
      { days: '365', limit: '50' },
      { days: 365, limit: 50 },
    ],
  ])('accepts inclusive boundaries %j', (query, expected) => {
    expect(TeacherDashboardQuerySchema.parse(query)).toEqual(expected);
  });

  it.each([{ days: '1.5' }, { limit: '2.5' }, { limit: 'abc' }, { days: '' }, { limit: '' }])(
    'rejects non-integer or empty values %j',
    (query) => {
      expect(TeacherDashboardQuerySchema.safeParse(query).success).toBe(false);
    },
  );

  it.each([{ days: '0' }, { days: '366' }, { limit: '0' }, { limit: '51' }, { days: 'abc' }])(
    'rejects %j',
    (query) => {
      expect(TeacherDashboardQuerySchema.safeParse(query).success).toBe(false);
    },
  );

  it.each([
    [{ days: '0' }, ValidationErrorCode.TOO_SMALL],
    [{ days: '366' }, ValidationErrorCode.TOO_BIG],
    [{ days: 'abc' }, ValidationErrorCode.NUMBER],
  ])('reports the repo validation code for %j', (query, code) => {
    const result = TeacherDashboardQuerySchema.safeParse(query);

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toBe(code);
  });
});

describe('StatsController teacher dashboard', () => {
  const statsService = {
    getTeacherGroupPerformance: vi.fn(),
    getTeacherActivityFeed: vi.fn(),
  };
  const controller = new StatsController(statsService as any);

  beforeEach(() => vi.clearAllMocks());

  it('passes the parsed window and limit to the service', async () => {
    statsService.getTeacherGroupPerformance.mockResolvedValue(
      success({ groups: [], totals: { students: 0, completedAttempts: 0, awaitingGrade: 0 } }),
    );
    statsService.getTeacherActivityFeed.mockResolvedValue(success([]));

    await controller.getTeacherGroupPerformance({ days: '7' }, ctx);
    await controller.getTeacherActivityFeed({ limit: '5' }, ctx);

    expect(statsService.getTeacherGroupPerformance).toHaveBeenCalledWith(ctx, 7);
    expect(statsService.getTeacherActivityFeed).toHaveBeenCalledWith(ctx, 5);
  });

  it('answers 422 for an invalid query without calling the service', async () => {
    const response = await controller.getTeacherGroupPerformance({ days: '0' }, ctx);

    expect(response).toMatchObject({ success: false, statusCode: 422 });
    expect(statsService.getTeacherGroupPerformance).not.toHaveBeenCalled();
  });

  it('uses defaults for absent queries', async () => {
    statsService.getTeacherGroupPerformance.mockResolvedValue(
      success({ groups: [], totals: { students: 0, completedAttempts: 0, awaitingGrade: 0 } }),
    );
    statsService.getTeacherActivityFeed.mockResolvedValue(success([]));

    await controller.getTeacherGroupPerformance(undefined, ctx);
    await controller.getTeacherActivityFeed(null, ctx);

    expect(statsService.getTeacherGroupPerformance).toHaveBeenCalledWith(ctx, 30);
    expect(statsService.getTeacherActivityFeed).toHaveBeenCalledWith(ctx, 10);
  });

  it('rejects an invalid feed limit before calling the service', async () => {
    const response = await controller.getTeacherActivityFeed({ limit: '51' }, ctx);

    expect(response).toMatchObject({ success: false, statusCode: 422 });
    expect(statsService.getTeacherActivityFeed).not.toHaveBeenCalled();
  });

  it('maps a service failure to its HTTP error', async () => {
    statsService.getTeacherActivityFeed.mockResolvedValue(failure('INTERNAL_SERVER'));

    const response = await controller.getTeacherActivityFeed({}, ctx);

    expect(response).toMatchObject({ success: false, statusCode: 500 });
  });
});

describe('problem questions floor (#654 review)', () => {
  it('keeps out a question answered fewer than three times', async () => {
    const supabase: any = {
      from: vi.fn(() => {
        const c: any = {};
        for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'is']) c[m] = vi.fn(() => c);
        c.then = (onfulfilled: any) => Promise.resolve({ data: [], error: null }).then(onfulfilled);
        return c;
      }),
      rpc: vi.fn().mockResolvedValue({
        data: [
          { id: 'q1', content: 'one answer', type: 'mcq', correctRate: 0, totalAnswers: 1 },
          { id: 'q2', content: 'three answers', type: 'mcq', correctRate: 0.2, totalAnswers: 3 },
        ],
        error: null,
      }),
    };
    const service = new StatsService(async () => supabase);

    const result = await service.getTeacherStats(ctx);

    expect(result.success && result.data.subject.problematicQuestions.map((q) => q.id)).toEqual([
      'q2',
    ]);
  });
});
