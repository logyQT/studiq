import * as supabaseModule from '@studiq/server/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, seedViaApi, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as createGroupReport } from '@/app/(backend)/api/v1/organization/groups/[id]/reports/route';
import { POST as postMessage } from '@/app/(backend)/api/v1/question-reports/[id]/messages/route';
import { POST as markReportRead } from '@/app/(backend)/api/v1/question-reports/[id]/read/route';
import { GET as getReport } from '@/app/(backend)/api/v1/question-reports/[id]/route';
import { GET as listReports } from '@/app/(backend)/api/v1/question-reports/route';
import { GET as unreadCount } from '@/app/(backend)/api/v1/question-reports/unread-count/route';
import { POST as createQuestionReport } from '@/app/(backend)/api/v1/questions/[id]/reports/route';

/**
 * #276 (MGR-REP-01) — end-to-end API test for the manager's organisation-wide
 * report inbox.
 *
 * Every request below runs through the real `withAuth()` → controller → service
 * stack with a REAL signed-in user session: the PostgREST client carries the
 * user's JWT, so the #191 RLS policies (org-member read of `question_reports`,
 * `question_report_messages` insert, org-member read of `org_roles`) are
 * enforced. The only seam that is stubbed is the cookie store: `createClient`
 * reads the session cookie of the acting user from `next/headers`, which does
 * not exist in an in-process test, so each assistant session is an actual
 * `@supabase/ssr` server client built on the same cookie jar (same code path as
 * production, and it produces the real `sb-<ref>-auth-token` cookies via
 * `signInWithPassword`).
 *
 * The service-level suite (`question-reports-org-scope.test.ts`) keeps covering
 * the filter branches with the service-role client; this file proves the
 * production path a manager actually hits.
 */
const PASSWORD = 'Qr276ApiTest!';
const BASE_URL = 'http://localhost';

interface Session {
  /** The signed-in user, for assertions and cleanup. */
  user: TestUserFixture;
  /** Cookie jar written by GoTrue on sign-in. */
  build: () => SupabaseClient;
}

/** Signs a user in for real and returns a factory for their request-scoped client. */
async function signIn(email: string, user: TestUserFixture): Promise<Session> {
  const jar = new Map<string, string>();
  const build = () =>
    createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookiesToSet) => {
            for (const { name, value } of cookiesToSet) jar.set(name, value);
          },
        },
      },
    );

  const { error } = await build().auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`[setup] signIn failed for ${email}: ${error.message}`);

  return { user, build };
}

/** Makes the app's `createClient()` resolve to the acting user's real session. */
function actAs(session: Session) {
  vi.mocked(supabaseModule.createClient).mockImplementation(async () => session.build());
}

describe('Question reports API — org-wide manager inbox (#276)', () => {
  const service = createServiceClient();
  const tag = `${Date.now()}`;

  let orgId: string;
  let defaultGroupId: string;
  let teacherRoleId: string;
  let memberRoleId: string;

  let questionId: string;
  let questionReportId: string;
  let groupReportId: string;

  let manager: Session;
  let teacher: Session;
  let student: Session;

  let foreignOrgId: string;
  let foreignReportId: string;

  function jsonRequest(url: string, method: string, body?: unknown) {
    return createNextRequest(
      `${BASE_URL}${url}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { active_org_id: orgId },
    );
  }

  function withId(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  beforeAll(async () => {
    // The manager creates the organisation through the real API and holds the
    // system `admin` role in it.
    const managerUser = await createTestUser({ role: 'manager', password: PASSWORD });
    const seeded = await seedViaApi(managerUser, { org: `qreport-api-276-${tag}` });
    orgId = seeded.orgId!;
    defaultGroupId = seeded.defaultGroupId!;

    const [{ data: teacherRole }, { data: memberRole }] = await Promise.all([
      service
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'teacher')
        .single(),
      service
        .from('org_roles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('name', 'member')
        .single(),
    ]);
    if (!teacherRole || !memberRole) throw new Error('[setup] org roles missing');
    teacherRoleId = teacherRole.id;
    memberRoleId = memberRole.id;

    const teacherUser = await createTestUser({ role: 'educator', password: PASSWORD });
    const studentUser = await createTestUser({ role: 'student', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: teacherUser.id,
      orgRoleId: teacherRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: studentUser.id,
      orgRoleId: memberRoleId,
    });

    const { data: bank, error: bankError } = await service
      .from('question_banks')
      .insert({
        organization_id: orgId,
        created_by: teacherUser.id,
        name: `qreport-api-276-bank-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (bankError || !bank) throw new Error(`[setup] bank: ${bankError?.message}`);

    const { data: question, error: questionError } = await service
      .from('questions')
      .insert({
        organization_id: orgId,
        created_by: teacherUser.id,
        bank_id: bank.id,
        type: 'mcq',
        content: `qreport-api-276-question-${tag}`,
        visibility: 'group',
      })
      .select('id')
      .single();
    if (questionError || !question) throw new Error(`[setup] question: ${questionError?.message}`);
    questionId = question.id;

    // A report that belongs to another organisation and to which our manager is
    // not a participant: it must never show up in their active-org inbox.
    const foreignManager = await createTestUser({ role: 'manager', password: PASSWORD });
    const foreign = await seedViaApi(foreignManager, { org: `qreport-api-276-foreign-${tag}` });
    foreignOrgId = foreign.orgId!;
    const { data: foreignReport, error: foreignError } = await service
      .from('question_reports')
      .insert({
        organization_id: foreignOrgId,
        reported_by: foreignManager.id,
        teacher_id: foreignManager.id,
        group_id: foreign.defaultGroupId,
      })
      .select('id')
      .single();
    if (foreignError || !foreignReport) {
      throw new Error(`[setup] foreign report: ${foreignError?.message}`);
    }
    foreignReportId = foreignReport.id;

    manager = await signIn(managerUser.email, managerUser);
    teacher = await signIn(teacherUser.email, teacherUser);
    student = await signIn(studentUser.email, studentUser);
  });

  afterAll(async () => {
    const reportIds = [questionReportId, groupReportId].filter(Boolean);
    if (reportIds.length > 0) {
      await service.from('question_report_messages').delete().in('report_id', reportIds);
      await service.from('question_reports').delete().in('id', reportIds);
    }
    if (foreignReportId) {
      await service.from('question_report_messages').delete().eq('report_id', foreignReportId);
      await service.from('question_reports').delete().eq('id', foreignReportId);
    }
    if (orgId) {
      await service.from('questions').delete().eq('organization_id', orgId);
      await service.from('question_banks').delete().eq('organization_id', orgId);
      await cleanupOrganizationDeep(orgId);
    }
    if (foreignOrgId) await cleanupOrganizationDeep(foreignOrgId);
    for (const session of [manager, teacher, student]) {
      if (session?.user.id) await service.auth.admin.deleteUser(session.user.id).catch(() => {});
    }
  });

  it('lets the student report the teacher question (real session, RLS on)', async () => {
    actAs(student);
    const res = await createQuestionReport(
      jsonRequest(`/api/v1/questions/${questionId}/reports`, 'POST', {
        message: 'student report #276',
      }),
      withId(questionId),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    questionReportId = body.data.id;
    expect(questionReportId).toBeTruthy();
  });

  it('lets the teacher report the ownerless group, routed to the org admin', async () => {
    actAs(teacher);
    const res = await createGroupReport(
      jsonRequest(`/api/v1/organization/groups/${defaultGroupId}/reports`, 'POST', {
        message: 'teacher report #276',
      }),
      withId(defaultGroupId),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; teacher_id: string } };
    groupReportId = body.data.id;
    // The default group has no owner -> the recipient is the org admin.
    expect(body.data.teacher_id).toBe(manager.user.id);
  });

  it('shows the manager both threads (including the one they do not participate in)', async () => {
    actAs(manager);
    const res = await listReports(jsonRequest('/api/v1/question-reports', 'GET'));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        reported_by: string;
        teacher_id: string;
        group: { name: string } | null;
      }>;
    };
    const ids = body.data.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([questionReportId, groupReportId]));
    expect(ids).not.toContain(foreignReportId);
    // No org-wide leak of the other organisation, and the manager's own
    // group thread still carries its group label data.
    expect(body.data).toHaveLength(2);
    const groupRow = body.data.find((r) => r.id === groupReportId);
    expect(groupRow?.group?.name).toBeTruthy();
  });

  it('counts both unread threads for the manager badge', async () => {
    actAs(manager);
    const res = await unreadCount(jsonRequest('/api/v1/question-reports/unread-count', 'GET'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { count: 2 } });
  });

  it('opens a thread the manager does not participate in', async () => {
    actAs(manager);
    const res = await getReport(
      jsonRequest(`/api/v1/question-reports/${questionReportId}`, 'GET'),
      withId(questionReportId),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        report: { reported_by: string; teacher_id: string };
        messages: Array<{ body: string; sender_id: string }>;
      };
    };
    expect(body.data.report).toMatchObject({
      reported_by: student.user.id,
      teacher_id: teacher.user.id,
    });
    expect(body.data.messages.map((m) => m.body)).toContain('student report #276');
  });

  it('replies as the manager and the teacher sees the message', async () => {
    actAs(manager);
    const res = await postMessage(
      jsonRequest(`/api/v1/question-reports/${questionReportId}/messages`, 'POST', {
        body: 'manager reply #276',
      }),
      withId(questionReportId),
    );
    expect(res.status).toBe(201);

    actAs(teacher);
    const thread = await getReport(
      jsonRequest(`/api/v1/question-reports/${questionReportId}`, 'GET'),
      withId(questionReportId),
    );
    expect(thread.status).toBe(200);
    const body = (await thread.json()) as {
      data: {
        messages: Array<{
          body: string;
          sender_id: string;
          sender: { id: string; full_name: string | null; email: string } | null;
        }>;
      };
    };
    // The thread UI attributes every bubble by `sender` (#373) — keep that embed
    // in the contract, including for a manager who is not a thread participant.
    expect(body.data.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: 'manager reply #276',
          sender_id: manager.user.id,
          sender: expect.objectContaining({ id: manager.user.id, email: manager.user.email }),
        }),
      ]),
    );
  });

  it('does not clear the teacher receipt when the manager opens the thread', async () => {
    actAs(manager);
    const res = await markReportRead(
      jsonRequest(`/api/v1/question-reports/${questionReportId}/read`, 'POST'),
      withId(questionReportId),
    );
    expect(res.status).toBe(200);

    const { data } = await service
      .from('question_reports')
      .select('teacher_last_read_at')
      .eq('id', questionReportId)
      .single();
    expect(data?.teacher_last_read_at).toBeNull();
  });

  it("returns NOT_FOUND for another organisation's report", async () => {
    actAs(manager);

    // Control: the manager's session really is RLS-scoped (user JWT, not the
    // service role) — the foreign row is invisible at the PostgREST level, so the
    // 404 below comes from the service gate and not from a privileged client.
    const { data: directRead, error: directError } = await manager
      .build()
      .from('question_reports')
      .select('id')
      .eq('id', foreignReportId);
    expect(directError).toBeNull();
    expect(directRead).toEqual([]);

    const res = await getReport(
      jsonRequest(`/api/v1/question-reports/${foreignReportId}`, 'GET'),
      withId(foreignReportId),
    );
    expect(res.status).toBe(404);
  });

  it('cannot widen scope by pointing active_org_id at an organisation the manager is not in', async () => {
    actAs(manager);
    // Forged/stale cookie: no org_members row -> no org-wide scope, and the
    // active org's rows must not survive the switch in the payload.
    const res = await listReports(
      createNextRequest(
        `${BASE_URL}/api/v1/question-reports`,
        { method: 'GET' },
        { active_org_id: foreignOrgId },
      ),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((r) => r.id)).toEqual([groupReportId]);
  });
});
