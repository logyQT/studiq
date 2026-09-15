import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { QuestionReportService } from '@/server/services/question-report.service';
import type { RequestContext } from '@/lib/request-context';

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

      const result = await service.createReport('q-1', { message: 'Wrong answer' }, ctx);

      expect(result.success).toBe(true);
    });

    it('returns BAD_REQUEST when reporting own question', async () => {
      const question = { id: 'q-1', created_by: 'student-1', organization_id: 'org-1' };
      mock.from.mockReturnValueOnce(qb(question));

      const result = await service.createReport('q-1', { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });

    it('returns error on question fetch failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createReport('q-1', { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
    });

    it('returns error on report insert failure', async () => {
      const question = { id: 'q-1', created_by: 'teacher-1', organization_id: 'org-1' };
      mock.from.mockReturnValueOnce(qb(question));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createReport('q-1', { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
    });

    it('returns error on message insert failure', async () => {
      const question = { id: 'q-1', created_by: 'teacher-1', organization_id: 'org-1' };
      const report = { id: 'r-1', question_id: 'q-1' };
      mock.from.mockReturnValueOnce(qb(question));
      mock.from.mockReturnValueOnce(qb(report));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createReport('q-1', { message: 'Wrong' }, ctx);

      expect(result.success).toBe(false);
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
        { id: 'r-1', reported_by: 'student-1', teacher_id: 'teacher-1', updated_at: '2024-01-03T00:00:00Z', reporter_last_read_at: '2024-01-01T00:00:00Z', teacher_last_read_at: '2024-01-01T00:00:00Z' },
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
});
