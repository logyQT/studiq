import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * MGR-REP-01 — reports in the organization (`/manage/reports`).
 *
 * Prerequisite (reconciled with the tenant seeder): the organization has reports,
 * raised by its own student against a teacher's question and against a group. That
 * replaces the legacy manual seed (`manager@dev.local`, „WSB Merito”, password
 * `pass`), which this suite never uses.
 *
 * Tenant: `tenantKey('qa/cases/MGR-REP-01.md', 'MGR-REP-01#<run>', 'qa-shared')` plus a
 * per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/group id is
 * `tenantId(key, entity)`, so a run is reproducible by pinning the suffix and two
 * independent runs never share an organization.
 *
 * The graph is seeded at run time through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`) and the data is built through the product's
 * own API, so the report rows carry real authorship and org scoping:
 *
 * - org A (under test): `manager` (admin), `teacher` (educator, org role `teacher`),
 *   `student` (member) and the default group `G1`, which the manager created.
 *   The teacher owns a question bank with one question; the student reports that
 *   question and reports the group.
 * - org B (control): its own manager/teacher/student and group `G2`, with a report of
 *   its own. Nothing in org B may ever reach org A's manager.
 *
 * The manager is **not** a participant of the question thread (reporter = student,
 * recipient = teacher): seeing it proves the case's „manager widzi zgłoszenia z całej
 * organizacji”, not just the participant view. The group report's recipient is the
 * manager, because the manager created `G1`.
 *
 * Nothing global is written: no admin setting, feature flag, plan, platform stat,
 * singleton row or another worker's tenant.
 */

const CASE_FILE = 'qa/cases/MGR-REP-01.md';
const PROJECT = 'qa-shared';
const RUN_SUFFIX =
  process.env.QA_RUN_SUFFIX ?? `r${Date.now().toString(36)}${randomTag(4)}`.toLowerCase();
/** E-mail/name-safe form of the suffix. */
const RUN_TAG = RUN_SUFFIX.replace(/[^a-z0-9-]/gi, '-');

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** Polish copy from `ManageReportsClient` and `QuestionReports` (pl.json). */
const COPY = {
  title: 'Zgłoszenia',
  description: 'Zgłoszenia dotyczące pytań i grup w Twojej organizacji.',
  open: 'Otwarte',
  groupLabel: 'Grupa: G1',
  replyPlaceholder: 'Napisz odpowiedź...',
  sendReply: 'Wyślij odpowiedź',
} as const;

interface CaseOrg {
  id: string;
  name: string;
  group: { id: string; name: string };
}

interface CaseTenant {
  key: string;
  /** Organization under test. */
  org: CaseOrg;
  /** Second organization in the same database; a control for report isolation. */
  otherOrg: CaseOrg;
  manager: SeedAccount;
  teacher: SeedAccount;
  student: SeedAccount;
  otherManager: SeedAccount;
  otherTeacher: SeedAccount;
  otherStudent: SeedAccount;
  question: { id: string; content: string };
  /** Student → teacher question report; the manager is not a participant. */
  questionReportId: string;
  /** Student → manager group report; labelled „Grupa: G1”. */
  groupReportId: string;
  /** Org B report that must never be listed for org A's manager. */
  otherReportId: string;
}

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

/**
 * A signed-in API session for one seeded account, pinned to its organization. The
 * app only writes `active_org_id` when an org is created or switched, so a seeded
 * membership needs the cookie set by the fixture — otherwise `withAuth` scopes the
 * request to no org and the report/bank creation lands outside the tenant.
 */
async function openSession(
  browser: Browser,
  baseURL: string,
  orgId: string,
  account: SeedAccount,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const { hostname } = new URL(baseURL);
  const context = await browser.newContext({ baseURL });
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: orgId, domain: hostname, path: '/', httpOnly: true },
  ]);
  const page = await context.newPage();
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);
  return { page, close: () => context.close() };
}

/** Teacher creates a bank plus one open question — the target the student reports. */
async function createQuestion(
  page: Page,
  content: string,
): Promise<{ id: string; bankId: string }> {
  const bank = await page.request.post('/api/v1/questions/banks', {
    data: { name: `QA MGR-REP-01 bank ${RUN_TAG}` },
  });
  expect(bank.status(), 'POST /api/v1/questions/banks').toBe(201);
  const bankId = ((await bank.json()) as { data: { id: string } }).data.id;

  const question = await page.request.post('/api/v1/questions', {
    data: { bankId, type: 'open', content, answers: [] },
  });
  expect(question.status(), 'POST /api/v1/questions').toBe(201);
  return { id: ((await question.json()) as { data: { id: string } }).data.id, bankId };
}

async function seedCaseTenant(browser: Browser, baseURL: string): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, `MGR-REP-01#${RUN_SUFFIX}`, PROJECT)}::${RUN_SUFFIX}`;

  const org: CaseOrg = {
    id: tenantId(key, 'org:a'),
    name: `qa-mgr-rep01-${RUN_TAG}-a`,
    group: { id: tenantId(key, 'group:a'), name: 'G1' },
  };
  const otherOrg: CaseOrg = {
    id: tenantId(key, 'org:b'),
    name: `qa-mgr-rep01-${RUN_TAG}-b`,
    group: { id: tenantId(key, 'group:b'), name: 'G2' },
  };

  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const teacher = buildAccount(key, 'teacher', 'educator', {
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });
  const otherManager = buildAccount(key, 'other-manager', 'manager', { name: 'QA other manager' });
  const otherTeacher = buildAccount(key, 'other-teacher', 'educator', {
    name: 'QA other teacher',
    orgRole: 'teacher',
  });
  const otherStudent = buildAccount(key, 'other-student', 'student', { name: 'QA other student' });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  // Org A: the manager is the admin and the owner of the default group, so a group
  // report is addressed to the manager while the question report stays 1:1 between
  // the student and the teacher.
  await seedTenantGraph(db, {
    key: `${key}:a`,
    org: { id: org.id, name: org.name },
    defaultGroup: { id: org.group.id, name: org.group.name, isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [teacher, student],
    ownerOrgRole: 'admin',
  });
  // Org B: an independent manager/teacher/student trio with a report of its own.
  await seedTenantGraph(db, {
    key: `${key}:b`,
    org: { id: otherOrg.id, name: otherOrg.name },
    defaultGroup: { id: otherOrg.group.id, name: otherOrg.group.name, isDefault: true },
    extraGroups: [],
    owner: otherManager,
    members: [otherTeacher, otherStudent],
    ownerOrgRole: 'admin',
  });

  const teacherSession = await openSession(browser, baseURL, org.id, teacher);
  const studentSession = await openSession(browser, baseURL, org.id, student);
  const otherTeacherSession = await openSession(browser, baseURL, otherOrg.id, otherTeacher);
  const otherStudentSession = await openSession(browser, baseURL, otherOrg.id, otherStudent);
  try {
    const questionContent = `QA MGR-REP-01 question ${RUN_TAG}`;
    const question = await createQuestion(teacherSession.page, questionContent);
    const otherQuestion = await createQuestion(
      otherTeacherSession.page,
      `QA MGR-REP-01 foreign question ${RUN_TAG}`,
    );

    const questionReport = await studentSession.page.request.post(
      `/api/v1/questions/${question.id}/reports`,
      { data: { message: `QA MGR-REP-01 question report ${RUN_TAG}` } },
    );
    expect(questionReport.status(), 'report the teacher question').toBe(201);
    const questionReportId = ((await questionReport.json()) as { data: { id: string } }).data.id;

    const groupReport = await studentSession.page.request.post(
      `/api/v1/organization/groups/${org.group.id}/reports`,
      { data: { message: `QA MGR-REP-01 group report ${RUN_TAG}` } },
    );
    expect(groupReport.status(), 'report the group').toBe(201);
    const groupReportId = ((await groupReport.json()) as { data: { id: string } }).data.id;

    const otherReport = await otherStudentSession.page.request.post(
      `/api/v1/questions/${otherQuestion.id}/reports`,
      { data: { message: `QA MGR-REP-01 foreign report ${RUN_TAG}` } },
    );
    expect(otherReport.status(), 'report the org B question').toBe(201);
    const otherReportId = ((await otherReport.json()) as { data: { id: string } }).data.id;

    return {
      key,
      org,
      otherOrg,
      manager,
      teacher,
      student,
      otherManager,
      otherTeacher,
      otherStudent,
      question: { id: question.id, content: questionContent },
      questionReportId,
      groupReportId,
      otherReportId,
    };
  } finally {
    await Promise.all([
      teacherSession.close(),
      studentSession.close(),
      otherTeacherSession.close(),
      otherStudentSession.close(),
    ]);
  }
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

/** Real login through the API, then enter the panel the way a manager does. */
async function signInAsManager(page: Page, tenant: CaseTenant, baseURL: string): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: tenant.manager.email, password: tenant.manager.password },
  });
  expect(response.status(), `login ${tenant.manager.email}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: tenant.org.id, domain: hostname, path: '/', httpOnly: true },
  ]);

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

  test.beforeAll(async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3010';
    tenant = await seedCaseTenant(browser, baseURL);
    console.log(`MGR-REP-01 tenant key: ${tenant.key}`);
    console.log(`MGR-REP-01 org: ${tenant.org.id} (${tenant.org.name})`);
    console.log(`MGR-REP-01 question report: ${tenant.questionReportId}`);
    console.log(`MGR-REP-01 group report: ${tenant.groupReportId}`);
    console.log(`MGR-REP-01 org B report: ${tenant.otherReportId}`);
  });

  test('the manager sees the whole organization and group reports carry the group name', async ({
    page,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signInAsManager(page, tenant, baseURL ?? 'http://localhost:3010');

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
    await expect(questionCard).toContainText(tenant.student.name ?? '');

    const groupCard = main.locator(`a[href="/manage/reports/${tenant.groupReportId}"]`);
    await expect(groupCard).toBeVisible();
    // Expected result: a report „do grupy” is labelled „Grupa: <nazwa>”.
    await expect(groupCard.getByText(COPY.groupLabel, { exact: true })).toBeVisible();
    await expect(groupCard.getByText(COPY.open, { exact: true })).toBeVisible();

    // The control org's report is not on the page.
    await expect(main.locator(`a[href="/manage/reports/${tenant.otherReportId}"]`)).toHaveCount(0);
    await expect(main.getByText(`QA MGR-REP-01 foreign report ${RUN_TAG}`)).toHaveCount(0);

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
    expect(groupBody.data.report.group?.name).toBe(tenant.org.group.name);
    expect(groupBody.data.report.teacher?.id).toBe(tenant.manager.id);

    // And the manager cannot open the other organization's thread at all.
    const foreign = await page.request.get(`/api/v1/question-reports/${tenant.otherReportId}`);
    expect(foreign.status(), 'GET the org B report as org A manager').toBe(404);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('opening a thread and replying posts the manager answer into the report', async ({
    page,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signInAsManager(page, tenant, baseURL ?? 'http://localhost:3010');

    // 2. Open the thread the manager only sees as the org admin.
    const main = content(page);
    await main.locator(`a[href="/manage/reports/${tenant.questionReportId}"]`).click();
    await expect(page).toHaveURL(
      new RegExp(`/manage/reports/${escapeRegExp(tenant.questionReportId)}$`),
    );
    await expect(main.getByText(tenant.question.content, { exact: true })).toBeVisible();
    await expect(main.getByText(COPY.open, { exact: true })).toBeVisible();
    await expect(
      main.getByText(`QA MGR-REP-01 question report ${RUN_TAG}`, { exact: true }),
    ).toBeVisible();

    // Write the answer and send it.
    const reply = `QA MGR-REP-01 manager reply ${RUN_TAG}`;
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveAttribute('placeholder', COPY.replyPlaceholder);
    await textarea.fill(reply);
    await page.locator(`button[aria-label="${COPY.sendReply}"]`).click();

    // The answer shows up in the thread under the manager's name and the field resets.
    await expect(main.getByText(reply, { exact: true })).toBeVisible();
    await expect(main.getByText(tenant.manager.name ?? '', { exact: true })).toBeVisible();
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
      `QA MGR-REP-01 question report ${RUN_TAG}`,
      reply,
    ]);
    expect(body.data.messages[1].sender_id).toBe(tenant.manager.id);
    expect(body.data.report.status).toBe('open');

    // A reload proves the thread is server state, not the last client render.
    await page.reload();
    await expect(main.getByText(reply, { exact: true })).toBeVisible();

    // The group thread keeps the „Grupa: <nazwa>” label on the thread surface too.
    await page.goto(`/manage/reports/${tenant.groupReportId}`);
    await expect(main.getByText(COPY.groupLabel, { exact: true })).toBeVisible();
    await expect(
      main.getByText(`QA MGR-REP-01 group report ${RUN_TAG}`, { exact: true }),
    ).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
