import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { Database } from '@studiq/server/types/database';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  seedOrganization,
  seedGroupMembership,
  seedOrgMembership,
  setOrgPlan,
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
  GET as listDecks,
  POST as createDeck,
} from '@/app/(backend)/api/v1/flashcards/decks/route';
import {
  DELETE as deleteDeck,
  GET as getDeck,
  PUT as updateDeck,
} from '@/app/(backend)/api/v1/flashcards/decks/[id]/route';
import { GET as myPermissions } from '@/app/(backend)/api/v1/me/permissions/route';
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
  let teacherRoleId: string;
  let groupId: string;
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
  let teacher: TestUserFixture;

  let quizSession: Session;
  let quiz2Session: Session;
  let assignmentSession: Session;
  let statsSession: Session;
  let noKeySession: Session;
  let bankSession: Session;
  let studentAdminSession: Session;
  let memberSession: Session;
  let teacherSession: Session;

  async function roleWith(
    organizationId: string,
    name: string,
    keys: string[],
    scope: 'own' | 'group' | 'organization',
    entitlementProfile: 'all' | 'learner' | 'none' = 'none',
  ): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({
        organization_id: organizationId,
        name,
        display_name: name,
        is_system: false,
        entitlement_profile: entitlementProfile,
      })
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

  /**
   * The organization ladder is capacity only since #1493, so a paid surface
   * reaches an org member through the personal plan (`personalPortable`). These
   * cases pin permissions; the personal plan keeps the entitlement gate out of
   * the way.
   */
  async function setPersonalPlan(user: TestUserFixture, plan: string): Promise<void> {
    const { error } = await service
      .from('profiles')
      .update({ personal_plan_key: plan })
      .eq('id', user.id);
    if (error) throw new Error(`[setup] personal plan ${plan}: ${error.message}`);
  }

  beforeAll(async () => {
    const org = await seedOrganization(`content-route-api-${tag}`);
    orgId = org.org.id;
    adminRoleId = org.adminRoleId;
    memberRoleId = org.memberRoleId;
    teacherRoleId = org.teacherRoleId;
    groupId = org.defaultGroupId;

    const foreignOrg = await seedOrganization(`content-route-api-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;

    // The fixture org sits on `hub` for capacity; the paid surfaces below come
    // from each actor's personal plan.
    await setOrgPlan(orgId, 'hub');

    // Phase 5d: the quiz writes are additionally gated on the
    // `quiz.templates` entitlement, which the personal Plus plan carries; the
    // cases still pin the permission keys.
    quizRoleId = await roleWith(
      orgId,
      `quiz-holder-${tag}`,
      ['quiz.read', 'quiz.create', 'quiz.update', 'quiz.delete'],
      'own',
      'all',
    );
    assignmentRoleId = await roleWith(
      orgId,
      `assignment-holder-${tag}`,
      ['assignment.read', 'assignment.create', 'assignment.update', 'assignment.delete'],
      'own',
    );
    statsRoleId = await roleWith(orgId, `stats-holder-${tag}`, ['stats.read'], 'group');
    // The actor's personal Plus plan carries `quiz.templates`, so this role's
    // 403s below are permission-only: without the key the entitlement gate
    // would refuse `createQuiz` as well and the case could not attribute the
    // 403 to the permission (R42).
    noKeyRoleId = await roleWith(orgId, `no-key-${tag}`, ['group.read'], 'group', 'all');
    bankRoleId = await roleWith(orgId, `bank-holder-${tag}`, ['question_bank.update'], 'own');

    quizHolder = await memberUser('educator', quizRoleId);
    quizHolder2 = await memberUser('educator', quizRoleId);
    assignmentHolder = await memberUser('educator', assignmentRoleId);
    statsHolder = await memberUser('educator', statsRoleId);
    noKey = await memberUser('student', noKeyRoleId);
    bankHolder = await memberUser('educator', bankRoleId);
    studentAdmin = await memberUser('student', adminRoleId);
    member = await memberUser('student', memberRoleId);
    teacher = await memberUser('educator', teacherRoleId);

    await setPersonalPlan(quizHolder, 'spark');
    await setPersonalPlan(quizHolder2, 'spark');
    await setPersonalPlan(statsHolder, 'ace');
    await setPersonalPlan(noKey, 'spark');
    // The student-persona Admin authors a quiz (D13): the persona is irrelevant,
    // so the paid `quiz.templates` key rides their personal Plus plan too.
    await setPersonalPlan(studentAdmin, 'spark');

    // The class the content is shared to: the Teacher under test is a plain
    // group member; the Admin (the deck author) teaches it; the Member reads it.
    await seedGroupMembership({ groupId, userId: teacher.id, role: 'member' });
    await seedGroupMembership({ groupId, userId: studentAdmin.id, role: 'teacher' });
    await seedGroupMembership({ groupId, userId: member.id, role: 'member' });

    quizSession = await signIn(quizHolder.email);
    quiz2Session = await signIn(quizHolder2.email);
    assignmentSession = await signIn(assignmentHolder.email);
    statsSession = await signIn(statsHolder.email);
    noKeySession = await signIn(noKey.email);
    bankSession = await signIn(bankHolder.email);
    studentAdminSession = await signIn(studentAdmin.email);
    memberSession = await signIn(member.email);
    teacherSession = await signIn(teacher.email);
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

  describe('the assignment list at group scope (ADR-0015 phase 6e)', () => {
    // The seeded Teacher reads `assignment.read` at `group`. The list is the one read
    // a teacher needs ("what runs exist for my classes"), so it is widened to the runs
    // targeting a class they *teach* — while the detail stays the author's (it carries
    // answer keys). Both halves are proved here against the real route.
    let groupReader: TestUserFixture;
    let colleague: TestUserFixture;
    let groupReaderSession: Session;
    let colleagueSession: Session;
    let taughtGroupId: string;
    let memberOnlyGroupId: string;
    let taughtRunId: string;
    let memberOnlyRunId: string;

    beforeAll(async () => {
      groupReader = await memberUser('educator', teacherRoleId);
      colleague = await memberUser('educator', teacherRoleId);

      const { data: groups, error: groupError } = await service
        .from('groups')
        .insert([
          { organization_id: orgId, name: `6e taught ${tag}`, is_default: false },
          { organization_id: orgId, name: `6e member ${tag}`, is_default: false },
        ])
        .select('id, name');
      if (groupError) throw new Error(`[setup] 6e groups: ${groupError.message}`);
      const [taught, memberOnly] = groups;
      if (!taught || !memberOnly) throw new Error('[setup] 6e groups: expected two rows');
      taughtGroupId = taught.id;
      memberOnlyGroupId = memberOnly.id;

      // The reader teaches one class and is a plain `member` of the other — plain
      // membership is the audience, not the staff, so the second must not widen (§4.3).
      await seedGroupMembership({
        groupId: taughtGroupId,
        userId: groupReader.id,
        role: 'teacher',
      });
      await seedGroupMembership({
        groupId: memberOnlyGroupId,
        userId: groupReader.id,
        role: 'member',
      });

      const { data: taughtRun, error: taughtRunError } = await service
        .from('teacher_assignments')
        .insert({
          organization_id: orgId,
          created_by: colleague.id,
          title: `6e taught run ${tag}`,
        })
        .select('id')
        .single();
      if (taughtRunError) throw new Error(`[setup] 6e taught run: ${taughtRunError.message}`);
      taughtRunId = taughtRun.id;

      const { data: memberOnlyRun, error: memberOnlyRunError } = await service
        .from('teacher_assignments')
        .insert({
          organization_id: orgId,
          created_by: colleague.id,
          title: `6e member-only run ${tag}`,
        })
        .select('id')
        .single();
      if (memberOnlyRunError) {
        throw new Error(`[setup] 6e member-only run: ${memberOnlyRunError.message}`);
      }
      memberOnlyRunId = memberOnlyRun.id;

      const { error: targetError } = await service.from('assignment_targets').insert([
        { assignment_id: taughtRunId, group_id: taughtGroupId },
        { assignment_id: memberOnlyRunId, group_id: memberOnlyGroupId },
      ]);
      if (targetError) throw new Error(`[setup] 6e targets: ${targetError.message}`);

      groupReaderSession = await signIn(groupReader.email);
      colleagueSession = await signIn(colleague.email);
    }, 120_000);

    it('lists a colleague’s run targeted at a taught class and not one targeted at a class the caller only belongs to', async () => {
      const res = await call<{ data: Array<{ id: string; created_by: string }> }>(
        groupReaderSession,
        listAssignments,
        '/api/v1/teacher/assignments',
        undefined,
        orgId,
      );

      expect(res.status).toBe(200);
      const ids = res.body.data.map((row) => row.id);
      expect(ids, 'the run for the class the caller teaches').toContain(taughtRunId);
      expect(ids, 'a class the caller is only a member of does not widen the list').not.toContain(
        memberOnlyRunId,
      );
    });

    it('serves the author the same run (200), so the colleague’s 403 is scope, not breakage', async () => {
      const res = await callWithParams<{ id: string }, { data: { created_by: string } }>(
        colleagueSession,
        getAssignment,
        `/api/v1/teacher/assignments/${taughtRunId}`,
        undefined,
        orgId,
        { id: taughtRunId },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.created_by).toBe(colleague.id);
    });

    it('refuses the colleague’s run detail — the list is wider, the composer is not (R23)', async () => {
      // 403, not 404: RLS admits the row to a member of the targeted class, and the
      // service is the narrower gate. The detail carries the answer key, so this
      // asymmetry is deliberate until phase 7 gives a colleague's run a read-only view.
      const res = await callWithParams(
        groupReaderSession,
        getAssignment,
        `/api/v1/teacher/assignments/${taughtRunId}`,
        undefined,
        orgId,
        { id: taughtRunId },
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: 'FORBIDDEN' });
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

  describe('the seeded Teacher role — reads at group, writes at own (D29)', () => {
    let sharedDeckId: string;

    beforeAll(async () => {
      // The Admin author is a group teacher; the seeded Teacher under test is a
      // plain group member, which is the reader `group` scope is for.
      const created = await call<{ data: { id: string } }>(
        studentAdminSession,
        createDeck,
        '/api/v1/flashcards/decks',
        jsonInit('POST', {
          name: `d29 shared ${tag}`,
          visibility: 'group',
          groupIds: [groupId],
        }),
        orgId,
      );
      expect(created.status).toBe(201);
      sharedDeckId = created.body.data.id;
    });

    it('the live context carries every content read at group and its writes at own', async () => {
      const res = await call<{ data: { permissions: Record<string, string> } }>(
        teacherSession,
        myPermissions,
        '/api/v1/me/permissions',
        undefined,
        orgId,
      );
      expect(res.status).toBe(200);

      const scopes = res.body.data.permissions;
      for (const key of ['deck.read', 'assignment.read', 'stats.read']) {
        expect(scopes[key], key).toBe('group');
      }
      for (const key of ['deck.create', 'deck.update', 'assignment.update']) {
        expect(scopes[key], key).toBe('own');
      }
    });

    it('reads another member’s group-shared deck (group scope)', async () => {
      const list = await call<{ data: { items: Array<{ id: string }> } }>(
        teacherSession,
        listDecks,
        '/api/v1/flashcards/decks?limit=100',
        undefined,
        orgId,
      );
      expect(list.status).toBe(200);
      expect(list.body.data.items.map((deck) => deck.id)).toContain(sharedDeckId);

      const got = await callWithParams(
        teacherSession,
        getDeck,
        `/api/v1/flashcards/decks/${sharedDeckId}`,
        undefined,
        orgId,
        { id: sharedDeckId },
      );
      expect(got.status).toBe(200);
    });

    it('cannot update or delete the deck it just read (writes stay own)', async () => {
      const put = await callWithParams(
        teacherSession,
        updateDeck,
        `/api/v1/flashcards/decks/${sharedDeckId}`,
        jsonInit('PUT', { name: 'd29 renamed' }),
        orgId,
        { id: sharedDeckId },
      );
      expect(put.status).toBe(403);
      expect(put.body).toEqual({ success: false, error: 'FORBIDDEN' });

      const del = await callWithParams(
        teacherSession,
        deleteDeck,
        `/api/v1/flashcards/decks/${sharedDeckId}`,
        { method: 'DELETE' },
        orgId,
        { id: sharedDeckId },
      );
      expect(del.status).toBe(403);

      const stillThere = await callWithParams(
        teacherSession,
        getDeck,
        `/api/v1/flashcards/decks/${sharedDeckId}`,
        undefined,
        orgId,
        { id: sharedDeckId },
      );
      expect(stillThere.status).toBe(200);
    });

    it('a Member still reads at group', async () => {
      const list = await call<{ data: { items: Array<{ id: string }> } }>(
        memberSession,
        listDecks,
        '/api/v1/flashcards/decks?limit=100',
        undefined,
        orgId,
      );
      expect(list.status).toBe(200);
      expect(list.body.data.items.map((deck) => deck.id)).toContain(sharedDeckId);
    });
  });
});
