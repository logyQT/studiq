import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { shortHash, tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
  type SeedDb,
} from '#test/helpers/tenant-seed';

/**
 * SEC-05 — a student cannot perform a teacher action through the API.
 *
 * Prerequisite (reconciled with the tenant seeder): the legacy manual account
 * `student1@dev.local` (password `pass`) is never used. The spec seeds its own
 * tenant on every run, under a fresh run suffix, through the shared e2e helpers
 * (`__tests__/helpers/tenant-seed.ts`), so no account, organization or
 * membership is shared with another case or another run:
 *
 * - org `qa-sec-05-<run>` with the first-run group `G1`, exactly like the
 *   manual seed's tenant (S1 is a student inside an organization, not a
 *   no-organization account) — so a 403 cannot be an artifact of the student
 *   having no tenant scope;
 * - `student` (`STUDENT`) — the case subject, org role `member`;
 * - `teacher` (`EDUCATOR`) — the positive control, org role `teacher`;
 * - `manager` (`MANAGER`) — org admin, keeps the graph realistic.
 *
 * Acceptance points from the case, all as the **student**, with its own
 * organization active (the cookie the app writes when an org is created or
 * switched):
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
 * Nothing global is written (no admin setting, feature flag, plan, platform stat
 * or singleton row) and no other case's tenant is touched.
 */

const CASE_FILE = 'qa/cases/SEC-05.md';
const TITLE = 'SEC-05 student cannot call teacher endpoints';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;
/** The tenant identity of this run; every id below is derived from it. */
const KEY = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;

/** The organization's default group; the seeder enrolls every member in it. */
const GROUP_NAME = 'G1';

const TEACHER_QUIZZES = '/api/v1/teacher/quizzes';
const TEACHER_ASSIGNMENTS = '/api/v1/teacher/assignments';
const TEACHER_STATS = '/api/v1/stats/teacher';
const STUDENT_STATS = '/api/v1/stats/student';

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface CaseTenant {
  run: string;
  key: string;
  org: { id: string; name: string };
  manager: SeedAccount;
  teacher: SeedAccount;
  student: SeedAccount;
}

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

/** Resolve the shared Supabase admin credentials (env → worker config → local defaults). */
function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url:
      process.env.QA_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      fromEnvJson ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

function accountEmail(role: string): string {
  return `qa+${shortHash(`${KEY}:${role}`)}+${role}@test.local`;
}

/**
 * One organization with an admin, a teacher and the student the case is about.
 * The student is a real org member (mirrors `student1` in the manual seed) and
 * is enrolled in the default group `G1`.
 */
async function seedCaseTenant(db: SeedDb): Promise<CaseTenant> {
  const org = { id: tenantId(KEY, 'org'), name: `qa-sec-05-${RUN_SUFFIX}` };
  const manager = buildAccount(KEY, 'manager', 'manager', {
    email: accountEmail('manager'),
    name: 'QA SEC-05 manager',
  });
  const teacher = buildAccount(KEY, 'teacher', 'educator', {
    email: accountEmail('teacher'),
    name: 'QA SEC-05 teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(KEY, 'student', 'student', {
    email: accountEmail('student'),
    name: 'QA SEC-05 student',
  });

  const seeded = await seedTenantGraph(db, {
    key: KEY,
    org,
    defaultGroup: { id: tenantId(KEY, 'group:default'), name: GROUP_NAME, isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [teacher, student],
    ownerOrgRole: 'admin',
  });

  return {
    run: RUN_SUFFIX,
    key: KEY,
    org,
    manager: seeded.owner,
    teacher: seeded.members[0]!,
    student: seeded.members[1]!,
  };
}

/**
 * Real login through the API, then boot the app with the tenant's organization
 * active and the locale the case's copy is written in. Logs any previous user
 * out first, so the run never inherits a session from the shared browser tile.
 */
async function signInAs(
  page: Page,
  baseURL: string,
  tenant: CaseTenant,
  role: 'teacher' | 'student',
): Promise<void> {
  const account = tenant[role];
  await page.request.post('/api/v1/auth/logout');

  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: tenant.org.id, domain: hostname, path: '/', httpOnly: true },
  ]);

  await page.goto('/login');
  await expect(page).toHaveURL(role === 'teacher' ? /\/edu(\/|$)/ : /\/app(\/|$)/, {
    timeout: 20_000,
  });
}

interface CallResult {
  status: number;
  errorCode: string | null;
  body: string;
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
  let tenant: CaseTenant;
  let db: SeedDb;

  test.beforeAll(async () => {
    db = createSeedDb(resolveSupabase());
    tenant = await seedCaseTenant(db);
    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(
      `SEC-05 tenant key: ${tenant.key} (org ${tenant.org.id} / ${tenant.org.name}, ` +
        `student ${tenant.student.email}, teacher ${tenant.teacher.email})`,
    );
  });

  test('every teacher endpoint answers 403 FORBIDDEN and creates nothing', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';
    const { org, teacher, student } = tenant;

    // --- Step 0: the case subject is a student with a real tenant scope ----
    // The organization is active, so a 403 below cannot be "authenticated but
    // scoped to no organization" — it has to be the route's account-type rule.
    await signInAs(page, origin, tenant, 'student');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

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
    await signInAs(page, origin, tenant, 'teacher');

    const quizResponse = await page.request.post(TEACHER_QUIZZES, {
      data: { name: `SEC-05 control quiz ${tenant.run}` },
    });
    expect(
      quizResponse.status(),
      `POST /api/v1/teacher/quizzes as the educator → ${await quizResponse.text()}`,
    ).toBe(201);
    const quiz = ((await quizResponse.json()) as ApiBody<Quiz>).data!;
    expect(quiz).toMatchObject({
      name: `SEC-05 control quiz ${tenant.run}`,
      organization_id: org.id,
      created_by: teacher.id,
    });

    const assignmentResponse = await page.request.post(TEACHER_ASSIGNMENTS, {
      data: { title: `SEC-05 control assignment ${tenant.run}` },
    });
    expect(
      assignmentResponse.status(),
      `POST /api/v1/teacher/assignments as the educator → ${await assignmentResponse.text()}`,
    ).toBe(201);
    const assignment = ((await assignmentResponse.json()) as ApiBody<TeacherAssignment>).data!;
    expect(assignment).toMatchObject({
      title: `SEC-05 control assignment ${tenant.run}`,
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
