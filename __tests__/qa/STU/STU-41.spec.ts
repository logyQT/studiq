import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-41 — unread counter for question reports („Licznik nieprzeczytanych zgłoszeń”).
 *
 * Case steps:
 * 1. sign in as the reporting student and look at „Zgłoszenia” in the sidebar;
 * 2. open the thread.
 *
 * Expected: a badge next to „Zgłoszenia” counts the unread reports; opening a
 * thread marks that report read and the counter drops.
 *
 * Prerequisite (verbatim: „Nauczyciel odpowiedział na zgłoszenie.”) is rebuilt
 * inside the case's own tenant through the product API — the educator owns two
 * open questions in the tenant organization, the tenant student reports both and
 * the educator answers each one. No legacy account (`student1@dev.local`, `pass`)
 * and no shared seed row is used.
 *
 *   bun scripts/qa-tenant.ts STU-41 --fresh
 *
 * Tenant: `content` profile (`__tests__/qa/profiles/STU-41.json`) — organization
 * `qa-stu-41-<suffix>` with a manager (unused), the educator and the student. All
 * ids derive from
 * `tenantKey('qa/cases/STU-41.md', 'STU-41#<suffix>', 'qa-shared')` + `tenantId`,
 * or come back from the product API; nothing global (admin setting, feature flag,
 * plan, platform statistic, singleton row) and no other tenant is touched.
 *
 * Attempt isolation (CI seeds once and retries against the same tenant): every
 * attempt clears the stale unread receipts of both participants first, then
 * creates its own two reports and answers, so the badge stays exact — 2 → 1 → 0 —
 * instead of accumulating across retries.
 *
 * Acceptance points (walked on the shared app, worker qa-env-6, Polish UI):
 * 1. With two answered reports the sidebar entry „Zgłoszenia” carries the badge
 *    `2`, and both rows on `/app/reports` are marked „Nieprzeczytane”.
 * 2. Opening one thread shows the question and the educator's answer; the badge
 *    drops to `1`, that row loses „Nieprzeczytane”, the other row keeps it.
 * 3. Opening the second thread shows its answer; the badge disappears entirely
 *    and the unread endpoint reports `0`.
 */

const CASE = 'STU-41';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const REPORTS_URL = '/api/v1/question-reports';

/** Polish copy from `QuestionReports` / `DashboardLayout` (pl.json). */
const COPY = {
  nav: 'Zgłoszenia',
  unread: 'Nieprzeczytane',
  pageDescription: 'Twoje zgłoszenia nieprawidłowości pytań i odpowiedzi wykładowców.',
  backToReports: 'Wróć do zgłoszeń',
} as const;

const BANK_NAME = 'STU-41 Bank pytań';
const FIRST_QUESTION = 'STU-41 Jaka jest stolica Francji?';
const SECOND_QUESTION = 'STU-41 Ile wynosi pierwiastek z 81?';
const FIRST_REPORT = 'STU-41 Zgłoszenie pierwsze';
const SECOND_REPORT = 'STU-41 Zgłoszenie drugie';
const FIRST_ANSWER = 'STU-41 Odpowiedź nauczyciela pierwsza';
const SECOND_ANSWER = 'STU-41 Odpowiedź nauczyciela druga';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankListItem {
  id: string;
  name: string;
  created_by: string;
}

interface BankListResult {
  items: BankListItem[];
}

interface QuestionItem {
  id: string;
  content: string;
  created_by: string;
}

interface ReportListItem {
  id: string;
  status: 'open' | 'resolved';
  isUnread: boolean;
  reported_by: string;
  teacher_id: string;
  question: { id: string; content: string } | null;
}

interface ReportListResult {
  items: ReportListItem[];
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `POST` with an exact expected status; returns the unwrapped `data`. */
async function postData<T>(page: Page, url: string, status: number, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  expect(response.status(), `POST ${url} → ${response.status()} ${await response.text()}`).toBe(
    status,
  );
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

async function unreadCount(page: Page): Promise<number> {
  return (await getData<{ count: number }>(page, `${REPORTS_URL}/unread-count`)).count;
}

/**
 * Clear every unread receipt the caller still has in this tenant, so a re-run
 * against the same tenant (CI retries) starts from a clean counter.
 */
async function clearUnread(page: Page): Promise<void> {
  const reports = await getData<ReportListResult>(page, `${REPORTS_URL}?limit=100`);
  for (const report of reports.items.filter((item) => item.isUnread)) {
    await postData(page, `${REPORTS_URL}/${report.id}/read`, 200, {});
  }
}

/** The case's question bank, created once per tenant (idempotent for retries). */
async function ensureBank(page: Page): Promise<BankListItem> {
  const banks = await getData<BankListResult>(page, `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
  if (existing) return existing;
  return postData<BankListItem>(page, BANKS_URL, 201, {
    name: BANK_NAME,
    description: 'Licznik nieprzeczytanych zgłoszeń (STU-41)',
  });
}

/** An open question of the case, created once per tenant. */
async function ensureQuestion(page: Page, bankId: string, content: string): Promise<QuestionItem> {
  const questions = await getData<QuestionItem[]>(page, `${QUESTIONS_URL}?bankId=${bankId}`);
  const existing = questions.find((question) => question.content === content);
  if (existing) return existing;
  return postData<QuestionItem>(page, QUESTIONS_URL, 201, {
    bankId,
    type: 'open',
    content,
    answers: [],
  });
}

/** The sidebar entry the badge is rendered on (desktop copy of the nav). */
function reportsNav(page: Page, basePath: '/app' | '/edu'): Locator {
  return page.locator(`a[data-sidebar="menu-button"][href="${basePath}/reports"]`);
}

/**
 * The counter badge inside the nav entry. `nav-main.tsx` renders it as the
 * rounded `<span>` after the label (and hides the whole span at `0`).
 */
function reportsBadge(page: Page, basePath: '/app' | '/edu'): Locator {
  return reportsNav(page, basePath).locator('span.rounded-full');
}

/**
 * The dashboard nests the sidebar-inset `<main>` around the page's own `<main>`, so a
 * bare `main` is ambiguous and the page content is always the inner one.
 */
function content(page: Page): Locator {
  return page.locator('main main');
}

test.describe('@case:STU-41 @area:STU @prio:P2 unread reports counter', () => {
  test('the „Zgłoszenia” badge counts answered reports and drops when a thread is opened', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const educator = tenant.users.teacher;
    const student = tenant.users.student;
    if (!educator || !student) {
      throw new Error(`${CASE} needs the content tenant profile (educator, student)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Prerequisite: the educator owns the two questions being reported ────
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    await clearUnread(page);
    const bank = await ensureBank(page);
    const firstQuestion = await ensureQuestion(page, bank.id, FIRST_QUESTION);
    const secondQuestion = await ensureQuestion(page, bank.id, SECOND_QUESTION);
    expect(firstQuestion.created_by, 'the questions belong to the tenant educator').toBe(
      educator.id,
    );
    expect(secondQuestion.created_by).toBe(educator.id);

    // ── Prerequisite: the student reports both questions ────────────────────
    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await clearUnread(page);
    expect(await unreadCount(page), 'the counter starts empty for this attempt').toBe(0);

    const firstReport = await postData<ReportListItem>(
      page,
      `${QUESTIONS_URL}/${firstQuestion.id}/reports`,
      201,
      { message: FIRST_REPORT },
    );
    const secondReport = await postData<ReportListItem>(
      page,
      `${QUESTIONS_URL}/${secondQuestion.id}/reports`,
      201,
      { message: SECOND_REPORT },
    );
    expect(firstReport.teacher_id, 'the report is addressed to the question author').toBe(
      educator.id,
    );
    expect(firstReport.reported_by, 'the report comes from the tenant student').toBe(student.id);

    // A freshly written report is read for its reporter: no badge from it yet.
    expect(await unreadCount(page), 'a report the student just wrote is read for them').toBe(0);

    // ── Prerequisite: the educator answers both reports ─────────────────────
    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    for (const [report, answer] of [
      [firstReport, FIRST_ANSWER],
      [secondReport, SECOND_ANSWER],
    ] as const) {
      await postData(page, `${REPORTS_URL}/${report.id}/messages`, 201, { body: answer });
    }

    // ── Step 1: the reporting student sees the unread badge ─────────────────
    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(await unreadCount(page), 'both answered reports are unread').toBe(2);

    const nav = reportsNav(page, '/app');
    await expect(nav).toBeVisible();
    await expect(nav).toContainText(COPY.nav);
    await expect(reportsBadge(page, '/app'), 'the badge counts both unread reports').toHaveText(
      '2',
    );

    await nav.click();
    await expect(page).toHaveURL(/\/app\/reports$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const main = content(page);
    await expect(main.getByRole('heading', { name: COPY.nav, exact: true })).toBeVisible();
    await expect(main.getByText(COPY.pageDescription, { exact: true })).toBeVisible();

    const firstRow = main.locator(`a[href="/app/reports/${firstReport.id}"]`);
    const secondRow = main.locator(`a[href="/app/reports/${secondReport.id}"]`);
    await expect(firstRow).toContainText(FIRST_QUESTION);
    await expect(secondRow).toContainText(SECOND_QUESTION);
    await expect(firstRow.getByText(COPY.unread, { exact: true })).toBeVisible();
    await expect(secondRow.getByText(COPY.unread, { exact: true })).toBeVisible();

    // ── Step 2a: open the first thread — the counter drops 2 → 1 ────────────
    await firstRow.click();
    await expect(page).toHaveURL(new RegExp(`/app/reports/${firstReport.id}$`));
    const thread = content(page);
    await expect(thread.getByText(FIRST_REPORT, { exact: true })).toBeVisible();
    await expect(thread.getByText(FIRST_ANSWER, { exact: true })).toBeVisible();
    await expect(thread.getByText(FIRST_QUESTION, { exact: true })).toBeVisible();

    await expect(reportsBadge(page, '/app'), 'opening the thread consumes one unread').toHaveText(
      '1',
    );
    await expect
      .poll(() => unreadCount(page), { message: 'the read receipt is persisted server-side' })
      .toBe(1);

    // Back on the list, only the untouched report is still marked unread.
    await page.getByRole('link', { name: COPY.backToReports }).click();
    await expect(page).toHaveURL(/\/app\/reports$/);
    await expect(firstRow.getByText(COPY.unread, { exact: true })).toHaveCount(0);
    await expect(secondRow.getByText(COPY.unread, { exact: true })).toBeVisible();
    await expect(reportsBadge(page, '/app')).toHaveText('1');

    // ── Step 2b: open the second thread — the badge disappears ──────────────
    await secondRow.click();
    await expect(page).toHaveURL(new RegExp(`/app/reports/${secondReport.id}$`));
    await expect(content(page).getByText(SECOND_REPORT, { exact: true })).toBeVisible();
    await expect(content(page).getByText(SECOND_ANSWER, { exact: true })).toBeVisible();
    await expect(content(page).getByText(SECOND_QUESTION, { exact: true })).toBeVisible();

    await expect(reportsBadge(page, '/app'), 'no unread report, no badge').toHaveCount(0);
    await expect.poll(() => unreadCount(page), { message: 'every report is read now' }).toBe(0);

    // The list agrees: no row is marked unread anymore.
    await nav.click();
    await expect(page).toHaveURL(/\/app\/reports$/);
    await expect(main.getByText(COPY.unread, { exact: true })).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
