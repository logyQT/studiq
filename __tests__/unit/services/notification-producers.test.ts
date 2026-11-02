import { AccountType, type RequestContext } from '@studiq/authz';
import type { Notifier } from '@studiq/server/services/notification.service';
import { QuestionReportService } from '@studiq/server/services/question-report.service';
import { TeacherAssignmentService } from '@studiq/server/services/teacher-assignment.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

// #664: the services that cause a notification hand the facts to a Notifier. These tests pin
// when they do (and when they must not), with a fake notifier instead of a database.

type QueryResult = { data: unknown; error: unknown; count?: number };

/** A chainable Supabase query builder stub that is also awaitable. */
type QueryBuilder = {
  select: Mock;
  eq: Mock;
  in: Mock;
  or: Mock;
  order: Mock;
  filter: Mock;
  is: Mock;
  limit: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  upsert: Mock;
  neq: Mock;
  single: Mock;
  maybeSingle: Mock;
} & Pick<Promise<QueryResult>, 'then'>;

function chain(result: unknown, count?: number): QueryBuilder {
  const resolved: QueryResult =
    count !== undefined ? { data: result, count, error: null } : { data: result, error: null };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const promise = Promise.resolve(resolved);
  const c: QueryBuilder = {
    select: vi.fn(() => c),
    eq: vi.fn(() => c),
    in: vi.fn(() => c),
    or: vi.fn(() => c),
    order: vi.fn(() => c),
    filter: vi.fn(() => c),
    is: vi.fn(() => c),
    limit: vi.fn(() => c),
    insert: vi.fn(() => c),
    update: vi.fn(() => c),
    delete: vi.fn(() => c),
    upsert: vi.fn(() => c),
    neq: vi.fn(() => c),
    single: terminal,
    maybeSingle: terminal,
    then: promise.then.bind(promise),
  };
  return c;
}

function fakeNotifier(): { [K in keyof Notifier]: ReturnType<typeof vi.fn> } {
  return {
    assignmentPublished: vi.fn().mockResolvedValue(undefined),
    assignmentGraded: vi.fn().mockResolvedValue(undefined),
    reportMessage: vi.fn().mockResolvedValue(undefined),
    invitationAccepted: vi.fn().mockResolvedValue(undefined),
  };
}

const teacherId = 'teacher-1';
const orgId = '00000000-0000-4000-8000-000000000001';

const ctx: RequestContext = {
  userId: teacherId,
  accountType: AccountType.EDUCATOR,
  traceId: 't',
  url: '',
  method: 'POST',
  activeOrgId: orgId,
  orgRoleId: 'role',
  groupIds: [],
  permissionScopes: {},
};

describe('TeacherAssignmentService notifies students', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let notifier: ReturnType<typeof fakeNotifier>;
  let service: TeacherAssignmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    notifier = fakeNotifier();
    service = new TeacherAssignmentService(async () => mock, notifier as unknown as Notifier);
  });

  const owned = () => chain({ id: 'a1', created_by: teacherId, organization_id: orgId });

  function publishWith(previousStatus: string) {
    mock.from
      .mockReturnValueOnce(owned())
      .mockReturnValueOnce(chain(null, 1)) // targets
      .mockReturnValueOnce(chain({ status: previousStatus })) // status before
      .mockReturnValueOnce(chain({ id: 'a1', status: 'published' })); // update
  }

  it('tells the students when a draft is published', async () => {
    publishWith('draft');

    const result = await service.publish('a1', undefined, undefined, ctx);

    expect(result.success).toBe(true);
    expect(notifier.assignmentPublished).toHaveBeenCalledOnce();
    expect(notifier.assignmentPublished).toHaveBeenCalledWith({
      assignmentId: 'a1',
      teacherId,
    });
  });

  it('does not tell them again when an already published assignment is saved again', async () => {
    publishWith('published');

    await service.publish('a1', '2026-12-01T00:00:00.000Z', undefined, ctx);

    expect(notifier.assignmentPublished).not.toHaveBeenCalled();
  });

  it('tells nobody when the previous status cannot be read', async () => {
    const statusRead = chain(null);
    const failure = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    const failedRead = Promise.resolve(failure);
    statusRead.single = vi.fn().mockResolvedValue(failure);
    statusRead.then = failedRead.then.bind(failedRead);
    mock.from
      .mockReturnValueOnce(owned())
      .mockReturnValueOnce(chain(null, 1)) // targets
      .mockReturnValueOnce(statusRead) // status before, unreadable
      .mockReturnValueOnce(chain({ id: 'a1', status: 'published' })); // update

    const result = await service.publish('a1', undefined, undefined, ctx);

    expect(result.success).toBe(true);
    expect(notifier.assignmentPublished).not.toHaveBeenCalled();
  });

  it('tells nobody when publishing fails', async () => {
    mock.from.mockReturnValueOnce(chain(null)); // not the owner

    const result = await service.publish('a1', undefined, undefined, ctx);

    expect(result.success).toBe(false);
    expect(notifier.assignmentPublished).not.toHaveBeenCalled();
  });

  describe('grading', () => {
    function gradeWith(attempt: Record<string, unknown>) {
      mock.from
        .mockReturnValueOnce(owned())
        .mockReturnValueOnce(chain(attempt))
        .mockReturnValueOnce(chain([{ question_id: 'q1', points: 2 }])) // max points
        .mockReturnValueOnce(chain({ id: 'answer-1' }))
        .mockReturnValueOnce(chain(null)) // answer update
        .mockReturnValueOnce(chain([{ question_id: 'q1', points: 2 }]))
        .mockReturnValueOnce(chain([{ question_id: 'q1', is_correct: true, teacher_points: 2 }]))
        .mockReturnValueOnce(chain(null)); // attempt update
    }

    it('tells the student at the first grade', async () => {
      gradeWith({ id: 'attempt-1', graded_at: null });

      const result = await service.gradeAnswer(
        'a1',
        'student-1',
        { questionId: 'q1', points: 2, feedback: 'ok' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(notifier.assignmentGraded).toHaveBeenCalledOnce();
      expect(notifier.assignmentGraded).toHaveBeenCalledWith({
        assignmentId: 'a1',
        studentId: 'student-1',
      });
    });

    it('does not tell them again for every later answer that is graded', async () => {
      gradeWith({ id: 'attempt-1', graded_at: '2026-10-27T09:00:00Z' });

      await service.gradeAnswer(
        'a1',
        'student-1',
        { questionId: 'q1', points: 2, feedback: 'ok' },
        ctx,
      );

      expect(notifier.assignmentGraded).not.toHaveBeenCalled();
    });

    it('tells nobody when the points are out of range', async () => {
      mock.from
        .mockReturnValueOnce(owned())
        .mockReturnValueOnce(chain({ id: 'attempt-1', graded_at: null }))
        .mockReturnValueOnce(chain([{ question_id: 'q1', points: 2 }]));

      const result = await service.gradeAnswer(
        'a1',
        'student-1',
        { questionId: 'q1', points: 9, feedback: '' },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(notifier.assignmentGraded).not.toHaveBeenCalled();
    });
  });
});

describe('QuestionReportService notifies the owner of a new report', () => {
  const studentCtx: RequestContext = {
    ...ctx,
    userId: 'student-1',
    accountType: AccountType.STUDENT,
  };

  it('tells the question owner about the first message of the report', async () => {
    const notifier = fakeNotifier();
    const supabase = mockSupabaseClient();
    supabase.from
      .mockReturnValueOnce(chain({ id: 'q-1', created_by: 'teacher-1', organization_id: orgId }))
      .mockReturnValueOnce(chain({ id: 'r-1' }))
      .mockReturnValueOnce(chain(undefined));
    const service = new QuestionReportService(
      async () => supabase,
      notifier as unknown as Notifier,
    );

    const result = await service.createReport(
      { questionId: 'q-1' },
      { message: 'Wrong answer' },
      studentCtx,
    );

    expect(result.success).toBe(true);
    expect(notifier.reportMessage).toHaveBeenCalledWith({
      reportId: 'r-1',
      recipientId: 'teacher-1',
      senderId: 'student-1',
      organizationId: orgId,
    });
  });

  it('tells nobody when the report is refused (own question)', async () => {
    const notifier = fakeNotifier();
    const supabase = mockSupabaseClient();
    supabase.from.mockReturnValueOnce(
      chain({ id: 'q-1', created_by: 'student-1', organization_id: orgId }),
    );
    const service = new QuestionReportService(
      async () => supabase,
      notifier as unknown as Notifier,
    );

    const result = await service.createReport({ questionId: 'q-1' }, { message: 'x' }, studentCtx);

    expect(result.success).toBe(false);
    expect(notifier.reportMessage).not.toHaveBeenCalled();
  });
});

describe('QuestionReportService notifies the other participant', () => {
  const student = 'student-1';
  const teacher = 'teacher-1';
  const admin = 'admin-1';

  const report = {
    id: 'r1',
    reported_by: student,
    teacher_id: teacher,
    organization_id: orgId,
    status: 'open',
  };

  function serviceFor(sender: string, notifier: ReturnType<typeof fakeNotifier>) {
    const supabase = mockSupabaseClient();
    supabase.from.mockReturnValue(chain({ id: 'm1', body: 'hi', sender_id: sender }));
    const service = new QuestionReportService(
      async () => supabase,
      notifier as unknown as Notifier,
    );
    // The access check has its own tests; here the report is simply readable by the sender.
    // It's private because callers never need it — the test seam exposes it for this stub.
    vi.spyOn(
      service as unknown as { fetchAccessibleReport: () => Promise<unknown> },
      'fetchAccessibleReport',
    ).mockResolvedValue(report);
    return service;
  }

  const sendAs = (userId: string) => ({ ...ctx, userId });
  let notifier: ReturnType<typeof fakeNotifier>;

  beforeEach(() => {
    vi.clearAllMocks();
    notifier = fakeNotifier();
  });

  it('tells the teacher when the student writes', async () => {
    const result = await serviceFor(student, notifier).addMessage(
      'r1',
      { body: 'hi' },
      sendAs(student),
    );

    expect(result.success).toBe(true);
    expect(notifier.reportMessage).toHaveBeenCalledOnce();
    expect(notifier.reportMessage).toHaveBeenCalledWith({
      reportId: 'r1',
      recipientId: teacher,
      senderId: student,
      organizationId: orgId,
    });
  });

  it('tells the student when the teacher writes', async () => {
    await serviceFor(teacher, notifier).addMessage('r1', { body: 'hi' }, sendAs(teacher));

    expect(notifier.reportMessage).toHaveBeenCalledOnce();
    expect(notifier.reportMessage).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: student }),
    );
  });

  it('tells both participants when an admin who is neither writes', async () => {
    await serviceFor(admin, notifier).addMessage('r1', { body: 'hi' }, sendAs(admin));

    expect(notifier.reportMessage).toHaveBeenCalledTimes(2);
    expect(notifier.reportMessage.mock.calls.map(([call]) => call.recipientId).sort()).toEqual([
      student,
      teacher,
    ]);
  });
});
