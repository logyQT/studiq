import { expect, test, type Browser, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-REP-01 — reports in the organization (`/manage/reports`).
 *
 * Prerequisite (reconciled with the tenant seeder): the organization has reports,
 * raised by its own student against a teacher's question and against a group. That
 * replaces the legacy manual seed (`manager@dev.local`, „WSB Merito”, password
 * `pass`), which this suite never uses.
 *
 * Tenant: `__tests__/qa/profiles/MGR-REP-01.json` — the `two-org` profile plus the
 * case's org-less educator (`solo.teacherB`), seeded **once, before Playwright
 * starts**, by
 *
 *   bun scripts/qa-tenant.ts MGR-REP-01 --fresh
 *
 * so the spec only reads `loadTenant('MGR-REP-01')` and never creates an account,
 * an organization or a group (the control org's second participant is the seeded
 * org-less account, added through the product's invite flow described below):
 *
 * - org A (under test): the manager (org `admin`, creator of the default group
 *   `O1G1-<run>`), `teacherA` (org role `teacher`) and `studentA` (member of the
 *   group). The teacher owns a bank with one question; the student reports that
 *   question and reports the group.
 * - org B (control): the same manager as `admin` (the profile's shared owner) and
 *   `studentB`. The profile's org-less `teacherB` joins it through the product's
 *   own invite → accept flow (`POST /api/v1/organization/invites` +
 *   `/organization/invites/accept` — the writes `/manage/invites` performs) and
 *   owns the reported question, so the foreign report is between `studentB` and
 *   `teacherB` and org A's manager sits at neither end of it.
 *
 * That split is what the case needs: the question report under test is not a
 * manager thread either (reporter = `studentA`, recipient = `teacherA`), so seeing
 * it proves the case's „manager widzi zgłoszenia z całej organizacji” instead of
 * the participant view. The group report's recipient is the manager, because the
 * manager created the default group.
 *
 * Everything else is content built through the product's API inside the test —
 * banks, questions and the reports themselves — and recreated per execution, so a
 * CI retry (`--retries`) or a repeated run (`--repeat-each`) on the same seeded
 * tenant starts from the same two reports and a fresh thread. Nothing global is
 * written: no admin setting, feature flag, plan, platform stat, singleton row or
 * another case's tenant.
 */

const CASE = 'MGR-REP-01';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const REPORTS_URL = '/api/v1/question-reports';
const MEMBERS_URL = '/api/v1/organization/members';
const ROLES_URL = '/api/v1/organization/roles';
const INVITES_URL = '/api/v1/organization/invites';

/** Polish copy from `ManageReportsClient` and `QuestionReports` (pl.json). */
const COPY = {
  title: 'Zgłoszenia',
  description: 'Zgłoszenia dotyczące pytań i grup w Twojej organizacji.',
  open: 'Otwarte',
  replyPlaceholder: 'Napisz odpowiedź...',
  sendReply: 'Wyślij odpowiedź',
} as const;

interface TenantUser {
  id: string;
  email: string;
  password: string;
}

interface TenantOrg {
  id: string;
  name: string;
  groups: string[];
  student: TenantUser & { name: string };
}

/** Shape `scripts/qa-tenant.ts` writes for the `two-org` profile (see SEC-02/MGR-03). */
interface TwoOrgTenant extends QaTenant {
  manager: TenantUser & { name: string };
  orgA: TenantOrg;
  orgB: TenantOrg;
  users: NonNullable<QaTenant['users']> & {
    manager: TenantUser;
    studentA: TenantUser;
    teacherA: TenantUser;
    studentB: TenantUser;
    teacherB: TenantUser;
  };
}

const TENANT = loadTenant(CASE) as TwoOrgTenant;

/**
 * Run suffix the seeder folded into the tenant key. Every piece of content below is
 * keyed by it, so a retry reuses the rows its tenant already has instead of
 * duplicating them.
 */
const RUN = TENANT.runSuffix ?? 'stable';

const BANK_NAME = `QA MGR-REP-01 bank ${RUN}`;
const QUESTION_CONTENT = `QA MGR-REP-01 question ${RUN}`;
const QUESTION_REPORT_MESSAGE = `QA MGR-REP-01 question report ${RUN}`;
const GROUP_REPORT_MESSAGE = `QA MGR-REP-01 group report ${RUN}`;
const REPLY_MESSAGE = `QA MGR-REP-01 manager reply ${RUN}`;
const FOREIGN_BANK_NAME = `QA MGR-REP-01 foreign bank ${RUN}`;
const FOREIGN_QUESTION_CONTENT = `QA MGR-REP-01 foreign question ${RUN}`;
const FOREIGN_REPORT_MESSAGE = `QA MGR-REP-01 foreign report ${RUN}`;

interface CaseTenant {
  key: string;
  /** Organization under test. */
  org: { id: string; name: string };
  group: { id: string; name: string };
  manager: TenantUser & { name: string };
  teacher: TenantUser;
  student: TenantUser & { name: string };
  question: { id: string; content: string };
  /** Student → teacher question report; the manager is not a participant. */
  questionReportId: string;
  /** Student → manager group report; labelled „Grupa: <nazwa>”. */
  groupReportId: string;
  /** Org B report that must never be listed for org A's manager. */
  otherReportId: string;
}

interface MemberRow {
  id: string;
  email: string;
  orgRoleName: string;
}

interface RoleRow {
  id: string;
  name: string;
}

interface BankRow {
  id: string;
  name: string;
}

interface QuestionRow {
  id: string;
  content: string;
}

interface ReportRow {
  id: string;
  question: { id: string; content: string } | null;
  group: { id: string; name: string } | null;
}

async function apiData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${url} success`).toBe(true);
  return body.data;
}

/**
 * A signed-in API session for one seeded account, pinned to its organization. The
 * app only writes `active_org_id` when an org is created or switched, so a seeded
 * membership needs the cookie `loginAs` sets — otherwise `withAuth` scopes the
 * request to no org and the report/bank creation lands outside the tenant.
 */
async function openSession(
  browser: Browser,
  baseURL: string,
  role: QaRole,
  orgId: string | null,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAs(page, TENANT, role, {
    locale: 'pl',
    activeOrgId: orgId,
    waitFor: /\/(edu|app|manage)$/,
  });
  return { page, close: () => context.close() };
}

/** The bank that holds the question under test; one per tenant, keyed by name. */
async function ensureBank(page: Page, name: string): Promise<string> {
  const banks = await apiData<{ items: BankRow[] }>(page, `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === name);
  if (existing) return existing.id;

  const created = await page.request.post(BANKS_URL, { data: { name } });
  expect(created.status(), `POST ${BANKS_URL} (${name})`).toBe(201);
  return ((await created.json()) as { data: { id: string } }).data.id;
}

/**
 * Rebuild the question for this execution. Its reports (and their messages) cascade
 * with it (`question_reports.question_id ON DELETE CASCADE`), so a repeated run on
 * the same seeded tenant keeps exactly one report per thread and a fresh reply
 * history instead of accumulating both.
 */
async function recreateQuestion(page: Page, bankId: string, content: string): Promise<string> {
  const questions = await apiData<QuestionRow[]>(page, `${QUESTIONS_URL}?bankId=${bankId}`);
  for (const stale of questions.filter((question) => question.content === content)) {
    const removed = await page.request.delete(`${QUESTIONS_URL}/${stale.id}`);
    expect(removed.status(), `DELETE ${QUESTIONS_URL}/${stale.id}`).toBe(200);
  }

  const created = await page.request.post(QUESTIONS_URL, {
    data: { bankId, type: 'open', content, answers: [] },
  });
  expect(created.status(), `POST ${QUESTIONS_URL}`).toBe(201);
  return ((await created.json()) as { data: { id: string } }).data.id;
}

/** File a report on a question or a group — the same endpoint the UI dialog calls. */
async function createReport(page: Page, path: string, message: string): Promise<string> {
  const response = await page.request.post(path, { data: { message } });
  expect(response.status(), `POST ${path}`).toBe(201);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

/**
 * The group report is filed once per tenant: the group thread is never replied to,
 * so reusing it keeps org A at exactly the case's two reports on every repetition.
 */
async function ensureGroupReport(page: Page, groupId: string, groupPath: string): Promise<string> {
  const list = await apiData<{ items: ReportRow[] }>(page, `${REPORTS_URL}?limit=100`);
  const existing = list.items.find((report) => report.group?.id === groupId);
  if (existing) return existing.id;
  return createReport(page, groupPath, GROUP_REPORT_MESSAGE);
}

/**
 * Give the control organization its second, non-manager participant. The account is
 * part of the seeded shape (`solo.teacherB`); the membership is the product's own
 * invite → accept flow, the same writes `/manage/invites` performs, and is a no-op
 * once the member is there (CI retries / repeated runs).
 */
async function ensureControlOrgTeacher(browser: Browser, baseURL: string): Promise<void> {
  const inviteeEmail = TENANT.users.teacherB.email;

  const manager = await openSession(browser, baseURL, 'manager', TENANT.orgB.id);
  let inviteCode: string | null = null;
  try {
    const members = await apiData<MemberRow[]>(manager.page, MEMBERS_URL);
    if (!members.some((member) => member.email === inviteeEmail)) {
      const roles = await apiData<RoleRow[]>(manager.page, ROLES_URL);
      const teacherRole = roles.find((role) => role.name === 'teacher');
      if (!teacherRole) throw new Error(`tenant ${CASE}: org B has no "teacher" role`);

      const invite = await manager.page.request.post(INVITES_URL, {
        data: { email: inviteeEmail, targetOrgRoleId: teacherRole.id, locale: 'pl' },
      });
      expect(
        invite.status(),
        `POST ${INVITES_URL} (${inviteeEmail}) → ${invite.status()} ${await invite.text()}`,
      ).toBe(201);
      inviteCode = ((await invite.json()) as { data: { inviteCode: string } }).data.inviteCode;
    }
  } finally {
    await manager.close();
  }

  if (!inviteCode) return;

  const invitee = await openSession(browser, baseURL, 'teacherB', null);
  try {
    const accepted = await invitee.page.request.post(`${INVITES_URL}/accept`, {
      data: { token: inviteCode },
    });
    expect(
      accepted.status(),
      `POST ${INVITES_URL}/accept → ${accepted.status()} ${await accepted.text()}`,
    ).toBe(200);
  } finally {
    await invitee.close();
  }
}

/** The case's content, built through the product's API on the seeded tenant. */
async function prepareTenant(browser: Browser, baseURL: string): Promise<CaseTenant> {
  const group = TENANT.group;
  if (!group) throw new Error(`tenant ${CASE} has no default group`);

  await ensureControlOrgTeacher(browser, baseURL);

  // Org A: the teacher owns the reported question, the student files both reports.
  const teacherSession = await openSession(browser, baseURL, 'teacherA', TENANT.orgA.id);
  let question: { id: string; content: string };
  try {
    const bankId = await ensureBank(teacherSession.page, BANK_NAME);
    question = {
      id: await recreateQuestion(teacherSession.page, bankId, QUESTION_CONTENT),
      content: QUESTION_CONTENT,
    };
  } finally {
    await teacherSession.close();
  }

  const studentSession = await openSession(browser, baseURL, 'studentA', TENANT.orgA.id);
  let questionReportId: string;
  let groupReportId: string;
  try {
    questionReportId = await createReport(
      studentSession.page,
      `/api/v1/questions/${question.id}/reports`,
      QUESTION_REPORT_MESSAGE,
    );
    groupReportId = await ensureGroupReport(
      studentSession.page,
      group.id,
      `/api/v1/organization/groups/${group.id}/reports`,
    );
  } finally {
    await studentSession.close();
  }

  // Org B (control): its own teacher/student thread, never the org A manager.
  const otherTeacherSession = await openSession(browser, baseURL, 'teacherB', TENANT.orgB.id);
  let otherQuestionId: string;
  try {
    const bankId = await ensureBank(otherTeacherSession.page, FOREIGN_BANK_NAME);
    otherQuestionId = await recreateQuestion(
      otherTeacherSession.page,
      bankId,
      FOREIGN_QUESTION_CONTENT,
    );
  } finally {
    await otherTeacherSession.close();
  }

  const otherStudentSession = await openSession(browser, baseURL, 'studentB', TENANT.orgB.id);
  let otherReportId: string;
  try {
    otherReportId = await createReport(
      otherStudentSession.page,
      `/api/v1/questions/${otherQuestionId}/reports`,
      FOREIGN_REPORT_MESSAGE,
    );
  } finally {
    await otherStudentSession.close();
  }

  return {
    key: TENANT.key,
    org: { id: TENANT.orgA.id, name: TENANT.orgA.name },
    group: { id: group.id, name: group.name },
    manager: { ...TENANT.users.manager, name: TENANT.manager.name },
    teacher: TENANT.users.teacherA,
    student: { ...TENANT.users.studentA, name: TENANT.orgA.student.name },
    question,
    questionReportId,
    groupReportId,
    otherReportId,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The dashboard nests the sidebar-inset `<main>` around the page's own `<main>`, so a
 * bare `main` is ambiguous and the page content is always the inner one.
 */
function content(page: Page) {
  return page.locator('main main');
}

function orgSwitcher(page: Page) {
  return page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]').first();
}

/** Real login, then enter the panel the way a manager does. */
async function signInAsManager(page: Page, tenant: CaseTenant): Promise<void> {
  await loginAs(page, TENANT, 'manager', { locale: 'pl', waitFor: /\/manage$/ });

  await page.goto('/manage');
  await expect(page).toHaveURL(/\/manage$/);
  // The switcher names this run's organization, so the panel under test is the
  // case's tenant and not a stale session from another worker.
  await expect(orgSwitcher(page)).toContainText(tenant.org.name);

  await page.locator('a[data-sidebar="menu-button"][href="/manage/reports"]').click();
  await expect(page).toHaveURL(/\/manage\/reports$/);
}

test.describe('@case:MGR-REP-01 @area:MGR @prio:P2 reports in the organization', () => {
  let tenant: CaseTenant;

  test.beforeEach(async ({ browser, baseURL }) => {
    tenant = await prepareTenant(browser, baseURL ?? 'http://localhost:3010');
    console.log(`MGR-REP-01 tenant key: ${tenant.key}`);
    console.log(`MGR-REP-01 org: ${tenant.org.id} (${tenant.org.name})`);
    console.log(`MGR-REP-01 question report: ${tenant.questionReportId}`);
    console.log(`MGR-REP-01 group report: ${tenant.groupReportId}`);
    console.log(`MGR-REP-01 org B report: ${tenant.otherReportId}`);
  });

  test('the manager sees the whole organization and group reports carry the group name', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signInAsManager(page, tenant);

    // 1. `/manage/reports` announces itself with the copy the case quotes.
    const main = content(page);
    await expect(main.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();
    await expect(main.getByText(COPY.description, { exact: true })).toBeVisible();

    // Exactly the organization's two reports are listed — no other org's row.
    const cards = main.locator('a[href^="/manage/reports/"]');
    await expect(cards).toHaveCount(2);

    const questionCard = main.locator(`a[href="/manage/reports/${tenant.questionReportId}"]`);
    await expect(questionCard).toBeVisible();
    await expect(questionCard).toContainText(tenant.question.content);
    await expect(questionCard.getByText(COPY.open, { exact: true })).toBeVisible();
    // The counterpart of a question thread is its reporter (the student), because
    // the manager is looking at a thread they do not participate in.
    await expect(questionCard).toContainText(tenant.student.name);

    const groupCard = main.locator(`a[href="/manage/reports/${tenant.groupReportId}"]`);
    await expect(groupCard).toBeVisible();
    // Expected result: a report „do grupy” is labelled „Grupa: <nazwa>”.
    await expect(groupCard.getByText(`Grupa: ${tenant.group.name}`, { exact: true })).toBeVisible();
    await expect(groupCard.getByText(COPY.open, { exact: true })).toBeVisible();

    // The control org's report is not on the page.
    await expect(main.locator(`a[href="/manage/reports/${tenant.otherReportId}"]`)).toHaveCount(0);
    await expect(main.getByText(FOREIGN_REPORT_MESSAGE)).toHaveCount(0);

    // The view is the API's answer, not a cached page: org-wide scope for the admin,
    // participant scope for everyone else (#276).
    const list = await page.request.get('/api/v1/question-reports?limit=100');
    expect(list.status(), 'GET /api/v1/question-reports').toBe(200);
    const listBody = (await list.json()) as { success: boolean; data: { items: { id: string }[] } };
    expect(listBody.success).toBe(true);
    const ids = listBody.data.items.map((item) => item.id);
    expect(ids, 'the tenant reports are listed').toEqual(
      expect.arrayContaining([tenant.questionReportId, tenant.groupReportId]),
    );
    expect(ids, 'no report from another organization').not.toContain(tenant.otherReportId);

    // The question report really is between two other people, which is what makes
    // the list assertion above prove org-wide visibility.
    const detail = await page.request.get(`/api/v1/question-reports/${tenant.questionReportId}`);
    expect(detail.status(), 'GET the question report').toBe(200);
    const detailBody = (await detail.json()) as {
      data: {
        report: {
          status: string;
          group: { name: string } | null;
          reporter: { id: string } | null;
          teacher: { id: string } | null;
        };
        messages: { body: string }[];
      };
    };
    expect(detailBody.data.report.reporter?.id).toBe(tenant.student.id);
    expect(detailBody.data.report.teacher?.id).toBe(tenant.teacher.id);
    expect(detailBody.data.report.teacher?.id).not.toBe(tenant.manager.id);
    expect(detailBody.data.report.group).toBeNull();

    const groupDetail = await page.request.get(`/api/v1/question-reports/${tenant.groupReportId}`);
    expect(groupDetail.status(), 'GET the group report').toBe(200);
    const groupBody = (await groupDetail.json()) as {
      data: { report: { group: { name: string } | null; teacher: { id: string } | null } };
    };
    expect(groupBody.data.report.group?.name).toBe(tenant.group.name);
    expect(groupBody.data.report.teacher?.id).toBe(tenant.manager.id);

    // And the manager cannot open the other organization's thread at all.
    const foreign = await page.request.get(`/api/v1/question-reports/${tenant.otherReportId}`);
    expect(foreign.status(), 'GET the org B report as org A manager').toBe(404);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('opening a thread and replying posts the manager answer into the report', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signInAsManager(page, tenant);

    // 2. Open the thread the manager only sees as the org admin.
    const main = content(page);
    await main.locator(`a[href="/manage/reports/${tenant.questionReportId}"]`).click();
    await expect(page).toHaveURL(
      new RegExp(`/manage/reports/${escapeRegExp(tenant.questionReportId)}$`),
    );
    await expect(main.getByText(tenant.question.content, { exact: true })).toBeVisible();
    await expect(main.getByText(COPY.open, { exact: true })).toBeVisible();
    await expect(main.getByText(QUESTION_REPORT_MESSAGE, { exact: true })).toBeVisible();

    // Write the answer and send it.
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveAttribute('placeholder', COPY.replyPlaceholder);
    await textarea.fill(REPLY_MESSAGE);
    await page.locator(`button[aria-label="${COPY.sendReply}"]`).click();

    // The answer shows up in the thread under the manager's name and the field resets.
    await expect(main.getByText(REPLY_MESSAGE, { exact: true })).toBeVisible();
    await expect(main.getByText(tenant.manager.name, { exact: true })).toBeVisible();
    await expect(textarea).toHaveValue('');

    // The thread really stored it, and replying to an open report keeps it open.
    const detail = await page.request.get(`/api/v1/question-reports/${tenant.questionReportId}`);
    expect(detail.status(), 'GET the report after replying').toBe(200);
    const body = (await detail.json()) as {
      data: {
        report: { status: string };
        messages: { body: string; sender_id: string }[];
      };
    };
    expect(body.data.messages.map((message) => message.body)).toEqual([
      QUESTION_REPORT_MESSAGE,
      REPLY_MESSAGE,
    ]);
    expect(body.data.messages[1].sender_id).toBe(tenant.manager.id);
    expect(body.data.report.status).toBe('open');

    // A reload proves the thread is server state, not the last client render.
    await page.reload();
    await expect(main.getByText(REPLY_MESSAGE, { exact: true })).toBeVisible();

    // The group thread keeps the „Grupa: <nazwa>” label on the thread surface too.
    await page.goto(`/manage/reports/${tenant.groupReportId}`);
    await expect(main.getByText(`Grupa: ${tenant.group.name}`, { exact: true })).toBeVisible();
    await expect(main.getByText(GROUP_REPORT_MESSAGE, { exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
