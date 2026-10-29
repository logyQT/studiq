import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * AUT-19 — API without a session and with the wrong role.
 *
 * Prerequisite (reconciled with the tenant seeder): no session, then a student
 * session. The case's manual account (`student1`) is replaced by the case's own
 * isolated tenant, the same shape S1 had (a student inside an organization):
 *
 *   bun scripts/qa-tenant.ts AUT-19 --profile content --fresh
 *
 * The spec reads credentials from `qa/.tenants/AUT-19.json` (`users.student`,
 * `users.teacher`, password `Seed4Test!`) and never creates accounts itself. It
 * writes no global admin setting, feature flag, plan, platform row or singleton,
 * and reads only its own tenant's members — so the three tests below are
 * independent of every other worker.
 *
 * Acceptance criteria:
 * 1. signed out, `GET /api/v1/flashcards/decks` and `GET /api/v1/teacher/quizzes`
 *    answer `401` with the JSON envelope `{success:false, error:"UNAUTHORIZED"}`;
 * 2. as a student, `GET /api/v1/teacher/*` answers `403 FORBIDDEN`;
 * 3. as a student, `GET /api/v1/organization/members` returns either `403` or an
 *    empty list — no other user's member data may leak. The observed behaviour
 *    (walk on the shared app) is `403 FORBIDDEN`; the empty-list branch stays
 *    accepted because the case explicitly allows both, and whichever branch is
 *    taken is additionally checked for member data.
 *
 * Adjacent regressions on the same route-protection surface:
 * - a route that requires a session but is open to the student answers `200`
 *   once the student is signed in, so the `401`/`403` above are about the
 *   session/role and not a route that is broken for everyone;
 * - the same teacher and organization routes answer `200` for an authorized
 *   role in the same tenant, so the student's `403` is role-scoped rather than
 *   a blanket denial.
 *
 * The case quotes raw JSON, not UI copy, so no locale cookie is needed — these
 * are plain HTTP calls made through the browser context (`page.request`).
 */

const CASE = 'AUT-19';

const DECKS = '/api/v1/flashcards/decks';
const TEACHER_QUIZZES = '/api/v1/teacher/quizzes';
const MEMBERS = '/api/v1/organization/members';

interface ApiResult {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | null;
  errorCode: string | null;
}

/** One API call through the page's session, keeping the raw body for leak checks. */
async function call(page: Page, path: string): Promise<ApiResult> {
  const response: APIResponse = await page.request.get(path);
  const raw = await response.text();
  return {
    status: response.status(),
    body: JSON.parse(raw) as unknown,
    raw,
    contentType: response.headers()['content-type'] ?? null,
    errorCode: response.headers()['x-error-code'] ?? null,
  };
}

/** The documented error envelope: exactly the code, no `data` payload. */
function expectError(result: ApiResult, status: number, error: string): void {
  expect(result.status, `${error} status`).toBe(status);
  expect(result.contentType, 'error responses are JSON').toContain('application/json');
  expect(result.body, `${status} ${error} envelope`).toEqual({ success: false, error });
  expect(result.errorCode, 'x-error-code mirrors the body').toBe(error);
}

/** Session guard: the caller really is anonymous before the 401 assertions. */
async function expectAnonymous(page: Page): Promise<void> {
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as {
    data?: { user?: unknown };
  };
  expect(me.data?.user ?? null, `${CASE} prerequisite: no session`).toBeNull();
}

test.describe('AUT-19 — API route protection matrix', () => {
  test('signed out, the API routes answer 401 UNAUTHORIZED and no data', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.org, `${CASE} needs the tenant organization`).toBeTruthy();

    await expectAnonymous(page);

    // Case step 1 covers the first two endpoints; the third is the adjacent
    // organization route, rejected by the same session gate before any role
    // check can leak it.
    for (const endpoint of [DECKS, TEACHER_QUIZZES, MEMBERS]) {
      const result = await call(page, endpoint);
      expectError(result, 401, 'UNAUTHORIZED');
      // No member data and no success payload in an anonymous answer.
      expect(result.raw, `${endpoint} leaks no e-mail address`).not.toContain('@');
      expect(result.raw, `${endpoint} carries no data payload`).not.toContain('"data"');
    }
  });

  test('a student session is forbidden on /teacher/* and organization members', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const student = tenant.users.student;
    const teacher = tenant.users.teacher;
    const manager = tenant.users.manager;
    expect(student, `${CASE} tenant must seed a student`).toBeTruthy();
    expect(teacher, `${CASE} tenant must seed a teacher`).toBeTruthy();
    expect(manager, `${CASE} tenant must seed a manager`).toBeTruthy();

    await loginAs(page, tenant, 'student');

    // The session is the tenant's student, not a leftover from another case.
    const me = (await (await page.request.get('/api/v1/auth/me')).json()) as {
      data?: { user?: { email?: string } | null };
    };
    expect(me.data?.user?.email).toBe(student!.email);

    // --- Case step 2: teacher-only endpoint ------------------------------
    expectError(await call(page, TEACHER_QUIZZES), 403, 'FORBIDDEN');

    // --- Case step 2: organization members -------------------------------
    // The case allows 403 or an empty list; anything else is a defect.
    const members = await call(page, MEMBERS);
    expect([403, 200], `${MEMBERS} must be 403 or an empty list`).toContain(members.status);
    if (members.status === 403) {
      expectError(members, 403, 'FORBIDDEN');
    } else {
      expect(members.contentType, 'member list is JSON').toContain('application/json');
      expect(members.body).toEqual({ success: true, data: [] });
    }
    // No other user's member data may leak in either allowed shape.
    for (const account of [manager!, teacher!, student!]) {
      expect(members.raw, `${MEMBERS} leaks no member data`).not.toContain(account.email);
      expect(members.raw, `${MEMBERS} leaks no user id`).not.toContain(account.id);
    }
    expect(members.raw, `${MEMBERS} leaks no e-mail address`).not.toContain('@');

    // Adjacent: the student's own flashcards surface still works with this very
    // session — the 401/403 above are authorization, not a dead route.
    const decks = await call(page, DECKS);
    expect(decks.status, `${DECKS} for the tenant student`).toBe(200);
    expect(decks.body).toMatchObject({ success: true });
  });

  test('the same routes answer an authorized teacher in the same tenant', async ({ page }) => {
    const tenant = loadTenant(CASE);
    const student = tenant.users.student;
    expect(student, `${CASE} tenant must seed a student`).toBeTruthy();

    await loginAs(page, tenant, 'teacher');

    // Positive control: the teacher route is reachable for the role the case
    // denies the student, so the 403 above is role-scoped.
    const quizzes = await call(page, TEACHER_QUIZZES);
    expect(quizzes.status, `${TEACHER_QUIZZES} for an educator`).toBe(200);
    expect(quizzes.body).toMatchObject({ success: true, data: [] });

    // The organization member list is readable for an authorized staff account
    // and returns this tenant's own members.
    const members = await call(page, MEMBERS);
    expect(members.status, `${MEMBERS} for an educator`).toBe(200);
    const memberList = members.body as {
      success: boolean;
      data: Array<{ email?: string; organization_id?: string }>;
    };
    expect(memberList.success).toBe(true);
    expect(Array.isArray(memberList.data), 'member list payload').toBe(true);
    expect(
      memberList.data.map((member) => member.email),
      'the tenant student is part of the list the student was denied',
    ).toContain(student!.email);
    for (const member of memberList.data) {
      expect(member.organization_id, 'members are scoped to the tenant organization').toBe(
        tenant.org!.id,
      );
    }
  });
});
