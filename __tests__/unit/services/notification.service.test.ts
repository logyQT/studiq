import { AccountType, type RequestContext } from '@studiq/authz';
import { NotificationController } from '@studiq/server/controllers/notification.controller';
import { error as logError } from '@studiq/server/lib/log';
import { failure, success } from '@studiq/server/lib/service-result';
import {
  NOTIFICATION_TYPES,
  NotificationIdParamsSchema,
  NotificationListQuerySchema,
} from '@studiq/server/models/notification.model';
import { NotificationService, noopNotifier } from '@studiq/server/services/notification.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/log', () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }));

// #664: the notification centre. Reading and marking run as the signed-in user's own rows; the
// producers write through the service role and must never be able to fail the action that
// caused them.

const ctx: RequestContext = {
  userId: 'user-1',
  accountType: AccountType.STUDENT,
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: 'org-1',
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

/** A thenable query builder that records what was chained and resolves to `result`. */
function builder(result: Record<string, unknown> = { data: null, error: null }) {
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'update', 'insert']) {
    b[m] = vi.fn(() => b);
  }
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.single = b.maybeSingle;
  b.then = (onfulfilled: any) => Promise.resolve(result).then(onfulfilled);
  return b;
}

/** A client whose `from(table)` hands out the next queued builder for that table. */
function client(queues: Record<string, Array<ReturnType<typeof builder>>>) {
  const calls: Record<string, Array<ReturnType<typeof builder>>> = {};
  return {
    calls,
    from: vi.fn((table: string) => {
      const next = queues[table]?.shift() ?? builder();
      (calls[table] ??= []).push(next);
      return next;
    }),
  };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  type: 'assignment_published',
  payload: { assignmentId: 'a1', title: 'Kartkówka' },
  organization_id: 'org-1',
  read_at: null,
  created_at: '2026-10-27T10:00:00Z',
  ...over,
});

describe('NotificationService: reading', () => {
  it('lists the latest of the caller with the unread count of all of theirs', async () => {
    const list = builder({
      data: [row(), row({ id: 'n2', read_at: '2026-10-27T11:00:00Z' })],
      error: null,
    });
    const unread = builder({ data: null, count: 7, error: null });
    const user = client({ notifications: [list, unread] });
    const service = new NotificationService(
      async () => user as any,
      () => ({}) as any,
    );

    const result = await service.list(ctx, { limit: 15, unread: false });

    expect(result.success && result.data.unreadCount).toBe(7);
    expect(result.success && result.data.items).toHaveLength(2);
    expect(result.success && result.data.items[0]).toEqual({
      id: 'n1',
      type: 'assignment_published',
      payload: { assignmentId: 'a1', title: 'Kartkówka' },
      organizationId: 'org-1',
      readAt: null,
      createdAt: '2026-10-27T10:00:00Z',
    });
    expect(list.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(list.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(list.limit).toHaveBeenCalledWith(15);
    expect(list.is).not.toHaveBeenCalled();
    expect(unread.is).toHaveBeenCalledWith('read_at', null);
  });

  it('lists only unread ones on request', async () => {
    const list = builder({ data: [], error: null });
    const user = client({ notifications: [list, builder({ count: 0, error: null })] });
    const service = new NotificationService(
      async () => user as any,
      () => ({}) as any,
    );

    await service.list(ctx, { limit: 5, unread: true });

    expect(list.is).toHaveBeenCalledWith('read_at', null);
  });

  it('fails when the database does', async () => {
    const user = client({
      notifications: [
        builder({ data: null, error: { code: 'XX000', message: 'boom' } }),
        builder({ count: 0 }),
      ],
    });
    const service = new NotificationService(
      async () => user as any,
      () => ({}) as any,
    );

    expect((await service.list(ctx, { limit: 15, unread: false })).success).toBe(false);
  });
});

describe('NotificationService: marking read', () => {
  it('marks only an unread notification of the caller, through the service role', async () => {
    const own = builder({ data: { id: 'n1' }, error: null });
    const user = client({ notifications: [own] });
    const update = builder({ data: null, error: null });
    const admin = client({ notifications: [update] });
    const service = new NotificationService(
      async () => user as any,
      () => admin as any,
    );

    const result = await service.markRead(ctx, 'n1');

    expect(result.success).toBe(true);
    expect(own.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(update.update).toHaveBeenCalledWith({ read_at: expect.any(String) });
    expect(update.eq).toHaveBeenCalledWith('id', 'n1');
    expect(update.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(update.is).toHaveBeenCalledWith('read_at', null);
  });

  it("answers NOT_FOUND for someone else's notification and writes nothing", async () => {
    const user = client({ notifications: [builder({ data: null, error: null })] });
    const admin = client({});
    const service = new NotificationService(
      async () => user as any,
      () => admin as any,
    );

    const result = await service.markRead(ctx, 'not-mine');

    expect(result).toMatchObject({ success: false, error: 'NOT_FOUND' });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('marks every unread notification of the caller, and only theirs', async () => {
    const update = builder({ data: null, error: null });
    const admin = client({ notifications: [update] });
    const service = new NotificationService(
      async () => ({}) as any,
      () => admin as any,
    );

    const result = await service.markAllRead(ctx);

    expect(result.success).toBe(true);
    expect(update.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(update.is).toHaveBeenCalledWith('read_at', null);
  });
});

describe('NotificationService: producers', () => {
  const assignment = builder({
    data: { title: 'Kartkówka z fizyki', organization_id: 'org-1' },
    error: null,
  });

  function service(queues: Record<string, Array<ReturnType<typeof builder>>>) {
    const admin = client(queues);
    return {
      admin,
      service: new NotificationService(
        async () => ({}) as any,
        () => admin as any,
      ),
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it('tells every targeted student once, groups and individuals, never the teacher', async () => {
    const insert = builder();
    const { admin, service: s } = service({
      teacher_assignments: [assignment],
      assignment_targets: [
        builder({
          data: [
            { group_id: 'g1', student_id: null },
            { group_id: null, student_id: 'extra' },
          ],
          error: null,
        }),
      ],
      group_members: [
        builder({
          data: [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'teacher' }, { user_id: 'extra' }],
          error: null,
        }),
      ],
      notifications: [insert],
    });

    await s.assignmentPublished({ assignmentId: 'a1', teacherId: 'teacher' });

    const rows = insert.insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.user_id).sort()).toEqual(['a', 'b', 'extra']);
    expect(rows[0]).toMatchObject({
      organization_id: 'org-1',
      type: 'assignment_published',
      payload: { assignmentId: 'a1', title: 'Kartkówka z fizyki' },
    });
    expect(admin.calls.group_members[0].eq).toHaveBeenCalledWith('role', 'member');
  });

  it('sends nothing when there are no recipients', async () => {
    const { admin, service: s } = service({
      teacher_assignments: [builder({ data: { title: 'T', organization_id: null }, error: null })],
      assignment_targets: [builder({ data: [], error: null })],
    });

    await s.assignmentPublished({ assignmentId: 'a1', teacherId: 'teacher' });

    expect(admin.calls.notifications).toBeUndefined();
  });

  it('sends large classes in batches of 500', async () => {
    const students = Array.from({ length: 1200 }, (_, i) => ({ user_id: `s${i}` }));
    const inserts = [builder(), builder(), builder()];
    const { service: s } = service({
      teacher_assignments: [
        builder({ data: { title: 'T', organization_id: 'org-1' }, error: null }),
      ],
      assignment_targets: [builder({ data: [{ group_id: 'g1', student_id: null }], error: null })],
      group_members: [builder({ data: students, error: null })],
      // A copy: the fake client takes builders off the front of the queue.
      notifications: [...inserts],
    });

    await s.assignmentPublished({ assignmentId: 'a1', teacherId: 'teacher' });

    expect(inserts.map((b) => (b.insert.mock.calls[0]?.[0] as unknown[]).length)).toEqual([
      500, 500, 200,
    ]);
  });

  it('tells the student their assignment was graded, with its title', async () => {
    const insert = builder();
    const { service: s } = service({ teacher_assignments: [assignment], notifications: [insert] });

    await s.assignmentGraded({ assignmentId: 'a1', studentId: 'student-1' });

    expect(insert.insert).toHaveBeenCalledWith([
      {
        user_id: 'student-1',
        organization_id: 'org-1',
        type: 'assignment_graded',
        payload: { assignmentId: 'a1', title: 'Kartkówka z fizyki' },
      },
    ]);
  });

  it('names the sender of a report message, falling back to the part of the e-mail before @', async () => {
    const insert = builder();
    const { service: s } = service({
      profiles: [
        builder({ data: { full_name: '  ', email: 'jan.kowalski@example.com' }, error: null }),
      ],
      notifications: [insert],
    });

    await s.reportMessage({
      reportId: 'r1',
      recipientId: 'teacher',
      senderId: 'student',
      organizationId: 'org-1',
    });

    expect(insert.insert).toHaveBeenCalledWith([
      {
        user_id: 'teacher',
        organization_id: 'org-1',
        type: 'report_message',
        payload: { reportId: 'r1', senderName: 'jan.kowalski' },
      },
    ]);
  });

  it('does not tell someone about their own message or their own acceptance', async () => {
    const { admin, service: s } = service({});

    await s.reportMessage({
      reportId: 'r1',
      recipientId: 'u',
      senderId: 'u',
      organizationId: null,
    });
    await s.invitationAccepted({ inviterId: 'u', memberId: 'u', organizationId: 'org-1' });

    expect(admin.from).not.toHaveBeenCalled();
  });

  it('tells the inviter who joined', async () => {
    const insert = builder();
    const { service: s } = service({
      profiles: [
        builder({ data: { full_name: 'Ola Nowak', email: 'ola@example.com' }, error: null }),
      ],
      notifications: [insert],
    });

    await s.invitationAccepted({ inviterId: 'manager', memberId: 'ola', organizationId: 'org-1' });

    expect(insert.insert).toHaveBeenCalledWith([
      {
        user_id: 'manager',
        organization_id: 'org-1',
        type: 'invitation_accepted',
        payload: { memberName: 'Ola Nowak' },
      },
    ]);
  });

  it('never throws, and logs only a code, when a producer fails', async () => {
    const { service: s } = service({
      teacher_assignments: [assignment],
      notifications: [
        builder({
          data: null,
          error: { code: '23503', message: 'key (user_id)=(secret-id) is not present' },
        }),
      ],
    });

    await expect(
      s.assignmentGraded({ assignmentId: 'a1', studentId: 'x' }),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith('notification.failed', {
      type: 'assignment_graded',
      errorCode: '23503',
    });
    expect(JSON.stringify(vi.mocked(logError).mock.calls)).not.toContain('secret-id');
  });

  it('skips an assignment that no longer exists', async () => {
    const { admin, service: s } = service({
      teacher_assignments: [builder({ data: null, error: null })],
    });

    await s.assignmentGraded({ assignmentId: 'gone', studentId: 'x' });

    expect(admin.calls.notifications).toBeUndefined();
  });
});

describe('noopNotifier', () => {
  it('does nothing and resolves, for every kind', async () => {
    await expect(
      Promise.all([
        noopNotifier.assignmentPublished({ assignmentId: 'a', teacherId: 't' }),
        noopNotifier.assignmentGraded({ assignmentId: 'a', studentId: 's' }),
        noopNotifier.reportMessage({
          reportId: 'r',
          recipientId: 'u',
          senderId: 'v',
          organizationId: null,
        }),
        noopNotifier.invitationAccepted({ inviterId: 'i', memberId: 'm', organizationId: 'o' }),
      ]),
    ).resolves.toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('notification schemas', () => {
  it('knows the four kinds the database allows', () => {
    expect([...NOTIFICATION_TYPES]).toEqual([
      'assignment_published',
      'assignment_graded',
      'report_message',
      'invitation_accepted',
    ]);
  });

  it('defaults the list to 15 items, all of them', () => {
    expect(NotificationListQuerySchema.parse({})).toEqual({ limit: 15, unread: false });
    expect(NotificationListQuerySchema.parse({ limit: '50', unread: 'true' })).toEqual({
      limit: 50,
      unread: true,
    });
    expect(NotificationListQuerySchema.parse({ unread: '1' }).unread).toBe(true);
    expect(NotificationListQuerySchema.parse({ unread: '0' }).unread).toBe(false);
  });

  it.each([{ limit: '0' }, { limit: '51' }, { limit: 'x' }, { unread: 'maybe' }])(
    'rejects %j',
    (q) => {
      expect(NotificationListQuerySchema.safeParse(q).success).toBe(false);
    },
  );

  it('needs a UUID for the id', () => {
    expect(
      NotificationIdParamsSchema.safeParse({ id: '3e0a1b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b' }).success,
    ).toBe(true);
    expect(NotificationIdParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
  });
});

describe('NotificationController', () => {
  const notifications = { list: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() };
  const controller = new NotificationController(notifications as any);

  beforeEach(() => vi.clearAllMocks());

  it('passes the parsed query to the service', async () => {
    notifications.list.mockResolvedValue(success({ items: [], unreadCount: 0 }));

    await controller.list({ limit: '5', unread: 'true' }, ctx);

    expect(notifications.list).toHaveBeenCalledWith(ctx, { limit: 5, unread: true });
  });

  it('answers 422 for an invalid query or id without calling the service', async () => {
    expect(await controller.list({ limit: '0' }, ctx)).toMatchObject({
      success: false,
      statusCode: 422,
    });
    expect(await controller.markRead('nope', ctx)).toMatchObject({
      success: false,
      statusCode: 422,
    });
    expect(notifications.list).not.toHaveBeenCalled();
    expect(notifications.markRead).not.toHaveBeenCalled();
  });

  it('maps NOT_FOUND to 404', async () => {
    notifications.markRead.mockResolvedValue(failure('NOT_FOUND'));

    expect(await controller.markRead('3e0a1b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b', ctx)).toMatchObject({
      success: false,
      statusCode: 404,
    });
  });

  it('marks everything read', async () => {
    notifications.markAllRead.mockResolvedValue(success(null));

    expect(await controller.markAllRead(ctx)).toMatchObject({ success: true, statusCode: 200 });
  });
});
