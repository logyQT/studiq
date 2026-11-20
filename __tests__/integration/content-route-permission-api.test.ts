import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { Database } from '@studiq/server/types/database';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import { json } from '#test/helpers/json';
import type { NextRequest } from 'next/server';
import {
  GET as listQuizzes,
  POST as createQuiz,
} from '@/app/(backend)/api/v1/teacher/quizzes/route';
import {
  DELETE as deleteQuiz,
  GET as getQuiz,
  PUT as updateQuiz,
} from '@/app/(backend)/api/v1/teacher/quizzes/[id]/route';
import { PUT as bulkQuiz } from '@/app/(backend)/api/v1/teacher/quizzes/[id]/bulk/route';
import {
  GET as listAssignments,
  POST as createAssignment,
} from '@/app/(backend)/api/v1/teacher/assignments/route';
import {
  GET as getAssignment,
  PUT as updateAssignment,
} from '@/app/(backend)/api/v1/teacher/assignments/[id]/route';
import { GET as teacherStats } from '@/app/(backend)/api/v1/stats/teacher/route';
import { GET as questionLedger } from '@/app/(backend)/api/v1/questions/[id]/ledger/route';

/**
 * ADR-0015 §7 / phase 2b-6: the content, stats and teacher routes authorize on
 * the catalog keys, decided from the context alone — never from the persona.
 * This file drives the real route handlers through the real `withAuth`,
 * controller and service with real signed-in sessions, so `ctx.permissionScopes`
 * is the one `withAuth` builds.
 *
 * The positive callers hold custom roles carrying only their family's keys, so
 * the cases pin the permission, not a role name. The RLS twin of the assignment
 * INSERT (`assignment.create`) is exercised through the real create: a
 * student-persona Admin and an own-scope custom-role holder both mint a run.
 */

const PASSWORD = 'ContentRouteApi!';

interface Session {
  build: () => SupabaseClient<Database>;
}

async function signIn(email: string): Promise<Session> {
  const jar = new Map<string, string>();
  const build = () =>
    createServerClient<Database>(
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
  return { build };
}

type Request = ReturnType<typeof createNextRequest>;

function sessionRequest(
  session: Session,
  url: string,
  init: RequestInit | undefined,
  orgId: string | null,
): Request {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  return createNextRequest(
    `http://localhost${url}`,
    init,
    orgId ? { active_org_id: orgId } : undefined,
  );
}

type NoParamsHandler = (req: NextRequest) => Promise<Response>;
type ParamsHandler<P extends Record<string, string>> = (
  req: NextRequest,
  context: { params: Promise<P> },
) => Promise<Response>;

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T types the caller's read of the untyped JSON boundary
async function call<T = unknown>(
  session: Session,
  handler: NoParamsHandler,
  url: string,
  init: RequestInit | undefined,
  orgId: string | null,
): Promise<{ status: number; body: T }> {
  const response = await handler(sessionRequest(session, url, init, orgId));
  return { status: response.status, body: await json<T>(response) };
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T types the caller's read of the untyped JSON boundary
async function callWithParams<P extends Record<string, string>, T = unknown>(
  session: Session,
  handler: ParamsHandler<P>,
  url: string,
  init: RequestInit | undefined,
  orgId: string | null,
  params: P,
): Promise<{ status: number; body: T }> {
  const response = await handler(sessionRequest(session, url, init, orgId), {
    params: Promise.resolve(params),
  });
  return { status: response.status, body: await json<T>(response) };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('content/stats/teacher routes authorize on catalog keys (2b-6)', () => {
  const service = createTypedServiceClient();
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let orgId: string;
  let foreignOrgId: string;
  let adminRoleId: string;
  let memberRoleId: string;
  let quizRoleId: string;
  let assignmentRoleId: string;
  let statsRoleId: string;
  let noKeyRoleId: string;
  let bankRoleId: string;

  let quizHolder: TestUserFixture;
  let quizHolder2: TestUserFixture;
  let assignmentHolder: TestUserFixture;
  let statsHolder: TestUserFixture;
  let noKey: TestUserFixture;
  let bankHolder: TestUserFixture;
  let studentAdmin: TestUserFixture;
  let member: TestUserFixture;

  let quizSession: Session;
  let quiz2Session: Session;
  let assignmentSession: Session;
  let statsSession: Session;
  let noKeySession: Session;
  let bankSession: Session;
  let studentAdminSession: Session;
  let memberSession: Session;

  async function roleWith(
    organizationId: string,
    name: string,
    keys: string[],
    scope: 'own' | 'group' | 'organization',
  ): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: organizationId, name, display_name: name, is_system: false })
      .select('id')
      .single();
    if (error) throw new Error(`[setup] role ${name}: ${error.message}`);

    if (keys.length > 0) {
      const { error: permissionError } = await service
        .from('org_role_permissions')
        .insert(keys.map((key) => ({ org_role_id: role.id, permission_key: key, scope })));
      if (permissionError) {
        throw new Error(`[setup] permissions ${name}: ${permissionError.message}`);
      }
    }
    return role.id;
  }

  async function memberUser(
    role: 'student' | 'educator' | 'manager',
    roleId: string,
  ): Promise<TestUserFixture> {
    const user = await createTestUser({ role, password: PASSWORD });
    await seedOrgMembership({ organizationId: orgId, userId: user.id, orgRoleId: roleId });
    return user;
  }

  beforeAll(async () => {
    const org = await seedOrganization(`content-route-api-${tag}`);
    orgId = org.org.id;
    adminRoleId = org.adminRoleId;
    memberRoleId = org.memberRoleId;

    const foreignOrg = await seedOrganization(`content-route-api-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;

    quizRoleId = await roleWith(
      orgId,
      `quiz-holder-${tag}`,
      ['quiz.read', 'quiz.create', 'quiz.update', 'quiz.delete'],
      'own',
    );
    assignmentRoleId = await roleWith(
      orgId,
      `assignment-holder-${tag}`,
      ['assignment.read', 'assignment.create', 'assignment.update', 'assignment.delete'],
      'own',
    );
    statsRoleId = await roleWith(orgId, `stats-holder-${tag}`, ['stats.read'], 'group');
    noKeyRoleId = await roleWith(orgId, `no-key-${tag}`, ['group.read'], 'group');
    bankRoleId = await roleWith(orgId, `bank-holder-${tag}`, ['question_bank.update'], 'own');

    quizHolder = await memberUser('educator', quizRoleId);
    quizHolder2 = await memberUser('educator', quizRoleId);
    assignmentHolder = await memberUser('educator', assignmentRoleId);
    statsHolder = await memberUser('educator', statsRoleId);
    noKey = await memberUser('student', noKeyRoleId);
    bankHolder = await memberUser('educator', bankRoleId);
    studentAdmin = await memberUser('student', adminRoleId);
    member = await memberUser('student', memberRoleId);

    quizSession = await signIn(quizHolder.email);
    quiz2Session = await signIn(quizHolder2.email);
    assignmentSession = await signIn(assignmentHolder.email);
    statsSession = await signIn(statsHolder.email);
    noKeySession = await signIn(noKey.email);
    bankSession = await signIn(bankHolder.email);
    studentAdminSession = await signIn(studentAdmin.email);
    memberSession = await signIn(member.email);
  }, 120_000);

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId);
    await cleanupOrganizationDeep(foreignOrgId);
  });

  describe('quizzes (quiz.*)', () => {
    it('a custom role holding only quiz.create creates a quiz (201)', async () => {
      const res = await call<{ data: { id: string } }>(
        quizSession,
        createQuiz,
        '/api/v1/teacher/quizzes',
        jsonInit('POST', { name: `2b-6 quiz ${tag}` }),
        orgId,
      );
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeTruthy();
    });

    it('a caller without quiz.create is 403 — also with a malformed body (gate before parse)', async () => {
      const res = await call(
        noKeySession,
        createQuiz,
        '/api/v1/teacher/quizzes',
        jsonInit('POST', { name: 'x' }),
        orgId,
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: 'FORBIDDEN' });

      const malformed = await call(
        noKeySession,
        createQuiz,
        '/api/v1/teacher/quizzes',
        jsonInit('POST', {}),
        orgId,
      );
      expect(malformed.status).toBe(403);
    });

    it('a student-persona Admin creates a quiz (D13: the persona is irrelevant)', async () => {
      const res = await call(
        studentAdminSession,
        createQuiz,
        '/api/v1/teacher/quizzes',
        jsonInit('POST', { name: `2b-6 student-admin ${tag}` }),
        orgId,
      );
      expect(res.status).toBe(201);
    });

    it('the list follows the holder’s scope: own quizzes only, 200', async () => {
      const res = await call<{ data: Array<{ created_by: string }> }>(
        quizSession,
        listQuizzes,
        '/api/v1/teacher/quizzes',
        undefined,
        orgId,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const row of res.body.data) {
        expect(row.created_by).toBe(quizHolder.id);
      }
    });

    it('a caller without quiz.read is 403 on the list', async () => {
      const res = await call(
        noKeySession,
        listQuizzes,
        '/api/v1/teacher/quizzes',
        undefined,
        orgId,
      );
      expect(res.status).toBe(403);
    });

    it('an own-scope holder reads and edits its own quiz, and the child bulk route gates on quiz.update', async () => {
      const created = await call<{ data: { id: string } }>(
        quizSession,
        createQuiz,
        '/api/v1/teacher/quizzes',
        jsonInit('POST', { name: `2b-6 own ${tag}` }),
        orgId,
      );
      const id = created.body.data.id;

      const got = await callWithParams(
        quizSession,
        getQuiz,
        `/api/v1/teacher/quizzes/${id}`,
        undefined,
        orgId,
        { id },
      );
      expect(got.status).toBe(200);

      const put = await callWithParams(
        quizSession,
        updateQuiz,
        `/api/v1/teacher/quizzes/${id}`,
        jsonInit('PUT', { name: 'renamed' }),
        orgId,
        { id },
      );
      expect(put.status).toBe(200);

      const bulk = await callWithParams(
        quizSession,
        bulkQuiz,
        `/api/v1/teacher/quizzes/${id}/bulk`,
        jsonInit('PUT', { name: 'bulk', questions: [] }),
        orgId,
        { id },
      );
      expect(bulk.status).toBe(200);
    });

    it('a foreign-org quiz id is 404 for a key holder, not 403 (§7.1)', async () => {
      const { data: foreignQuiz, error } = await service
        .from('quizzes')
        .insert({
          organization_id: foreignOrgId,
          created_by: quizHolder2.id,
          name: `foreign ${tag}`,
        })
        .select('id')
        .single();
      if (error) throw new Error(`[setup] foreign quiz: ${error.message}`);

      const res = await callWithParams(
        quizSession,
        getQuiz,
        `/api/v1/teacher/quizzes/${foreignQuiz.id}`,
        undefined,
        orgId,
        { id: foreignQuiz.id },
      );
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'NOT_FOUND' });
    });

    it('a same-org quiz the caller’s own scope does not reach is 403 (resolved after the parent load)', async () => {
      const created = await call<{ data: { id: string } }>(
        quiz2Session,
        createQuiz,
        '/api/v1/teacher/quizzes',
        jsonInit('POST', { name: `2b-6 other ${tag}` }),
        orgId,
      );
      const id = created.body.data.id;

      const got = await callWithParams(
        quizSession,
        getQuiz,
        `/api/v1/teacher/quizzes/${id}`,
        undefined,
        orgId,
        { id },
      );
      expect(got.status).toBe(403);

      const del = await callWithParams(
        quizSession,
        deleteQuiz,
        `/api/v1/teacher/quizzes/${id}`,
        { method: 'DELETE' },
        orgId,
        { id },
      );
      expect(del.status).toBe(403);
    });
  });

  describe('assignments (assignment.*)', () => {
    it('a custom role holding only assignment.create creates a run (201) — the INSERT policy asks the same key', async () => {
      const res = await call<{ data: { id: string } }>(
        assignmentSession,
        createAssignment,
        '/api/v1/teacher/assignments',
        jsonInit('POST', { title: `2b-6 run ${tag}` }),
        orgId,
      );
      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeTruthy();
    });

    it('a student-persona Admin creates a run (D13 + the moved RLS insert)', async () => {
      const res = await call(
        studentAdminSession,
        createAssignment,
        '/api/v1/teacher/assignments',
        jsonInit('POST', { title: `2b-6 student-admin run ${tag}` }),
        orgId,
      );
      expect(res.status).toBe(201);
    });

    it('a Member-role caller is refused (the member template carries no assignment.* key)', async () => {
      const res = await call(
        memberSession,
        createAssignment,
        '/api/v1/teacher/assignments',
        jsonInit('POST', { title: 'x' }),
        orgId,
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: 'FORBIDDEN' });

      const list = await call(
        memberSession,
        listAssignments,
        '/api/v1/teacher/assignments',
        undefined,
        orgId,
      );
      expect(list.status).toBe(403);
    });

    it('an own-scope holder reads and edits its own run; a foreign-org id is 404', async () => {
      const created = await call<{ data: { id: string } }>(
        assignmentSession,
        createAssignment,
        '/api/v1/teacher/assignments',
        jsonInit('POST', { title: `2b-6 own run ${tag}` }),
        orgId,
      );
      const id = created.body.data.id;

      const got = await callWithParams(
        assignmentSession,
        getAssignment,
        `/api/v1/teacher/assignments/${id}`,
        undefined,
        orgId,
        { id },
      );
      expect(got.status).toBe(200);

      const put = await callWithParams(
        assignmentSession,
        updateAssignment,
        `/api/v1/teacher/assignments/${id}`,
        jsonInit('PUT', { title: 'renamed' }),
        orgId,
        { id },
      );
      expect(put.status).toBe(200);

      const { data: foreignAssignment, error } = await service
        .from('teacher_assignments')
        .insert({
          organization_id: foreignOrgId,
          created_by: assignmentHolder.id,
          title: `foreign run ${tag}`,
        })
        .select('id')
        .single();
      if (error) throw new Error(`[setup] foreign assignment: ${error.message}`);

      const foreign = await callWithParams(
        assignmentSession,
        getAssignment,
        `/api/v1/teacher/assignments/${foreignAssignment.id}`,
        undefined,
        orgId,
        { id: foreignAssignment.id },
      );
      expect(foreign.status).toBe(404);
    });
  });

  describe('stats (stats.read)', () => {
    it('a custom role holding only stats.read reads the teacher stats (200)', async () => {
      const res = await call(statsSession, teacherStats, '/api/v1/stats/teacher', undefined, orgId);
      expect(res.status).toBe(200);
    });

    it('a caller without stats.read is 403', async () => {
      const res = await call(noKeySession, teacherStats, '/api/v1/stats/teacher', undefined, orgId);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: 'FORBIDDEN' });
    });

    it('a Member-role caller holds stats.read at own and is allowed', async () => {
      const res = await call(
        memberSession,
        teacherStats,
        '/api/v1/stats/teacher',
        undefined,
        orgId,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('question ledger (question_bank.update, the staff key the service enforces)', () => {
    it('a caller without the key is 403', async () => {
      const res = await callWithParams(
        noKeySession,
        questionLedger,
        '/api/v1/questions/00000000-0000-4000-8000-000000000001/ledger',
        undefined,
        orgId,
        { id: '00000000-0000-4000-8000-000000000001' },
      );
      expect(res.status).toBe(403);
    });

    it('a holder passes the gate and gets the resource answer (404 on an unknown id)', async () => {
      const res = await callWithParams(
        bankSession,
        questionLedger,
        '/api/v1/questions/00000000-0000-4000-8000-000000000001/ledger',
        undefined,
        orgId,
        { id: '00000000-0000-4000-8000-000000000001' },
      );
      expect(res.status).toBe(404);
    });
  });
});
