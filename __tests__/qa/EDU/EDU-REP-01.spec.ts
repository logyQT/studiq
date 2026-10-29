import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-REP-01 — the educator's report inbox (`/edu/reports`).
 *
 * Case steps: a student reported a wrong question/flashcard of the teacher (STU-39),
 * then the teacher opens `/edu/reports`.
 *
 * The case was written against the legacy manual seed (`teacher1@dev.local`,
 * `student1@dev.local`, `O1G1T1`, password `pass`). The suite version runs on the
 * case's own tenant, seeded with
 *
 *   bun scripts/qa-tenant.ts EDU-REP-01 --fresh
 *
 * from `__tests__/qa/profiles/EDU-REP-01.json` (`content`): one organization, the
 * default group `G1`, and a `manager` (org `admin`, group `teacher`), an educator
 * (`teacher` — the case's T1) and a `student` (the case's S1, member of `G1`).
 * Every id derives from `tenantKey('qa/cases/EDU-REP-01.md',
 * 'EDU-REP-01#<suffix>', 'qa-shared')` + `tenantId(key, entity)`; nothing global is
 * read or written (no admin setting, feature flag, plan, platform stat, singleton
 * row or another worker's tenant).
 *
 * Prerequisite, prepared idempotently through the product API:
 * 1. The manager promotes the educator to group `teacher` of `G1` (the seeder
 *    enrols group members as `member`, and only a group teacher may share content
 *    to a group) via `PUT /api/v1/organization/groups/:id/members` — the same write
 *    `/manage/groups` performs, tenant-local.
 * 2. The educator creates the bank `EDU-REP-01 bank` shared to `G1` and one question
 *    in it (the case's `O1G1T1`).
 * 3. The student files the report through `POST /api/v1/questions/:id/reports` with
 *    the case's message „Odpowiedź jest błędna” — the same endpoint the
 *    „Zgłoś nieprawidłowość” dialog calls, whose toast was confirmed in the walk.
 *
 * Acceptance points (walked on the shared app, worker qa-env-4, before writing):
 * 1. `/edu/reports` renders the heading „Zgłoszenia” and the description
 *    „Zgłoszenia nieprawidłowości od studentów dotyczące Twoich pytań.”
 * 2. The list holds one row with the reported question's content, the student as
 *    author and the date of the last activity, plus the status badge „Otwarte” and
 *    the unread marker „Nieprzeczytane”.
 * 3. The sidebar entry „Zgłoszenia” carries the unread badge `1`.
 * 4. `GET /api/v1/question-reports` and `GET /api/v1/question-reports/unread-count`
 *    agree with the screen: the report is addressed to this educator, belongs to the
 *    student and is unread.
 */

const CASE = 'EDU-REP-01';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const REPORTS_URL = '/api/v1/question-reports';

/** The case's content, scoped to this case so a retry reuses it instead of duplicating. */
const BANK_NAME = 'EDU-REP-01 bank';
const QUESTION_CONTENT = 'EDU-REP-01: Ile wynosi 2+2?';
const REPORT_MESSAGE = 'Odpowiedź jest błędna';

/** Polish copy from `EduReportsPage` / `ReportsListScreen` (pl.json `QuestionReports`). */
const COPY = {
  title: 'Zgłoszenia',
  description: 'Zgłoszenia nieprawidłowości od studentów dotyczące Twoich pytań.',
  statusOpen: 'Otwarte',
  unread: 'Nieprzeczytane',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

interface BankRow {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
  groupIds: string[];
}

interface QuestionRow {
  id: string;
  content: string;
  created_by: string;
  organization_id: string | null;
}

interface ReportRow {
  id: string;
  status: 'open' | 'resolved';
  updated_at: string;
  isUnread: boolean;
  reported_by: string;
  teacher_id: string;
  question: { id: string; content: string } | null;
  reporter: { id: string; full_name: string | null; email: string } | null;
}

interface ReportListResult {
  items: ReportRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/**
 * The seeder enrols group members with the group `member` role, but only a group
 * `teacher` may share content to the group. Promote the educator through the
 * manager's own roster endpoint — the same write `/manage/groups` performs — keeping
 * every other member untouched.
 */
async function ensureEducatorLeadsGroup(page: Page, tenant: QaTenant): Promise<void> {
  const groupId = tenant.group?.id;
  const educator = tenant.users.teacher;
  if (!groupId || !educator) {
    throw new Error(`${CASE} needs the content tenant profile (org, group and educator)`);
  }

  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<GroupMemberRow[]>(page, url);
  const member = roster.find((row) => row.userId === educator.id);
  expect(member, 'the seeded educator is a member of the tenant group').toBeTruthy();
  if (member!.role === 'teacher') return;

  const response = await page.request.put(url, {
    data: {
      members: roster.map((row) =>
        row.userId === educator.id ? { userId: row.userId, role: 'teacher' } : row,
      ),
    },
  });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);

  const after = await getData<GroupMemberRow[]>(page, url);
  expect(
    after.find((row) => row.userId === educator.id)?.role,
    'the educator now teaches the tenant group',
  ).toBe('teacher');
}

/**
 * Create the case's group bank, or reuse it on a retry against an already-seeded
 * tenant (CI seeds once and retries the same tenant).
 */
async function ensureBank(page: Page, groupId: string): Promise<BankRow> {
  const banks = await getData<{ items: BankRow[] }>(page, `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
  if (existing) return existing;

  const response = await page.request.post(BANKS_URL, {
    data: { name: BANK_NAME, visibility: 'group', groupIds: [groupId] },
  });
  expect(
    response.status(),
    `POST ${BANKS_URL} (${BANK_NAME}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<BankRow>;
  expect(body.success, `POST ${BANKS_URL} (${BANK_NAME}) success flag`).toBe(true);
  return body.data;
}

/** One question in the bank, keyed by its content so retries are idempotent. */
async function ensureQuestion(page: Page, bankId: string): Promise<QuestionRow> {
  const url = `${QUESTIONS_URL}?bankId=${bankId}`;
  const questions = await getData<QuestionRow[]>(page, url);
  const existing = questions.find((question) => question.content === QUESTION_CONTENT);
  if (existing) return existing;

  const response = await page.request.post(QUESTIONS_URL, {
    data: {
      bankId,
      type: 'mcq',
      content: QUESTION_CONTENT,
      answers: [
        { content: '4', isCorrect: true, orderIndex: 0 },
        { content: '5', isCorrect: false, orderIndex: 1 },
      ],
    },
  });
  expect(
    response.status(),
    `POST ${QUESTIONS_URL} (${QUESTION_CONTENT}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<QuestionRow>).data;
}

/**
 * The student's STU-39 report, created once per tenant. `POST
 * /api/v1/questions/:id/reports` is the endpoint behind the „Zgłoś
 * nieprawidłowość” dialog; the walk confirmed the dialog's toast „Zgłoszenie
 * wysłane”.
 */
async function ensureReport(page: Page, tenant: QaTenant, questionId: string): Promise<ReportRow> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} needs the content tenant profile (a student)`);

  const list = await getData<ReportListResult>(page, `${REPORTS_URL}?limit=100`);
  const existing = list.items.find(
    (report) => report.question?.id === questionId && report.reported_by === student.id,
  );
  if (existing) return existing;

  const response = await page.request.post(`${QUESTIONS_URL}/${questionId}/reports`, {
    data: { message: REPORT_MESSAGE },
  });
  expect(
    response.status(),
    `POST ${QUESTIONS_URL}/${questionId}/reports → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<{ id: string }>;
  expect(body.success, 'report created').toBe(true);

  const created = await getData<ReportListResult>(page, `${REPORTS_URL}?limit=100`);
  const report = created.items.find((item) => item.id === body.data.id);
  expect(report, 'the new report is listed for its reporter').toBeTruthy();
  return report!;
}

/** Everything the case needs, built through the product API inside this tenant only. */
async function prepareTenant(page: Page, tenant: QaTenant): Promise<QuestionRow> {
  const group = tenant.group;
  const teacher = tenant.users.teacher;
  if (!group || !teacher) {
    throw new Error(`${CASE} needs the content tenant profile (org, group, educator, student)`);
  }

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  await ensureEducatorLeadsGroup(page, tenant);

  await page.context().clearCookies();
  await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
  const bank = await ensureBank(page, group.id);
  expect(bank.created_by, 'the bank is owned by the tenant educator').toBe(teacher.id);
  expect(bank.organization_id, 'the bank belongs to the tenant organization').toBe(tenant.org?.id);
  const question = await ensureQuestion(page, bank.id);
  expect(question.created_by, 'the question is owned by the tenant educator').toBe(teacher.id);

  await page.context().clearCookies();
  await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
  await ensureReport(page, tenant, question.id);

  await page.context().clearCookies();
  await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
  return question;
}

test.describe('@case:EDU-REP-01 @area:EDU @prio:P2 educator report inbox', () => {
  test('lists student reports with author, date and the unread badge', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.key, `${CASE} tenant key`).toContain(`${CASE}.md::${CASE}`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const question = await prepareTenant(page, tenant);
    const teacher = tenant.users.teacher!;
    const student = tenant.users.student!;

    // --- The data behind the screen -----------------------------------------
    const reports = await getData<ReportListResult>(page, `${REPORTS_URL}?limit=100`);
    expect(reports.items, 'reports addressed to this educator').toHaveLength(1);
    const [report] = reports.items;
    expect(report.question?.id, 'the report targets the case question').toBe(question.id);
    expect(report.question?.content, 'the report shows the reported question').toBe(
      QUESTION_CONTENT,
    );
    expect(report.reported_by, 'the reporter is the tenant student').toBe(student.id);
    expect(report.teacher_id, 'the recipient is the tenant educator').toBe(teacher.id);
    expect(report.status, 'a new report is open').toBe('open');
    expect(report.isUnread, 'the educator has not read it yet').toBe(true);

    const unread = await getData<{ count: number }>(page, `${REPORTS_URL}/unread-count`);
    expect(unread.count, 'unread counter').toBe(1);

    // --- Step 1: the educator opens /edu/reports ----------------------------
    await page.goto('/edu/reports');
    await expect(page).toHaveURL(/\/edu\/reports$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.locator('[data-slot="breadcrumb"]').getByText(COPY.title, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.description, { exact: true })).toBeVisible();

    // The single row carries the reported question, its author, the date and the
    // status, and is marked unread (the case's "status przeczytania").
    const author = report.reporter?.full_name ?? report.reporter?.email;
    expect(author, 'the report carries its author').toBeTruthy();

    const row = page.locator('main [data-slot="card"]').filter({ hasText: QUESTION_CONTENT });
    await expect(row, 'the report row').toHaveCount(1);
    await expect(row.getByText(QUESTION_CONTENT, { exact: true })).toBeVisible();
    await expect(row.getByText(author!, { exact: true })).toBeVisible();
    await expect(row.getByText(COPY.statusOpen, { exact: true })).toBeVisible();
    await expect(row.getByText(COPY.unread, { exact: true })).toHaveCount(1);
    await expect(row.locator('span[aria-hidden="true"].bg-red-500')).toBeVisible();

    const time = row.locator('time');
    await expect(time, 'the row timestamp is the report activity time').toHaveAttribute(
      'datetime',
      report.updated_at,
    );
    await expect(time).toHaveText(
      new Date(report.updated_at).toLocaleDateString('pl', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    );

    // --- The unread badge on the „Zgłoszenia” menu entry --------------------
    const navLink = page.locator('a[href="/edu/reports"]');
    await expect(navLink, 'one „Zgłoszenia” entry in the educator sidebar').toHaveCount(1);
    await expect(navLink.getByText(COPY.title, { exact: true })).toBeVisible();
    await expect(navLink.locator('span.rounded-full'), 'unread badge').toHaveText(
      String(unread.count),
    );

    expect(pageErrors, 'no uncaught page errors').toEqual([]);
  });
});
