import { AccountType, type RequestContext } from '@studiq/authz';
import { questionReportService } from '@studiq/server/services/question-report.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';

/**
 * #276 (MGR-REP-01): a manager used to see only the report threads they
 * personally participate in, because `list`/`unreadCount` always applied the
 * reporter/recipient filter. The org admin must see (and answer) every report of
 * the active organization *in addition to* their own participant threads, while
 * teachers and students stay participant-only.
 *
 * The services run on the service-role client (`mockUser`), i.e. with RLS out of
 * the picture, so these assertions prove the application-level scope rather than
 * the #191 policies. The production read/reply path under a real user session
 * (RLS enforced) is covered by `question-reports-api.test.ts`.
 */
describe('Question reports org-wide manager scope (#276)', () => {
  const service = createServiceClient();
  const tag = `${Date.now()}`;

  let orgId: string;
  let otherOrgId: string;
  let adminRoleId: string;
  let teacherRoleId: string;
  let memberRoleId: string;

  let managerId: string;
  let teacherId: string;
  let studentId: string;
  let outsiderId: string;

  let questionReportId: string;
  let groupReportId: string;
  let legacyReportId: string;
  let otherOrgReportId: string;

  function ctxFor(overrides: Partial<RequestContext>): RequestContext {
    return {
      userId: managerId,
      accountType: AccountType.MANAGER,
      traceId: `reports-276-${tag}`,
      url: '/api/v1/question-reports',
      method: 'GET',
      activeOrgId: orgId,
      orgRoleId: adminRoleId,
      groupIds: [],
      permissionScopes: {},
      ...overrides,
    };
  }

  async function seedReport(data: {
    organizationId: string | null;
    reportedBy: string;
    teacherId: string;
    questionId?: string;
    groupId?: string;
  }): Promise<string> {
    const { data: report, error } = await service
      .from('question_reports')
      .insert({
        organization_id: data.organizationId,
        reported_by: data.reportedBy,
        teacher_id: data.teacherId,
        question_id: data.questionId ?? null,
        group_id: data.groupId ?? null,
      })
      .select('id')
      .single();
    if (error || !report) throw new Error(`[setup] report: ${error?.message}`);

    const { error: messageError } = await service.from('question_report_messages').insert({
      report_id: report.id,
      sender_id: data.reportedBy,
      body: `report-${tag}`,
    });
    if (messageError) throw new Error(`[setup] report message: ${messageError.message}`);

    return report.id;
  }

  beforeAll(async () => {
    const seeded = await seedOrganization(`qreport-276-${tag}`);
    orgId = seeded.org.id;
    adminRoleId = seeded.adminRoleId;
    teacherRoleId = seeded.teacherRoleId;
    memberRoleId = seeded.memberRoleId;

    const other = await seedOrganization(`qreport-276-other-${tag}`);
    otherOrgId = other.org.id;

    const manager = await createTestUser({ role: 'manager' });
    const teacher = await createTestUser({ role: 'educator' });
    const student = await createTestUser({ role: 'student' });
    const outsider = await createTestUser({ role: 'student' });
    managerId = manager.id;
    teacherId = teacher.id;
    studentId = student.id;
    outsiderId = outsider.id;

    await seedOrgMembership({ organizationId: orgId, userId: managerId, orgRoleId: adminRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: teacherId, orgRoleId: teacherRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: studentId, orgRoleId: memberRoleId });

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        name: `qreport-276-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError || !bank) throw new Error(`[setup] bank: ${bankError?.message}`);

    const { data: question, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacherId,
        bank_id: bank.id,
        type: 'mcq',
        content: `qreport-276-question-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (questionError || !question) throw new Error(`[setup] question: ${questionError?.message}`);

    // The issue scenario: a student reports the teacher's question.
    questionReportId = await seedReport({
      organizationId: orgId,
      reportedBy: studentId,
      teacherId,
      questionId: question.id,
    });

    // ...and a group report addressed to the org admin, which is the single row
    // the manager could already see before the fix.
    groupReportId = await seedReport({
      organizationId: orgId,
      reportedBy: teacherId,
      teacherId: managerId,
      groupId: seeded.defaultGroupId,
    });

    // A legacy thread with no organization where the manager is the recipient:
    // the org-wide branch must not take a manager's own participant threads away.
    legacyReportId = await seedReport({
      organizationId: null,
      reportedBy: teacherId,
      teacherId: managerId,
      questionId: question.id,
    });

    // A report in another organization must never leak into the active org. The
    // manager is not a participant of it, so it exercises the org check.
    otherOrgReportId = await seedReport({
      organizationId: otherOrgId,
      reportedBy: outsiderId,
      teacherId: outsiderId,
      groupId: other.defaultGroupId,
    });

    mockUser(manager);
  });

  afterAll(async () => {
    await service
      .from('question_report_messages')
      .delete()
      .in('report_id', [questionReportId, groupReportId, legacyReportId, otherOrgReportId]);
    await service
      .from('question_reports')
      .delete()
      .in('id', [questionReportId, groupReportId, legacyReportId, otherOrgReportId]);
    await service.from('questions').delete().eq('organization_id', orgId);
    await service.from('question_banks').delete().eq('organization_id', orgId);
    if (orgId) await cleanupOrganizationDeep(orgId);
    if (otherOrgId) await cleanupOrganizationDeep(otherOrgId);
    for (const userId of [managerId, teacherId, studentId, outsiderId]) {
      if (userId) await service.auth.admin.deleteUser(userId).catch(() => {});
    }
  });

  it('lists every report of the active organization for its admin', async () => {
    const result = await questionReportService.list(ctxFor({}));

    expect(result.success).toBe(true);
    if (!result.success) return;
    const ids = (result.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([questionReportId, groupReportId, legacyReportId]));
    expect(ids).not.toContain(otherOrgReportId);
    // Org rows are added on top of the admin's own participant threads.
    expect(ids).toHaveLength(3);
  });

  it('counts the org-wide unread reports for its admin', async () => {
    const result = await questionReportService.unreadCount(ctxFor({}));

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ count: 3 });
  });

  it('keeps teachers and students participant-only', async () => {
    const teacherResult = await questionReportService.list(
      ctxFor({
        userId: teacherId,
        accountType: AccountType.EDUCATOR,
        orgRoleId: teacherRoleId,
      }),
    );
    expect(teacherResult.success).toBe(true);
    if (teacherResult.success) {
      const ids = (teacherResult.data as Array<{ id: string }>).map((r) => r.id);
      // The teacher reported the group thread, received the question thread and
      // reported the legacy NULL-org thread.
      expect(ids).toEqual(
        expect.arrayContaining([questionReportId, groupReportId, legacyReportId]),
      );
      expect(ids).not.toContain(otherOrgReportId);
    }

    const studentResult = await questionReportService.list(
      ctxFor({
        userId: studentId,
        accountType: AccountType.STUDENT,
        orgRoleId: memberRoleId,
      }),
    );
    expect(studentResult.success).toBe(true);
    if (studentResult.success) {
      const ids = (studentResult.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toEqual([questionReportId]);
    }
  });

  it('opens a non-participant question report in the active org', async () => {
    const result = await questionReportService.getById(questionReportId, ctxFor({}));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        report: { id: questionReportId, reported_by: studentId, teacher_id: teacherId },
        messages: [expect.objectContaining({ sender_id: studentId })],
      });
    }
  });

  it('replies to a non-participant report and the teacher sees the message', async () => {
    const reply = await questionReportService.addMessage(
      questionReportId,
      { body: 'manager reply #276' },
      ctxFor({}),
    );
    expect(reply.success).toBe(true);

    const teacherView = await questionReportService.getById(
      questionReportId,
      ctxFor({
        userId: teacherId,
        accountType: AccountType.EDUCATOR,
        orgRoleId: teacherRoleId,
      }),
    );
    expect(teacherView.success).toBe(true);
    if (teacherView.success) {
      const messages = (teacherView.data as { messages: Array<{ body: string }> }).messages;
      expect(messages.map((m) => m.body)).toContain('manager reply #276');
    }
  });

  it('does not clear the teacher unread receipt when the admin observes the thread', async () => {
    const marked = await questionReportService.markRead(questionReportId, ctxFor({}));
    expect(marked.success).toBe(true);

    const { data } = await service
      .from('question_reports')
      .select('teacher_last_read_at')
      .eq('id', questionReportId)
      .single();
    expect(data?.teacher_last_read_at).toBeNull();
  });

  it('denies a report from another organization', async () => {
    const result = await questionReportService.getById(otherOrgReportId, ctxFor({}));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('NOT_FOUND');
  });

  it('denies org-wide visibility to a manager holding only a teacher role', async () => {
    const teacherRoleCtx = ctxFor({ orgRoleId: teacherRoleId });

    const listed = await questionReportService.list(teacherRoleCtx);
    expect(listed.success).toBe(true);
    if (listed.success) {
      const ids = (listed.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(questionReportId);
    }

    const single = await questionReportService.getById(questionReportId, teacherRoleCtx);
    expect(single.success).toBe(false);
    if (!single.success) expect(single.error).toBe('NOT_FOUND');
  });
});
