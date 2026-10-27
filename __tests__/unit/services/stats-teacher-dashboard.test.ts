import { AccountType, type RequestContext } from '@studiq/authz';
import { StatsController } from '@studiq/server/controllers/stats.controller';
import { failure, success } from '@studiq/server/lib/service-result';
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

  it.each([{ days: '0' }, { days: '366' }, { limit: '0' }, { limit: '51' }, { days: 'abc' }])(
    'rejects %j',
    (query) => {
      expect(TeacherDashboardQuerySchema.safeParse(query).success).toBe(false);
    },
  );
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

  it('maps a service failure to its HTTP error', async () => {
    statsService.getTeacherActivityFeed.mockResolvedValue(failure('INTERNAL_SERVER'));

    const response = await controller.getTeacherActivityFeed({}, ctx);

    expect(response).toMatchObject({ success: false, statusCode: 500 });
  });
});
