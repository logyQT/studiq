import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * SEC-05 — a student cannot perform a teacher action through the API.
 *
 * Prerequisite (reconciled with the tenant seeder): the legacy manual account
 * `student1@…` (password `pass`) is never used. `qa/tests/profiles/SEC-05.json`
 * declares the default `content` profile, which the suite runner seeds **once,
 * before Playwright starts**, under the case's own run suffix:
 *
 *   bun scripts/qa-tenant.ts SEC-05 --fresh
 *
 * - org `qa-sec-05-<run>` with the first-run group `G1` — so the student is a
 *   student inside an organization, not a no-organization account, and a 403
 *   cannot be an artifact of the student having no tenant scope;
 * - `student` (`STUDENT`) — the case subject, org role `member`;
 * - `teacher` (`EDUCATOR`) — the positive control;
 * - `manager` (`MANAGER`) — org admin, keeps the graph realistic.
 *
 * Acceptance points from the case, all as the **student**, with its own
 * organization active (the cookie `loginAs` writes for the seeded membership):
 * 1. `POST /api/v1/teacher/quizzes {name:"x"}` → **403 `FORBIDDEN`**.
 * 2. `POST /api/v1/teacher/assignments {...}` → **403 `FORBIDDEN`**.
 * 3. `GET /api/v1/stats/teacher` → **403 `FORBIDDEN`**.
 *    …and no resource is created: after the three calls the tenant organization
 *    owns zero `quizzes` and zero `teacher_assignments` rows, and neither table
 *    has a row created by the student.
 *
 * The rejection is the route rule (`allowedAccountTypes` in the route file, which
 * runs before the body is read): the same calls with a malformed body are still
 * 403 and never 422, so the gate is the account type — not input validation and
 * not a missing active organization.
 *
 * Adjacent regressions that matter for this surface:
 * - the collection reads behind the same gate (`GET /api/v1/teacher/quizzes`,
 *   `GET /api/v1/teacher/assignments`) are 403 for the student too;
 * - the positive control: the tenant's educator, with the same active
 *   organization, creates a quiz (201) and an assignment (201) and reads the
 *   teacher stats (200) — so the 403s above are a permission boundary, not a
 *   broken route or fixture;
 * - no over-block: the student's own panel (`/app`) loads and their own
 *   `GET /api/v1/stats/student` answers 200 with the same session.
 *
 * The profile seeds the graph only. Before the student's attempts the spec
 * deletes its own control quiz/assignment from an earlier pass on the same
 * seeded tenant (a CI retry or `--repeat-each`), through the product API, so
 * "the organization owns zero rows" stays an exact statement about the student's
 * writes rather than about leftovers.
 *
 * Nothing global is written (no admin setting, feature flag, plan, platform stat
 * or singleton row) and no other case's tenant is touched.
 */

const CASE = 'SEC-05';
const TEACHER_QUIZZES = '/api/v1/teacher/quizzes';
const TEACHER_ASSIGNMENTS = '/api/v1/teacher/assignments';
const TEACHER_STATS = '/api/v1/stats/teacher';
const STUDENT_STATS = '/api/v1/stats/student';

/** Names the positive control creates, and therefore the rows a re-run resets. */
const CONTROL_PREFIX = 'SEC-05 control';

interface ApiBody<T> {
  success: boolean;
  data?: T;
}

interface MyOrg {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

interface Quiz {
  id: string;
  name: string;
  organization_id: string;
  created_by: string;
}

interface TeacherAssignment {
  id: string;
  title: string;
  organization_id: string;
  created_by: string;
}

interface CallResult {
  status: number;
  errorCode: string | null;
  body: string;
}

/**
 * The seeded fixture must be the shape this case needs: one organization with a
 * default group, an educator for the positive control and the student subject.
 */
function loadCaseTenant(): QaTenant {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  if (!tenant.org || !tenant.group || !tenant.users.teacher || !tenant.users.student) {
    throw new Error(`${CASE} tenant is missing its organization, group, teacher or student`);
  }
  return tenant;
}

/**
 * Real login through the API, then boot the app with the tenant's organization
 * active and the Polish locale the case's copy is written in. Cookies are
 * cleared first, so a role switch never inherits the previous session.
 */
async function switchUser(
  page: Page,
  tenant: QaTenant,
  role: 'teacher' | 'student',
): Promise<void> {
  await page.context().clearCookies();
  await loginAs(page, tenant, role, {
    locale: 'pl',
    waitFor: role === 'teacher' ? /\/edu(\/|$)/ : /\/app(\/|$)/,
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
}

/**
 * Remove the control rows a previous pass on this same seeded tenant created.
 * Only this case's own `SEC-05 control …` rows are deleted, through the product
 * API, as their creator.
 */
async function resetControlRows(page: Page): Promise<void> {
  const quizzesResponse = await page.request.get(TEACHER_QUIZZES);
  expect(quizzesResponse.status(), 'GET /api/v1/teacher/quizzes while resetting').toBe(200);
  for (const quiz of ((await quizzesResponse.json()) as ApiBody<Quiz[]>).data ?? []) {
    if (!quiz.name.startsWith(CONTROL_PREFIX)) continue;
    const deleted = await page.request.delete(`${TEACHER_QUIZZES}/${quiz.id}`);
    expect(deleted.status(), `DELETE /api/v1/teacher/quizzes/${quiz.id}`).toBe(200);
  }

  const assignmentsResponse = await page.request.get(TEACHER_ASSIGNMENTS);
  expect(assignmentsResponse.status(), 'GET /api/v1/teacher/assignments while resetting').toBe(200);
  for (const assignment of ((await assignmentsResponse.json()) as ApiBody<TeacherAssignment[]>)
    .data ?? []) {
    if (!assignment.title.startsWith(CONTROL_PREFIX)) continue;
    const deleted = await page.request.delete(`${TEACHER_ASSIGNMENTS}/${assignment.id}`);
    expect(deleted.status(), `DELETE /api/v1/teacher/assignments/${assignment.id}`).toBe(200);
  }
}

async function call(
  page: Page,
  method: 'GET' | 'POST',
  url: string,
  data?: unknown,
): Promise<CallResult> {
  const response =
    method === 'GET'
      ? await page.request.get(url)
      : await page.request.post(url, data === undefined ? {} : { data });
  return {
    status: response.status(),
    errorCode: response.headers()['x-error-code'] ?? null,
    body: await response.text(),
  };
}

/**
 * The route rule's rejection: 403 with the `FORBIDDEN` code, and an envelope
 * that carries nothing else — no resource payload, no leak of teacher data.
 */
function expectForbidden(result: CallResult, label: string): void {
  expect(result.status, `${label}: HTTP status`).toBe(403);
  expect(result.errorCode, `${label}: x-error-code header`).toBe('FORBIDDEN');
  expect(JSON.parse(result.body), `${label}: response envelope`).toEqual({
    success: false,
    error: 'FORBIDDEN',
  });
}

test.describe('@case:SEC-05 @area:SEC @prio:P1 student cannot call teacher endpoints', () => {
  test('every teacher endpoint answers 403 FORBIDDEN and creates nothing', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant = loadCaseTenant();
    const org = tenant.org!;
    const teacher = tenant.users.teacher!;
    const student = tenant.users.student!;
    const run = tenant.runSuffix ?? tenant.key.slice(-8);
    const db = createQaSupabase();

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(
      `SEC-05 tenant key: ${tenant.key} (org ${org.id} / ${org.name}, ` +
        `student ${student.email}, teacher ${teacher.email})`,
    );

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Step 0: this tenant starts from an empty organization -------------
    // A retry or a repeat pass on the same seeded tenant may still hold the
    // previous pass's control rows; delete only this case's own rows through
    // the API so the "creates nothing" check below is about the student.
    await switchUser(page, tenant, 'teacher');
    await resetControlRows(page);

    // --- Step 0b: the case subject is a student with a real tenant scope --
    // The organization is active, so a 403 below cannot be "authenticated but
    // scoped to no organization" — it has to be the route's account-type rule.
    await switchUser(page, tenant, 'student');

    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status(), 'GET /api/v1/auth/me as the student').toBe(200);
    const meBody = (await me.json()) as {
      data?: { user?: { id?: string; app_metadata?: { account_type?: string } } };
    };
    expect(meBody.data?.user?.id, 'the signed-in user is the case subject').toBe(student.id);
    expect(meBody.data?.user?.app_metadata?.account_type, 'the case subject is a student').toBe(
      'student',
    );

    const orgsResponse = await page.request.get('/api/v1/me/orgs');
    expect(orgsResponse.status(), 'GET /api/v1/me/orgs as the student').toBe(200);
    const orgs = ((await orgsResponse.json()) as ApiBody<MyOrg[]>).data ?? [];
    expect(
      orgs.find((row) => row.id === org.id),
      'the student’s own organization is the active tenant scope',
    ).toMatchObject({ id: org.id, orgRoleName: 'member', isActive: true });

    // --- Step 1: POST /api/v1/teacher/quizzes -----------------------------
    expectForbidden(
      await call(page, 'POST', TEACHER_QUIZZES, { name: 'x' }),
      'POST /api/v1/teacher/quizzes as the student',
    );
    // The gate runs before input validation: an invalid payload is still 403,
    // never 422 (which would mean the request reached the quiz controller).
    expectForbidden(
      await call(page, 'POST', TEACHER_QUIZZES, {}),
      'POST /api/v1/teacher/quizzes with an invalid body',
    );

    // --- Step 2: POST /api/v1/teacher/assignments -------------------------
    expectForbidden(
      await call(page, 'POST', TEACHER_ASSIGNMENTS, {
        title: 'x',
        deadline: '2030-01-01T00:00:00.000Z',
        timeLimitMin: 10,
        maxAttempts: 1,
      }),
      'POST /api/v1/teacher/assignments as the student',
    );
    expectForbidden(
      await call(page, 'POST', TEACHER_ASSIGNMENTS, {}),
      'POST /api/v1/teacher/assignments with an invalid body',
    );

    // --- Step 3: GET /api/v1/stats/teacher --------------------------------
    expectForbidden(
      await call(page, 'GET', TEACHER_STATS),
      'GET /api/v1/stats/teacher as the student',
    );

    // --- Adjacent: the reads behind the same route rule -------------------
    expectForbidden(
      await call(page, 'GET', TEACHER_QUIZZES),
      'GET /api/v1/teacher/quizzes as the student',
    );
    expectForbidden(
      await call(page, 'GET', TEACHER_ASSIGNMENTS),
      'GET /api/v1/teacher/assignments as the student',
    );

    // --- No over-block: the student's own surface still works -------------
    // Same session, same org cookie: the account type is the only discriminator.
    const studentStats = await page.request.get(STUDENT_STATS);
    expect(studentStats.status(), 'the student still reads their own stats').toBe(200);
    const studentStatsBody = (await studentStats.json()) as ApiBody<Record<string, unknown>>;
    expect(studentStatsBody.success).toBe(true);
    expect(studentStatsBody.data, 'student stats payload').toHaveProperty('totalQuizzes');

    await page.goto('/app');
    await expect(page).toHaveURL(/\/app(\/|$)/, { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- "brak utworzenia zasobów": the rejected writes left no rows ------
    // Checked before the educator control writes anything, so the organization
    // must be empty: the student's POSTs cannot have created a row anywhere.
    const quizzesAfterAttempts = await db
      .from('quizzes')
      .select('id, name, created_by, organization_id')
      .eq('organization_id', org.id);
    expect(quizzesAfterAttempts.error).toBeNull();
    expect(quizzesAfterAttempts.data, 'the student created no quiz').toEqual([]);

    const assignmentsAfterAttempts = await db
      .from('teacher_assignments')
      .select('id, title, created_by, organization_id')
      .eq('organization_id', org.id);
    expect(assignmentsAfterAttempts.error).toBeNull();
    expect(assignmentsAfterAttempts.data, 'the student created no assignment').toEqual([]);

    const studentQuizzes = await db.from('quizzes').select('id').eq('created_by', student.id);
    expect(studentQuizzes.error).toBeNull();
    expect(studentQuizzes.data, 'no quiz row is owned by the student').toEqual([]);

    const studentAssignments = await db
      .from('teacher_assignments')
      .select('id')
      .eq('created_by', student.id);
    expect(studentAssignments.error).toBeNull();
    expect(studentAssignments.data, 'no assignment row is owned by the student').toEqual([]);

    // --- Positive control: the tenant's educator is allowed the same calls -
    // Same endpoints, same active organization, same bodies: the server-side
    // boundary is the account type, and the routes themselves are healthy.
    await switchUser(page, tenant, 'teacher');

    const quizResponse = await page.request.post(TEACHER_QUIZZES, {
      data: { name: `${CONTROL_PREFIX} quiz ${run}` },
    });
    expect(
      quizResponse.status(),
      `POST /api/v1/teacher/quizzes as the educator → ${await quizResponse.text()}`,
    ).toBe(201);
    const quiz = ((await quizResponse.json()) as ApiBody<Quiz>).data!;
    expect(quiz).toMatchObject({
      name: `${CONTROL_PREFIX} quiz ${run}`,
      organization_id: org.id,
      created_by: teacher.id,
    });

    const assignmentResponse = await page.request.post(TEACHER_ASSIGNMENTS, {
      data: { title: `${CONTROL_PREFIX} assignment ${run}` },
    });
    expect(
      assignmentResponse.status(),
      `POST /api/v1/teacher/assignments as the educator → ${await assignmentResponse.text()}`,
    ).toBe(201);
    const assignment = ((await assignmentResponse.json()) as ApiBody<TeacherAssignment>).data!;
    expect(assignment).toMatchObject({
      title: `${CONTROL_PREFIX} assignment ${run}`,
      organization_id: org.id,
      created_by: teacher.id,
    });

    const teacherStats = await page.request.get(TEACHER_STATS);
    expect(teacherStats.status(), 'the educator reads the teacher stats').toBe(200);
    const teacherStatsBody = (await teacherStats.json()) as ApiBody<Record<string, unknown>>;
    expect(teacherStatsBody.success).toBe(true);
    expect(teacherStatsBody.data, 'teacher stats payload').toHaveProperty('totalQuestions');

    const teacherQuizzes = await page.request.get(TEACHER_QUIZZES);
    expect(teacherQuizzes.status(), 'the educator lists the teacher quizzes').toBe(200);
    expect(((await teacherQuizzes.json()) as ApiBody<Quiz[]>).data).toContainEqual(
      expect.objectContaining({ id: quiz.id, created_by: teacher.id }),
    );

    // --- The organization holds the educator's rows and nothing else ------
    const quizzesFinal = await db
      .from('quizzes')
      .select('id, name, created_by, organization_id')
      .eq('organization_id', org.id);
    expect(quizzesFinal.error).toBeNull();
    expect(quizzesFinal.data, 'exactly the control quiz exists in the organization').toEqual([
      { id: quiz.id, name: quiz.name, created_by: teacher.id, organization_id: org.id },
    ]);

    const assignmentsFinal = await db
      .from('teacher_assignments')
      .select('id, title, created_by, organization_id')
      .eq('organization_id', org.id);
    expect(assignmentsFinal.error).toBeNull();
    expect(assignmentsFinal.data, 'exactly the control assignment exists').toEqual([
      {
        id: assignment.id,
        title: assignment.title,
        created_by: teacher.id,
        organization_id: org.id,
      },
    ]);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
