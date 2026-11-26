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
  setOrgPlan,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import { PUT as putQuiz } from '@/app/(backend)/api/v1/teacher/quizzes/[id]/route';

/**
 * ADR-0015 §7.1 + D-5e2 at API level: `QuizTeacherService` has ONE derivation of the access
 * failure, so the same matrix answers for every method — missing quiz → 404, quiz in a foreign
 * org → 404 (the request is scoped to the active org; tenant existence is not leaked), quiz in
 * the active org the caller's `quiz.update` scope does not reach → 403, allowed → 2xx. This file
 * pins all four rows through `PUT /api/v1/teacher/quizzes/[id]` with real signed-in sessions
 * (the same shape as `org-control-permission-api.test.ts`); the unit suite pins the same rows
 * for the read path (`getById`).
 *
 * The org plan is `hub`, which is capacity only since #1493, so the author's
 * personal `spark` plan carries `quiz.templates` into the org; the 403/404 rows
 * below are the permission derivation and not the entitlement gate that runs
 * first on writes.
 */

const PASSWORD = 'QuizMatrix1!';

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

async function putQuizAs(
  session: Session,
  orgId: string,
  quizId: string,
): Promise<{ status: number; body: unknown }> {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  const request = createNextRequest(
    `http://localhost/api/v1/teacher/quizzes/${quizId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed quiz' }),
    },
    { active_org_id: orgId },
  );
  const response = await putQuiz(request, { params: Promise.resolve({ id: quizId }) });
  return { status: response.status, body: await response.json() };
}

async function insertQuiz(
  service: ReturnType<typeof createTypedServiceClient>,
  organizationId: string,
  createdBy: string,
  name: string,
): Promise<string> {
  const { data, error } = await service
    .from('quizzes')
    .insert({ organization_id: organizationId, created_by: createdBy, name })
    .select('id')
    .single();
  if (error) throw new Error(`[setup] quiz ${name}: ${error.message}`);
  return data.id;
}

describe('quiz-teacher 403/404 matrix (ADR-0015 §7.1, D-5e2)', () => {
  const service = createTypedServiceClient();
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let orgId: string;
  let foreignOrgId: string;
  let caller: TestUserFixture;
  let otherTeacher: TestUserFixture;
  let callerSession: Session;
  let ownQuizId: string;
  let otherQuizId: string;
  let foreignQuizId: string;

  beforeAll(async () => {
    const org = await seedOrganization(`quiz-matrix-${tag}`);
    orgId = org.org.id;
    // The organization ladder is capacity only since #1493, so the author's
    // personal Plus plan carries `quiz.templates` into the org; the write's
    // entitlement gate passes and the status below is the permission
    // derivation, not the plan gate.
    await setOrgPlan(orgId, 'hub');

    const foreignOrg = await seedOrganization(`quiz-matrix-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;

    caller = await createTestUser({ role: 'educator', password: PASSWORD });
    otherTeacher = await createTestUser({ role: 'educator', password: PASSWORD });
    for (const user of [caller, otherTeacher]) {
      const { error } = await service
        .from('profiles')
        .update({ personal_plan_key: 'spark' })
        .eq('id', user.id);
      if (error) throw new Error(`[setup] personal plan: ${error.message}`);
    }
    await seedOrgMembership({
      organizationId: orgId,
      userId: caller.id,
      orgRoleId: org.teacherRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: otherTeacher.id,
      orgRoleId: org.teacherRoleId,
    });
    callerSession = await signIn(caller.email);

    ownQuizId = await insertQuiz(service, orgId, caller.id, `matrix-own-${tag}`);
    otherQuizId = await insertQuiz(service, orgId, otherTeacher.id, `matrix-other-${tag}`);
    foreignQuizId = await insertQuiz(
      service,
      foreignOrgId,
      otherTeacher.id,
      `matrix-foreign-${tag}`,
    );
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId).catch(() => {});
    if (foreignOrgId) await cleanupOrganizationDeep(foreignOrgId).catch(() => {});
  });

  it('answers 404 for a missing quiz', async () => {
    const { status } = await putQuizAs(
      callerSession,
      orgId,
      '00000000-0000-4000-8000-0000000000d1',
    );
    expect(status).toBe(404);
  });

  it('answers 404 for a quiz in a foreign org (no tenant-existence leak)', async () => {
    const { status } = await putQuizAs(callerSession, orgId, foreignQuizId);
    expect(status).toBe(404);
  });

  it('answers 403 for a same-org quiz the own quiz.update scope does not reach', async () => {
    // The caller holds `quiz.update` at `own` (the system Teacher), so the controller gate passes
    // and the row-level derivation refuses: the quiz belongs to another author.
    const { status } = await putQuizAs(callerSession, orgId, otherQuizId);
    expect(status).toBe(403);
  });

  it('answers 2xx for the caller’s own quiz', async () => {
    const { status } = await putQuizAs(callerSession, orgId, ownQuizId);
    expect(status).toBe(200);
  });
});
