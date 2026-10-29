import type { Browser, Page } from '@playwright/test';
import {
  expect,
  loadTenant,
  loginAs,
  test,
  type QaRole,
  type QaTenant,
} from '@qa/fixtures/qa-tenant';

/**
 * SEC-09 — a student and a teacher from another organization cannot read the
 * classroom's quiz, another student's attempt or the teacher's results.
 *
 * Case (verbatim → tenant model): the legacy prerequisite `student1`,
 * `student-classroom` and a published quiz in the „Classroom” organization
 * (`@dev.local`, password `pass`) is never used. The spec reads its own tenant,
 * seeded fresh for every independent run:
 *
 *   bun scripts/qa-tenant.ts SEC-09 --fresh
 *
 * `qa/tests/profiles/SEC-09.json` declares the `org-limit` profile: one
 * organization with a manager (admin), two educators with the `teacher` org role
 * and one member, plus `invitee1` / `invitee2` — two student accounts that are not
 * members of it. The case's four people are modelled inside that one tenant:
 *
 * - TC (quiz author) = `teacher2`, an `educator` with the `teacher` org role. It
 *   creates the classroom's **own organization** through the product API
 *   (`POST /api/v1/organization` — the flow an educator uses on onboarding) and
 *   becomes its admin. The profile cannot seed two organizations with an educator
 *   each, so the classroom org is built per run, named with the run suffix and
 *   owned by this tenant only.
 * - SC (classroom student) = `invitee1`, invited into the classroom org by TC and
 *   accepting the invitation (`POST /api/v1/organization/invites/accept`). SC is a
 *   `member` of the classroom org, the quiz is targeted at SC and SC owns the
 *   attempt.
 * - S1 (the case's `student1`, foreign student) = `invitee2`, a student with **no
 *   organization** — the closest the tenant profile offers to a student of another
 *   organization (same substitution as SEC-08).
 * - T1 (the case's `teacher1`, foreign teacher) = `teacher`, an `educator` with the
 *   `teacher` org role in the seeded organization and **not a member of the
 *   classroom org** — literally a teacher of another organization.
 *
 * The prerequisite is a published quiz (`teacher_assignments` row) with one question
 * targeted at SC, and SC's open attempt: bank → question → assignment → targets →
 * publish, then `POST /api/v1/assignments/:id/start`. Every step is idempotent, so a
 * tenant seeded once supports `--repeat-each` / `--retries`: the classroom org is
 * found by name, the invitation is skipped once SC is a member, the bank/question/
 * assignment are found by name, publishing is skipped when already published and
 * `start` returns the same open attempt.
 *
 * Acceptance points walked on the shared app (:3010, worker qa-env-8) on 2026-10-29:
 * 1. S1 `GET /api/v1/assignments/<quiz>` → **404 NOT_FOUND** (body
 *    `{"success":false,"error":"NOT_FOUND"}`, no `data`); the assignment list is
 *    empty for S1 and `/app/assignments/<quiz>` shows „Nie znaleziono kartkówki”.
 * 2. S1 `GET /api/v1/quiz/<SC attempt>` → **404 NOT_FOUND** — the attempt does not
 *    leak.
 * 3. T1 `GET /api/v1/teacher/assignments/<quiz>/results` → **404 NOT_FOUND**; the
 *    same refusal on the adjacent paths of the screen (assignment detail, per-student
 *    answers, answers export), an empty teacher list, and a results page that renders
 *    no student row or e-mail.
 *
 * Positive controls prove the routes are functional and the 404s are the ownership
 * boundary, not a broken endpoint: TC reads the assignment and its results (200,
 * with SC's attempt row), TC reads SC's answers and exports them (200), and SC reads
 * their own assignment and attempt (200) and sees the quiz in `/app`.
 *
 * All ids come from the tenant (`tenant.org` / `tenant.users` / `tenant.runSuffix`)
 * and names carry the run suffix, so two runs never collide. Nothing global is read
 * or written: no admin setting, feature flag, plan catalogue, platform stat or
 * singleton row, and no other case's tenant is touched.
 */

const CASE = 'SEC-09';

const ORGANIZATIONS_URL = '/api/v1/organization';
const ORGS_URL = '/api/v1/me/orgs';
const ORGS_SWITCH_URL = '/api/v1/me/orgs/switch';
const MEMBERS_URL = '/api/v1/organization/members';
const ROLES_URL = '/api/v1/organization/roles';
const INVITES_URL = '/api/v1/organization/invites/bulk';
const ACCEPT_URL = '/api/v1/organization/invites/accept';
const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const ASSIGNMENTS_URL = '/api/v1/teacher/assignments';
const STUDENT_ASSIGNMENTS_URL = '/api/v1/assignments';
const ATTEMPTS_URL = '/api/v1/quiz';
const ME_URL = '/api/v1/auth/me';

/** UI copy (pl) of the two pages the case's screens live on. */
const COPY = {
  studentNotFound: 'Nie znaleziono kartkówki',
  resultsTitle: 'Wyniki',
} as const;

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Organization {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

interface Member {
  id: string;
  email: string;
  orgRoleName: string;
}

interface OrgRole {
  id: string;
  name: string;
  isSystem: boolean;
}

interface Bank {
  id: string;
  name: string;
  organization_id: string | null;
}

interface Question {
  id: string;
  content: string;
}

interface AssignmentSummary {
  id: string;
  title: string;
  status: 'draft' | 'published';
  organization_id: string;
  created_by: string;
}

interface AssignmentDetail extends AssignmentSummary {
  assignment_questions: Array<{ question_id: string }>;
}

interface Attempt {
  id: string;
  user_id: string;
  assignment_id: string;
  completed_at: string | null;
}

interface ResultRow {
  id: string;
  user_id: string;
  user?: { id: string; email: string };
}

interface Me {
  user?: { id?: string; app_metadata?: { account_type?: string } };
}

interface CallResult {
  status: number;
  errorCode: string | null;
  body: string;
}

interface CaseFixture {
  tenant: QaTenant;
  run: string;
  classroomOrgId: string;
  assignment: AssignmentDetail;
  question: Question;
  attemptId: string;
}

function account(tenant: QaTenant, role: QaRole) {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user;
}

/**
 * A signed-in API session for one seeded account, pinned to the given organization
 * (or to no organization at all). The app only writes `active_org_id` when an org is
 * created or switched, so a seeded membership needs the cookie set here — otherwise
 * `withAuth` scopes the request to no org.
 */
async function apiSession(
  browser: Browser,
  baseURL: string,
  tenant: QaTenant,
  role: QaRole,
  orgId: string | null,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const user = account(tenant, role);
  const { hostname } = new URL(baseURL);
  const context = await browser.newContext({ baseURL });
  const cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
  }> = [{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }];
  if (orgId) {
    cookies.push({
      name: 'active_org_id',
      value: orgId,
      domain: hostname,
      path: '/',
      httpOnly: true,
    });
  }
  await context.addCookies(cookies);
  const page = await context.newPage();
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  expect(response.status(), `login ${role} (${user.email})`).toBe(200);
  return { page, close: () => context.close() };
}

async function call(
  page: Page,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  data?: unknown,
): Promise<CallResult> {
  const response =
    method === 'GET'
      ? await page.request.get(url)
      : method === 'PUT'
        ? await page.request.put(url, { data: data ?? {} })
        : await page.request.post(url, { data: data ?? {} });
  return {
    status: response.status(),
    errorCode: response.headers()['x-error-code'] ?? null,
    body: await response.text(),
  };
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(200);
  const body = (await response.json()) as Envelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data as T;
}

/**
 * The case accepts 403 or 404 for a rejected foreign read. The error code must agree
 * with the status, and the envelope carries no payload — a refused operation must not
 * leak the resource.
 */
function expectRejected(result: CallResult, label: string): void {
  expect([403, 404], `${label}: rejected with 403/404 → ${result.status} ${result.body}`).toContain(
    result.status,
  );
  const expected = result.status === 403 ? 'FORBIDDEN' : 'NOT_FOUND';
  expect(result.errorCode, `${label}: x-error-code header`).toBe(expected);
  expect(JSON.parse(result.body), `${label}: response envelope`).toEqual({
    success: false,
    error: expected,
  });
}

/** `app_metadata.account_type` the seeder gives each tenant role. */
const ACCOUNT_TYPE: Partial<Record<QaRole, string>> = {
  manager: 'manager',
  teacher: 'educator',
  teacher2: 'educator',
  student: 'student',
  invitee1: 'student',
  invitee2: 'student',
};

async function expectSignedInAs(page: Page, tenant: QaTenant, role: QaRole): Promise<void> {
  const user = account(tenant, role);
  const me = (await (await page.request.get(ME_URL)).json()) as Envelope<Me>;
  expect(me.data?.user?.id, `the signed-in user is the tenant's ${role}`).toBe(user.id);
  expect(me.data?.user?.app_metadata?.account_type, `the ${role} account type`).toBe(
    ACCOUNT_TYPE[role],
  );
}

/**
 * The classroom organization of this run, created (or reused) by the classroom
 * teacher. The session ends on that org — `POST /api/v1/organization` already sets
 * the cookie, the explicit switch covers the reuse path on a retry.
 */
async function ensureClassroomOrg(page: Page, name: string, tenantOrgId: string): Promise<string> {
  const orgs = await getData<Organization[]>(page, ORGS_URL);
  const existing = orgs.find((org) => org.name === name);
  let orgId: string;

  if (existing) {
    orgId = existing.id;
  } else {
    const created = await call(page, 'POST', ORGANIZATIONS_URL, { name });
    expect(created.status, `POST ${ORGANIZATIONS_URL} → ${created.body}`).toBe(201);
    const body = JSON.parse(created.body) as Envelope<{ id: string }>;
    expect(body.success, 'the classroom organization was created').toBe(true);
    orgId = body.data!.id;
  }

  expect(orgId, 'the classroom is a different organization than the seeded one').not.toBe(
    tenantOrgId,
  );
  const switched = await call(page, 'POST', ORGS_SWITCH_URL, { orgId });
  expect(switched.status, `POST ${ORGS_SWITCH_URL} → ${switched.body}`).toBe(200);

  const refreshed = await getData<Organization[]>(page, ORGS_URL);
  expect(
    refreshed.find((org) => org.id === orgId),
    'the classroom organization is the active organization',
  ).toMatchObject({ id: orgId, name, isActive: true });
  return orgId;
}

/**
 * The classroom student joins the classroom organization through the real invitation
 * flow. The seeded invitation row is single-use, so the membership check first: a
 * retry on the same tenant skips the invitation it already consumed.
 */
async function ensureClassroomStudent(
  browser: Browser,
  baseURL: string,
  tenant: QaTenant,
  classroomOrgId: string,
  classroomTeacherPage: Page,
): Promise<void> {
  const student = account(tenant, 'invitee1');
  const members = await getData<Member[]>(classroomTeacherPage, MEMBERS_URL);
  if (members.some((member) => member.id === student.id)) return;

  const roles = await getData<OrgRole[]>(classroomTeacherPage, ROLES_URL);
  const memberRole = roles.find((role) => role.name === 'member' && role.isSystem);
  expect(memberRole, 'the classroom organization has its system member role').toBeTruthy();

  const invite = await call(classroomTeacherPage, 'POST', INVITES_URL, {
    invitations: [{ email: student.email, targetOrgRoleId: memberRole!.id }],
  });
  expect(invite.status, `classroom teacher invites the student → ${invite.body}`).toBe(200);
  const inviteBody = JSON.parse(invite.body) as Envelope<{
    results: Array<{ data: { inviteCode: string } }>;
  }>;
  const code = inviteBody.data?.results[0]?.data.inviteCode;
  expect(code, 'the invitation carries its 32-hex code').toMatch(/^[0-9a-f]{32}$/);

  const invitee = await apiSession(browser, baseURL, tenant, 'invitee1', null);
  try {
    const accept = await invitee.page.request.post(ACCEPT_URL, { data: { token: code } });
    expect(
      accept.status(),
      `classroom student accepts the invitation → ${await accept.text()}`,
    ).toBe(200);
    const orgs = await getData<Organization[]>(invitee.page, ORGS_URL);
    expect(
      orgs.find((org) => org.id === classroomOrgId),
      'the classroom student is a member of the classroom organization',
    ).toMatchObject({ id: classroomOrgId, orgRoleName: 'member' });
  } finally {
    await invitee.close();
  }
}

/** The tenant's bank for this case, reused when a retry already created it. */
async function ensureBank(page: Page, name: string): Promise<string> {
  const banks = await getData<{ items: Bank[] }>(page, `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === name);
  if (existing) return existing.id;

  const created = await call(page, 'POST', BANKS_URL, { name, description: 'SEC-09 kartkówka' });
  expect(created.status, `POST ${BANKS_URL} → ${created.body}`).toBe(201);
  return (JSON.parse(created.body) as Envelope<Bank>).data!.id;
}

/** One multiple-choice question in the case's bank, reused on a retry. */
async function ensureQuestion(page: Page, bankId: string, content: string): Promise<Question> {
  const questions = await getData<Question[]>(page, `${QUESTIONS_URL}?bankId=${bankId}`);
  const existing = questions.find((question) => question.content === content);
  if (existing) return existing;

  const created = await call(page, 'POST', QUESTIONS_URL, {
    bankId,
    type: 'mcq',
    content,
    answers: [
      { content: 'Odpowiedź A', isCorrect: true, orderIndex: 0 },
      { content: 'Odpowiedź B', isCorrect: false, orderIndex: 1 },
    ],
  });
  expect(created.status, `POST ${QUESTIONS_URL} → ${created.body}`).toBe(201);
  return (JSON.parse(created.body) as Envelope<Question>).data!;
}

/**
 * The case's prerequisite: a published quiz targeted at the classroom student.
 * Idempotent — a retry reuses the assignment, its question and its target, and only
 * publishes when an earlier run left it in draft.
 */
async function ensurePublishedQuiz(
  page: Page,
  params: { bankName: string; questionContent: string; title: string; studentId: string },
): Promise<{ assignment: AssignmentDetail; question: Question }> {
  const bankId = await ensureBank(page, params.bankName);
  const question = await ensureQuestion(page, bankId, params.questionContent);

  const assignments = await getData<AssignmentSummary[]>(page, ASSIGNMENTS_URL);
  let assignment = assignments.find((candidate) => candidate.title === params.title);
  if (!assignment) {
    const created = await call(page, 'POST', ASSIGNMENTS_URL, { title: params.title });
    expect(created.status, `POST ${ASSIGNMENTS_URL} → ${created.body}`).toBe(201);
    assignment = (JSON.parse(created.body) as Envelope<AssignmentSummary>).data!;
  }

  const detail = await getData<AssignmentDetail>(page, `${ASSIGNMENTS_URL}/${assignment.id}`);
  if (!detail.assignment_questions.some((row) => row.question_id === question.id)) {
    const added = await call(page, 'POST', `${ASSIGNMENTS_URL}/${assignment.id}/questions`, {
      questionIds: [question.id],
    });
    expect(added.status, `POST ${ASSIGNMENTS_URL}/<id>/questions → ${added.body}`).toBe(200);
  }

  const targets = await call(page, 'PUT', `${ASSIGNMENTS_URL}/${assignment.id}/targets`, {
    studentIds: [params.studentId],
  });
  expect(targets.status, `PUT ${ASSIGNMENTS_URL}/<id>/targets → ${targets.body}`).toBe(200);

  if (assignment.status !== 'published') {
    const published = await call(page, 'POST', `${ASSIGNMENTS_URL}/${assignment.id}/publish`, {});
    expect(published.status, `POST ${ASSIGNMENTS_URL}/<id>/publish → ${published.body}`).toBe(200);
  }

  const published = await getData<AssignmentDetail>(page, `${ASSIGNMENTS_URL}/${assignment.id}`);
  expect(published.status, 'the prerequisite quiz is published').toBe('published');
  expect(
    published.assignment_questions.some((row) => row.question_id === question.id),
    'the quiz holds its question',
  ).toBe(true);
  return { assignment: published, question };
}

/**
 * Prepare the case inside its own tenant, idempotently:
 * 1. the classroom teacher creates (or reuses) the classroom organization;
 * 2. the classroom student joins it through the invitation flow;
 * 3. the teacher builds the bank, question and published quiz targeted at the student;
 * 4. the student starts the attempt the case reads back (`GET /api/v1/quiz/:attemptId`).
 */
async function prepareTenant(browser: Browser, baseURL: string): Promise<CaseFixture> {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');
  if (
    !tenant.org ||
    !tenant.users.teacher ||
    !tenant.users.teacher2 ||
    !tenant.users.invitee1 ||
    !tenant.users.invitee2
  ) {
    throw new Error(`${CASE} tenant is missing its organization, educators or invitee accounts`);
  }
  const seededOrg = tenant.org;
  const classroomTeacher = account(tenant, 'teacher2');
  const classroomStudent = account(tenant, 'invitee1');
  const run = tenant.runSuffix ?? tenant.key.slice(-8);
  const classroomOrgName = `SEC-09 Classroom ${run}`;

  const teacher = await apiSession(browser, baseURL, tenant, 'teacher2', seededOrg.id);
  let classroomOrgId: string;
  let assignment: AssignmentDetail;
  let question: Question;
  try {
    classroomOrgId = await ensureClassroomOrg(teacher.page, classroomOrgName, seededOrg.id);
    await ensureClassroomStudent(browser, baseURL, tenant, classroomOrgId, teacher.page);

    const prepared = await ensurePublishedQuiz(teacher.page, {
      bankName: `SEC-09 ${run} bank`,
      questionContent: `SEC-09 ${run} pytanie`,
      title: `SEC-09 ${run} kartkówka`,
      studentId: classroomStudent.id,
    });
    assignment = prepared.assignment;
    question = prepared.question;

    expect(assignment.created_by, 'the classroom teacher authored the quiz').toBe(
      classroomTeacher.id,
    );
    expect(assignment.organization_id, 'the quiz belongs to the classroom organization').toBe(
      classroomOrgId,
    );
  } finally {
    await teacher.close();
  }

  const learner = await apiSession(browser, baseURL, tenant, 'invitee1', classroomOrgId);
  let attemptId: string;
  try {
    const started = await call(
      learner.page,
      'POST',
      `${STUDENT_ASSIGNMENTS_URL}/${assignment.id}/start`,
      {},
    );
    expect(started.status, `POST ${STUDENT_ASSIGNMENTS_URL}/<id>/start → ${started.body}`).toBe(
      200,
    );
    const attempt = (JSON.parse(started.body) as Envelope<Attempt>).data!;
    expect(attempt.user_id, 'the attempt belongs to the classroom student').toBe(
      classroomStudent.id,
    );
    expect(attempt.assignment_id, 'the attempt is on the classroom quiz').toBe(assignment.id);
    attemptId = attempt.id;
  } finally {
    await learner.close();
  }

  console.log(`${CASE} tenant key: ${tenant.key}`);
  console.log(`${CASE} classroom org: ${classroomOrgId} (${classroomOrgName})`);
  console.log(`${CASE} quiz: ${assignment.id} ${assignment.title} / attempt: ${attemptId}`);

  return { tenant, run, classroomOrgId, assignment, question, attemptId };
}

/** A fresh session for one tenant user; cookies are cleared so roles never overlap. */
async function switchUser(
  page: Page,
  tenant: QaTenant,
  role: QaRole,
  options: { activeOrgId?: string | null; waitFor: RegExp },
): Promise<void> {
  await page.context().clearCookies();
  await loginAs(page, tenant, role, { locale: 'pl', ...options });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
}

test.describe('@case:SEC-09 @area:SEC @prio:P1 foreign quiz, attempt and results are refused', () => {
  let fixture: CaseFixture;

  test.beforeAll(async ({ browser, baseURL }) => {
    fixture = await prepareTenant(browser, baseURL ?? 'http://localhost:3010');
  });

  test('a foreign student and a foreign teacher cannot read the classroom quiz, attempt or results', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const { tenant, classroomOrgId, assignment, question, attemptId } = fixture;
    const seededOrg = tenant.org!;
    const classroomTeacher = account(tenant, 'teacher2');
    const classroomStudent = account(tenant, 'invitee1');
    const foreignTeacher = account(tenant, 'teacher');
    const foreignStudent = account(tenant, 'invitee2');
    const quizUrl = `${ASSIGNMENTS_URL}/${assignment.id}`;

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Step 0: the classroom teacher owns the quiz and its results --------
    await switchUser(page, tenant, 'teacher2', {
      activeOrgId: classroomOrgId,
      waitFor: /\/edu(\/|$)/,
    });
    await expectSignedInAs(page, tenant, 'teacher2');
    expect(
      (await getData<Organization[]>(page, ORGS_URL)).find((org) => org.id === classroomOrgId),
      'the classroom teacher is active in the classroom organization',
    ).toMatchObject({ id: classroomOrgId, orgRoleName: 'admin' });

    const ownDetail = await getData<AssignmentDetail>(page, quizUrl);
    expect(ownDetail, 'the classroom teacher reads their own quiz').toMatchObject({
      id: assignment.id,
      status: 'published',
      created_by: classroomTeacher.id,
      organization_id: classroomOrgId,
    });

    const ownResults = await getData<ResultRow[]>(page, `${quizUrl}/results`);
    expect(
      ownResults.find((row) => row.id === attemptId),
      'the classroom teacher sees the classroom student’s attempt',
    ).toMatchObject({ id: attemptId, user_id: classroomStudent.id });
    expect(
      ownResults.find((row) => row.id === attemptId)?.user?.email,
      'the result row carries the classroom student’s e-mail',
    ).toBe(classroomStudent.email);

    await page.goto(`/edu/assignments/${assignment.id}/results`);
    await expect(page.locator('h1')).toHaveText(COPY.resultsTitle);
    await expect(
      page.getByRole('cell', { name: classroomStudent.email }),
      'the results page lists the classroom student',
    ).toBeVisible();

    // --- Step 1: a foreign student cannot read the classroom quiz -----------
    await switchUser(page, tenant, 'invitee2', { activeOrgId: null, waitFor: /\/app(\/|$)/ });
    await expectSignedInAs(page, tenant, 'invitee2');
    expect(
      foreignStudent.id,
      'the foreign student is a different account than the classroom student',
    ).not.toBe(classroomStudent.id);
    expect(
      await getData<Organization[]>(page, ORGS_URL),
      'the foreign student belongs to no organization',
    ).toEqual([]);

    expectRejected(
      await call(page, 'GET', `${STUDENT_ASSIGNMENTS_URL}/${assignment.id}`),
      'S1 GET /assignments/<classroom quiz>',
    );
    expect(
      (await getData<AssignmentSummary[]>(page, STUDENT_ASSIGNMENTS_URL)).find(
        (row) => row.id === assignment.id,
      ),
      'the classroom quiz is absent from the foreign student’s list',
    ).toBeUndefined();

    await page.goto(`/app/assignments/${assignment.id}`);
    await expect(
      page.getByText(COPY.studentNotFound, { exact: true }),
      'the foreign student sees the not-found state',
    ).toBeVisible();
    await expect(
      page.getByText(assignment.title, { exact: true }),
      'the foreign student’s page never shows the quiz title',
    ).toHaveCount(0);
    await expect(
      page.getByText(question.content, { exact: true }),
      'the foreign student’s page never shows the quiz question',
    ).toHaveCount(0);

    // --- Step 2: a foreign student cannot read the classroom attempt --------
    expectRejected(
      await call(page, 'GET', `${ATTEMPTS_URL}/${attemptId}`),
      'S1 GET /quiz/<SC attempt>',
    );

    // --- Step 3: a teacher of another organization cannot read the results --
    await switchUser(page, tenant, 'teacher', {
      activeOrgId: seededOrg.id,
      waitFor: /\/edu(\/|$)/,
    });
    await expectSignedInAs(page, tenant, 'teacher');
    expect(assignment.created_by, 'the quiz was not authored by the foreign teacher').not.toBe(
      foreignTeacher.id,
    );
    const foreignOrgs = await getData<Organization[]>(page, ORGS_URL);
    expect(
      foreignOrgs.find((org) => org.id === seededOrg.id),
      'the foreign teacher is active in their own organization',
    ).toMatchObject({ id: seededOrg.id, isActive: true });
    expect(
      foreignOrgs.find((org) => org.id === classroomOrgId),
      'the foreign teacher is not a member of the classroom organization',
    ).toBeUndefined();

    expectRejected(
      await call(page, 'GET', `${quizUrl}/results`),
      'T1 GET /teacher/assignments/<quiz>/results',
    );
    // Adjacent paths of the same screen: the assignment detail, one student’s answers
    // and the answers export.
    expectRejected(await call(page, 'GET', quizUrl), 'T1 GET /teacher/assignments/<quiz>');
    expectRejected(
      await call(page, 'GET', `${quizUrl}/results/${classroomStudent.id}`),
      'T1 GET /teacher/assignments/<quiz>/results/<SC>',
    );
    expectRejected(
      await call(page, 'GET', `${quizUrl}/export-answers`),
      'T1 GET /teacher/assignments/<quiz>/export-answers',
    );
    expect(
      (await getData<AssignmentSummary[]>(page, ASSIGNMENTS_URL)).find(
        (row) => row.id === assignment.id,
      ),
      'the classroom quiz is absent from the foreign teacher’s list',
    ).toBeUndefined();

    await page.goto(`/edu/assignments/${assignment.id}/results`);
    await expect(
      page.getByText(classroomStudent.email, { exact: true }),
      'the foreign teacher’s results page never lists the classroom student',
    ).toHaveCount(0);
    await expect(
      page.getByText(assignment.title, { exact: true }),
      'the foreign teacher’s results page never shows the quiz title',
    ).toHaveCount(0);

    // --- The classroom student still reads their own quiz and attempt -------
    await switchUser(page, tenant, 'invitee1', {
      activeOrgId: classroomOrgId,
      waitFor: /\/app(\/|$)/,
    });
    await expectSignedInAs(page, tenant, 'invitee1');
    expect(
      (await getData<Organization[]>(page, ORGS_URL)).find((org) => org.id === classroomOrgId),
      'the classroom student is a member of the classroom organization',
    ).toMatchObject({ id: classroomOrgId, orgRoleName: 'member' });

    const ownAssignment = await getData<AssignmentDetail>(
      page,
      `${STUDENT_ASSIGNMENTS_URL}/${assignment.id}`,
    );
    expect(ownAssignment, 'the classroom student reads the targeted quiz').toMatchObject({
      id: assignment.id,
      title: assignment.title,
      status: 'published',
    });

    const ownAttempt = await getData<Attempt>(page, `${ATTEMPTS_URL}/${attemptId}`);
    expect(ownAttempt, 'the classroom student reads their own attempt').toMatchObject({
      id: attemptId,
      user_id: classroomStudent.id,
      assignment_id: assignment.id,
      completed_at: null,
    });

    await page.goto(`/app/assignments/${assignment.id}`);
    await expect(
      page.getByRole('heading', { name: assignment.title, exact: true }),
      'the classroom student’s page renders the quiz',
    ).toBeVisible();
    await expect(
      page.getByText(COPY.studentNotFound, { exact: true }),
      'the classroom student never sees the not-found state',
    ).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
