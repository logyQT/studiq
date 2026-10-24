import type { RequestContext } from '@studiq/authz';
import { QuestionReportService } from '@studiq/server/services/question-report.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function qb(data: any, error: any = null) {
  const promise = Promise.resolve({ data: data ?? null, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.or = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.limit = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.maybeSingle = vi.fn().mockResolvedValue({ data: data ?? null, error });
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('QuestionReportService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: QuestionReportService;
  const ctx: RequestContext = {
    userId: 'student-1',
    accountType: 'student' as any,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new QuestionReportService(async () => mock as any);
  });

  describe('createReport', () => {
    it('creates a report successfully', async () => {
      const question = { id: 'q-1', created_by: 'teacher-1', organization_id: 'org-1' };
      const report = { id: 'r-1', question_id: 'q-1', reported_by: 'student-1' };
      mock.from.mockReturnValueOnce(qb(question)); // fetch question
      mock.from.mockReturnValueOnce(qb(report)); // insert report
      mock.from.mockReturnValueOnce(qb(undefined)); // insert message

      const result = await service.createReport(
        { questionId: 'q-1' },
        { message: 'Wrong answer' },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it('returns BAD_REQUEST when reporting own question', async () => {
      const question = { id: 'q-1', created_by: 'student-1', organization_id: 'org-1' };
      mock.from.mockReturnValueOnce(qb(question));

      const result = await service.createReport({ questionId: 'q-1' }, { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });

    it('returns error on question fetch failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createReport({ questionId: 'q-1' }, { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
    });

    it('returns error on report insert failure', async () => {
      const question = { id: 'q-1', created_by: 'teacher-1', organization_id: 'org-1' };
      mock.from.mockReturnValueOnce(qb(question));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createReport({ questionId: 'q-1' }, { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
    });

    it('returns error on message insert failure', async () => {
      const question = { id: 'q-1', created_by: 'teacher-1', organization_id: 'org-1' };
      const report = { id: 'r-1', question_id: 'q-1' };
      mock.from.mockReturnValueOnce(qb(question));
      mock.from.mockReturnValueOnce(qb(report));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createReport({ questionId: 'q-1' }, { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
    });

    it('reports a group with an owner directly to that owner', async () => {
      const group = { id: 'g-1', created_by: 'teacher-2', organization_id: 'org-1' };
      const report = { id: 'r-1', group_id: 'g-1', reported_by: 'student-1' };
      mock.from.mockReturnValueOnce(qb(group)); // fetch group
      mock.from.mockReturnValueOnce(qb(report)); // insert report
      mock.from.mockReturnValueOnce(qb(undefined)); // insert message

      const result = await service.createReport({ groupId: 'g-1' }, { message: 'Wrong' }, ctx);

      expect(result.success).toBe(true);
    });

    it('routes a report on an ownerless group to the org admin', async () => {
      const group = { id: 'g-1', created_by: null, organization_id: 'org-1' };
      const admin = { user_id: 'admin-1' };
      const report = { id: 'r-1', group_id: 'g-1', reported_by: 'student-1' };
      mock.from.mockReturnValueOnce(qb(group)); // fetch group
      mock.from.mockReturnValueOnce(qb(admin)); // find org admin
      mock.from.mockReturnValueOnce(qb(report)); // insert report
      mock.from.mockReturnValueOnce(qb(undefined)); // insert message

      const result = await service.createReport({ groupId: 'g-1' }, { message: 'Wrong' }, ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when an ownerless group has no org admin to route to', async () => {
      const group = { id: 'g-1', created_by: null, organization_id: 'org-1' };
      mock.from.mockReturnValueOnce(qb(group));
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.createReport({ groupId: 'g-1' }, { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns BAD_REQUEST when reporting a group the user themselves created', async () => {
      const group = { id: 'g-1', created_by: 'student-1', organization_id: 'org-1' };
      mock.from.mockReturnValueOnce(qb(group));

      const result = await service.createReport({ groupId: 'g-1' }, { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });
  });

  describe('list', () => {
    it('returns reports for user', async () => {
      const reports = [
        {
          id: 'r-1',
          reported_by: 'student-1',
          teacher_id: 'teacher-1',
          updated_at: '2024-01-02T00:00:00Z',
          reporter_last_read_at: '2024-01-01T00:00:00Z',
          teacher_last_read_at: '2024-01-01T00:00:00Z',
        },
      ];
      mock.from.mockReturnValueOnce(qb(reports));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('getById', () => {
    it('returns report with messages when user is participant', async () => {
      const report = { id: 'r-1', reported_by: 'student-1', teacher_id: 'teacher-1' };
      const messages = [{ id: 'm-1', report_id: 'r-1', body: 'test' }];
      mock.from.mockReturnValueOnce(qb(report)); // fetchParticipantReport
      mock.from.mockReturnValueOnce(qb(report)); // fetch report with relations
      mock.from.mockReturnValueOnce(qb(messages)); // fetch messages

      const result = await service.getById('r-1', ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when not a participant', async () => {
      mock.from.mockReturnValueOnce(qb(null, null)); // fetchParticipantReport returns null

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('addMessage', () => {
    it('adds a message to a report', async () => {
      const report = { id: 'r-1', reported_by: 'student-1', teacher_id: 'teacher-1' };
      const message = { id: 'm-1', body: 'test' };
      mock.from.mockReturnValueOnce(qb(report));
      mock.from.mockReturnValueOnce(qb(message));

      const result = await service.addMessage('r-1', { body: 'test' }, ctx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when not a participant', async () => {
      mock.from.mockReturnValueOnce(qb(null, null)); // fetchParticipantReport

      const result = await service.addMessage('nonexistent', { body: 'test' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('markRead', () => {
    it('marks report as read by reporter', async () => {
      const report = { id: 'r-1', reported_by: 'student-1', teacher_id: 'teacher-1' };
      mock.from.mockReturnValueOnce(qb(report));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.markRead('r-1', ctx);

      expect(result.success).toBe(true);
    });

    it('marks report as read by teacher', async () => {
      const teacherCtx = { ...ctx, userId: 'teacher-1' };
      const report = { id: 'r-1', reported_by: 'student-1', teacher_id: 'teacher-1' };
      mock.from.mockReturnValueOnce(qb(report));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.markRead('r-1', teacherCtx);

      expect(result.success).toBe(true);
    });

    it('returns NOT_FOUND when not a participant', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.markRead('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });
  });

  describe('unreadCount', () => {
    it('returns unread count', async () => {
      const reports = [
        {
          id: 'r-1',
          reported_by: 'student-1',
          teacher_id: 'teacher-1',
          updated_at: '2024-01-03T00:00:00Z',
          reporter_last_read_at: '2024-01-01T00:00:00Z',
          teacher_last_read_at: '2024-01-01T00:00:00Z',
        },
      ];
      mock.from.mockReturnValueOnce(qb(reports));

      const result = await service.unreadCount(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ count: 1 });
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.unreadCount(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('org-wide manager scope (#276)', () => {
    const managerCtx: RequestContext = {
      ...ctx,
      userId: 'manager-1',
      accountType: 'manager' as any,
      activeOrgId: 'org-1',
      orgRoleId: 'role-admin',
    };
    const foreignReport = {
      id: 'r-1',
      reported_by: 'student-1',
      teacher_id: 'teacher-1',
      organization_id: 'org-1',
      updated_at: '2024-01-02T00:00:00Z',
      reporter_last_read_at: '2024-01-01T00:00:00Z',
      teacher_last_read_at: null,
    };

    it('lists every report in the active org for its admin', async () => {
      const roleQuery = qb({ name: 'admin', is_system: true });
      const listQuery = qb([foreignReport]);
      mock.from.mockReturnValueOnce(roleQuery).mockReturnValueOnce(listQuery);

      const result = await service.list(managerCtx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenNthCalledWith(1, 'org_roles');
      expect(mock.from).toHaveBeenNthCalledWith(2, 'question_reports');
      // Org rows and the caller's own participant threads are unioned; neither
      // branch alone may be dropped.
      expect(listQuery.or).toHaveBeenCalledWith(
        'organization_id.eq.org-1,reported_by.eq.manager-1,teacher_id.eq.manager-1',
      );
      expect(listQuery.eq).not.toHaveBeenCalled();
      // An observed thread is "unread" while its recipient has not read it.
      expect(result.data).toEqual([expect.objectContaining({ id: 'r-1', isUnread: true })]);
    });

    it('keeps the admin participant threads outside the active org (legacy NULL org)', async () => {
      const legacyReport = {
        ...foreignReport,
        id: 'r-legacy',
        organization_id: null,
        reported_by: 'teacher-2',
        teacher_id: 'manager-1',
      };
      const listQuery = qb([foreignReport, legacyReport]);
      mock.from
        .mockReturnValueOnce(qb({ name: 'admin', is_system: true }))
        .mockReturnValueOnce(listQuery);

      const result = await service.list(managerCtx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        expect.objectContaining({ id: 'r-1' }),
        // Legacy NULL-org thread: recipient has not read it yet.
        expect.objectContaining({ id: 'r-legacy', isUnread: true }),
      ]);
    });

    it('keeps participant scope for a manager holding a non-admin org role', async () => {
      const roleQuery = qb({ name: 'teacher', is_system: true });
      const listQuery = qb([]);
      mock.from.mockReturnValueOnce(roleQuery).mockReturnValueOnce(listQuery);

      await service.list(managerCtx);

      expect(listQuery.eq).not.toHaveBeenCalled();
      expect(listQuery.or).toHaveBeenCalledWith('reported_by.eq.manager-1,teacher_id.eq.manager-1');
    });

    it('keeps participant scope for a custom, non-system role named admin', async () => {
      const roleQuery = qb({ name: 'admin', is_system: false });
      const listQuery = qb([]);
      mock.from.mockReturnValueOnce(roleQuery).mockReturnValueOnce(listQuery);

      await service.list(managerCtx);

      expect(roleQuery.select).toHaveBeenCalledWith('name, is_system');
      expect(listQuery.or).toHaveBeenCalledWith('reported_by.eq.manager-1,teacher_id.eq.manager-1');
      expect(listQuery.or).not.toHaveBeenCalledWith(expect.stringContaining('organization_id.eq'));
    });

    it('keeps participant scope when the role does not belong to the active org', async () => {
      const roleQuery = qb(null);
      const listQuery = qb([]);
      mock.from.mockReturnValueOnce(roleQuery).mockReturnValueOnce(listQuery);

      await service.list(managerCtx);

      expect(roleQuery.eq).toHaveBeenCalledWith('id', 'role-admin');
      expect(roleQuery.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(listQuery.or).toHaveBeenCalledWith('reported_by.eq.manager-1,teacher_id.eq.manager-1');
    });

    it('does not look up the org role without verified membership', async () => {
      const listQuery = qb([]);
      mock.from.mockReturnValueOnce(listQuery);

      await service.list({ ...managerCtx, orgRoleId: null });

      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(listQuery.or).toHaveBeenCalled();
    });

    it('keeps participant scope for a non-manager account with an admin org role', async () => {
      const listQuery = qb([]);
      mock.from.mockReturnValueOnce(listQuery);

      await service.list({ ...managerCtx, accountType: 'educator' as any });

      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(listQuery.eq).not.toHaveBeenCalled();
      expect(listQuery.or).toHaveBeenCalled();
    });

    it('counts unread reports across the active org for its admin', async () => {
      const roleQuery = qb({ name: 'admin', is_system: true });
      const countQuery = qb([
        { ...foreignReport, id: 'r-read', teacher_last_read_at: '2024-01-03T00:00:00Z' },
        { ...foreignReport, id: 'r-unread', teacher_last_read_at: null },
      ]);
      mock.from.mockReturnValueOnce(roleQuery).mockReturnValueOnce(countQuery);

      const result = await service.unreadCount(managerCtx);

      expect(countQuery.or).toHaveBeenCalledWith(
        'organization_id.eq.org-1,reported_by.eq.manager-1,teacher_id.eq.manager-1',
      );
      expect(countQuery.eq).not.toHaveBeenCalled();
      expect(result.data).toEqual({ count: 1 });
    });

    it('opens a non-participant report in the active org as its admin', async () => {
      mock.from
        .mockReturnValueOnce(qb(foreignReport))
        .mockReturnValueOnce(qb({ name: 'admin', is_system: true }))
        .mockReturnValueOnce(qb(foreignReport))
        .mockReturnValueOnce(qb([{ id: 'm-1' }]));

      const result = await service.getById('r-1', managerCtx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        report: expect.objectContaining({ id: 'r-1' }),
        messages: [{ id: 'm-1' }],
      });
    });

    it('returns NOT_FOUND for an org admin reading another organization report', async () => {
      mock.from
        .mockReturnValueOnce(qb({ ...foreignReport, organization_id: 'org-2' }))
        .mockReturnValueOnce(qb({ name: 'admin', is_system: true }));

      const result = await service.getById('r-1', managerCtx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND for a manager with a non-admin org role', async () => {
      mock.from
        .mockReturnValueOnce(qb(foreignReport))
        .mockReturnValueOnce(qb({ name: 'teacher', is_system: true }));

      const result = await service.getById('r-1', managerCtx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('lets the org admin reply to a non-participant report', async () => {
      mock.from
        .mockReturnValueOnce(qb(foreignReport))
        .mockReturnValueOnce(qb({ name: 'admin', is_system: true }))
        .mockReturnValueOnce(qb({ id: 'm-1', body: 'reply' }));

      const result = await service.addMessage('r-1', { body: 'reply' }, managerCtx);

      expect(result.success).toBe(true);
    });

    it('does not write a read receipt when the org admin observes a thread', async () => {
      const reportQuery = qb(foreignReport);
      mock.from
        .mockReturnValueOnce(reportQuery)
        .mockReturnValueOnce(qb({ name: 'admin', is_system: true }));

      const result = await service.markRead('r-1', managerCtx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledTimes(2);
      expect(reportQuery.update).not.toHaveBeenCalled();
    });
  });
});
