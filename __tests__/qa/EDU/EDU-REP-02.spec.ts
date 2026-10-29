import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-REP-02 — replying to a student's question report („Odpowiedź na zgłoszenie”).
 *
 * Case (verbatim → tenant model): the educator opens the thread on `/edu/reports`,
 * writes an answer in „Napisz odpowiedź…” and sends it. The reporting student then
 * sees the answer in their own thread (`/app/reports/<id>`) and an unread badge next
 * to „Zgłoszenia” (STU-41). An empty answer is never sent.
 *
 * Tenant (`content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-REP-02 --fresh
 *
 * gives the org `qa-edu-rep-02-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1`. Every id derives from
 * `tenantKey('qa/cases/EDU-REP-02.md', 'EDU-REP-02#<suffix>', 'qa-shared')` +
 * `tenantId`, so nothing global is read or written: no admin setting, feature flag,
 * plan, platform stat or singleton row, and no other worker's tenant.
 *
 * The case was written against the legacy seed (`teacher1@dev.local`,
 * `student1@dev.local`, password `pass`, deck/bank `O1G1T1`). The prerequisite
 * „Student zgłosił błąd w pytaniu” (STU-39 / EDU-REP-01) is rebuilt inside this
 * tenant through the product API: the educator owns one personal question bank with
 * one open question in the tenant organization, and the tenant student reports that
 * question — the report is then addressed to the question's author by the product
 * itself, not by a hard-coded recipient.
 *
 * Attempt isolation (CI seeds once and retries against the same tenant): every
 * attempt clears the stale unread receipts of both participants, creates its own
 * report row and asserts only on that row's id, so the badge counts stay exact
 * (teacher 1 → student 1 → 0) instead of accumulating across retries.
 *
 * Acceptance points (confirmed on the shared app, worker qa-env-5, before writing):
 * 1. `/edu/reports` lists the report with the question content, the reporter and the
 *    date, and the „Zgłoszenia” menu entry carries the unread badge.
 * 2. The thread offers „Napisz odpowiedź…”; the send button is disabled while the
 *    field is empty or whitespace-only, and Enter on an empty field sends nothing.
 * 3. A real answer is posted to `POST /api/v1/question-reports/<id>/messages`,
 *    appears in the thread under the educator's name and clears the input.
 * 4. The reporting student sees the same answer in their thread (also after a
 *    reload), gets an unread badge for it, and opening the thread clears the badge.
 */

const CASE = 'EDU-REP-02';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const REPORTS_URL = '/api/v1/question-reports';

/** Polish copy from `QuestionReports` (pl.json) and the reports screens. */
const COPY = {
  title: 'Zgłoszenia',
  description: 'Zgłoszenia nieprawidłowości od studentów dotyczące Twoich pytań.',
  open: 'Otwarte',
  unread: 'Nieprzeczytane',
  replyPlaceholder: 'Napisz odpowiedź...',
  sendReply: 'Wyślij odpowiedź',
} as const;

const BANK_NAME = 'EDU-REP-02 Bank pytań';
const QUESTION_CONTENT = 'EDU-REP-02 Jaka jest stolica Francji?';
const REPORT_MESSAGE = 'Odpowiedź jest błędna';
const REPLY = 'Dziękuję za zgłoszenie, poprawiliśmy odpowiedź.';

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
  reporter: { id: string; email: string } | null;
  teacher: { id: string; email: string } | null;
}

interface ReportListResult {
  items: ReportListItem[];
}

interface ReportDetail {
  report: ReportListItem & { canResolve: boolean };
  messages: { id: string; body: string; sender_id: string }[];
}

interface ReportMessage {
  id: string;
  body: string;
  sender_id: string;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** Mutating request with an exact expected status; returns the unwrapped `data`. */
async function sendData<T>(
  page: Page,
  method: 'post' | 'put' | 'delete',
  url: string,
  status: number,
  data?: unknown,
): Promise<T> {
  const response = await page.request[method](url, data === undefined ? undefined : { data });
  expect(
    response.status(),
    `${method.toUpperCase()} ${url} → ${response.status()} ${await response.text()}`,
  ).toBe(status);
  const text = await response.text();
  return (text ? (JSON.parse(text) as ApiEnvelope<T>).data : undefined) as T;
}

/** The case's question bank, created once per tenant (idempotent for CI retries). */
async function ensureBank(page: Page): Promise<BankListItem> {
  const banks = await getData<BankListResult>(page, `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
  if (existing) return existing;
  return sendData<BankListItem>(page, 'post', BANKS_URL, 201, {
    name: BANK_NAME,
    description: 'Zgłoszenie błędnej odpowiedzi (EDU-REP-02)',
  });
}

/** The single open question of the case, created once per tenant. */
async function ensureQuestion(page: Page, bankId: string): Promise<QuestionItem> {
  const questions = await getData<QuestionItem[]>(page, `${QUESTIONS_URL}?bankId=${bankId}`);
  const existing = questions.find((question) => question.content === QUESTION_CONTENT);
  if (existing) return existing;
  return sendData<QuestionItem>(page, 'post', QUESTIONS_URL, 201, {
    bankId,
    type: 'open',
    content: QUESTION_CONTENT,
    answers: [],
  });
}

/**
 * Clear every unread receipt the caller still has in this tenant. A previous
 * attempt that failed mid-thread leaves a report unread; clearing it up front keeps
 * this attempt's badge assertions exact (`1`, not „1 or more”).
 */
async function clearUnread(page: Page): Promise<void> {
  const reports = await getData<ReportListResult>(page, `${REPORTS_URL}?limit=100`);
  for (const report of reports.items.filter((item) => item.isUnread)) {
    await sendData(page, 'post', `${REPORTS_URL}/${report.id}/read`, 200, {});
  }
}

/** The sidebar entry the badge is rendered on (desktop copy of the nav). */
function reportsNav(page: Page, basePath: '/edu' | '/app') {
  return page.locator(`a[data-sidebar="menu-button"][href="${basePath}/reports"]`);
}

/**
 * The dashboard nests the sidebar-inset `<main>` around the page's own `<main>`, so a
 * bare `main` is ambiguous and the page content is always the inner one.
 */
function content(page: Page) {
  return page.locator('main main');
}

test.describe('@case:EDU-REP-02 @area:EDU @prio:P2 reply to a question report', () => {
  test('the educator reply reaches the reporting student and the unread badge follows it', async ({
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
    const messagePosts: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/api\/v1\/question-reports\/[^/]+\/messages$/.test(new URL(request.url()).pathname)
      ) {
        messagePosts.push(request.url());
      }
    });

    // ── Tenant content: the educator's bank + question (the report's target) ──
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const bank = await ensureBank(page);
    const question = await ensureQuestion(page, bank.id);
    expect(question.created_by, 'the question belongs to the tenant educator').toBe(educator.id);
    // Everything already read: the badge below counts only this attempt's report.
    await clearUnread(page);

    // ── Prerequisite STU-39 / EDU-REP-01: the student reports the question ──
    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await clearUnread(page);
    const report = await sendData<ReportListItem>(
      page,
      'post',
      `${QUESTIONS_URL}/${question.id}/reports`,
      201,
      { message: REPORT_MESSAGE },
    );
    expect(report.teacher_id, 'the report is addressed to the question author').toBe(educator.id);
    expect(report.reported_by, 'the report comes from the tenant student').toBe(student.id);

    const studentList = await getData<ReportListResult>(page, `${REPORTS_URL}?limit=100`);
    const ownRow = studentList.items.find((item) => item.id === report.id);
    expect(ownRow, 'the report is listed for its reporter').toBeTruthy();
    expect(ownRow!.isUnread, 'a freshly written report is read for its reporter').toBe(false);

    // ── Step 1: the educator sees the report and answers it ─────────────────
    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    await page.goto('/edu/reports');
    await expect(page).toHaveURL(/\/edu\/reports$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const main = content(page);
    await expect(main.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();
    await expect(main.getByText(COPY.description, { exact: true })).toBeVisible();

    // The report row carries the question, the reporter, the date and the unread mark.
    const reportRow = main.locator(`a[href="/edu/reports/${report.id}"]`);
    await expect(reportRow, 'the educator sees the student report').toBeVisible();
    await expect(reportRow).toContainText(QUESTION_CONTENT);
    await expect(reportRow).toContainText('QA student');
    await expect(reportRow.getByText(COPY.open, { exact: true })).toBeVisible();
    await expect(reportRow.getByText(COPY.unread, { exact: true })).toBeVisible();
    await expect(
      reportRow.locator('time'),
      'the row shows when the report was last active',
    ).not.toBeEmpty();

    // „Zgłoszenia” carries exactly this one unread report.
    const teacherNav = reportsNav(page, '/edu');
    await expect(teacherNav).toBeVisible();
    await expect(teacherNav.getByText('1', { exact: true })).toBeVisible();

    // Open the thread: the original message is there and the composer is empty.
    await reportRow.click();
    await expect(page).toHaveURL(new RegExp(`/edu/reports/${report.id}$`));
    await expect(main.getByText(REPORT_MESSAGE, { exact: true })).toBeVisible();

    const textarea = page.locator('textarea');
    await expect(textarea).toHaveAttribute('placeholder', COPY.replyPlaceholder);
    await expect(textarea).toHaveValue('');
    const send = page.locator(`button[aria-label="${COPY.sendReply}"]`);
    await expect(send, 'an empty answer cannot be sent').toBeDisabled();

    // Expected result: „Pusta odpowiedź nie jest wysyłana.” — whitespace is empty too,
    // and Enter on the empty composer must not post anything.
    await textarea.fill('   ');
    await expect(send, 'a whitespace-only answer cannot be sent').toBeDisabled();
    await textarea.press('Enter');
    await page.waitForTimeout(500);
    expect(messagePosts, 'no request is sent for an empty answer').toEqual([]);
    await textarea.fill('');

    // A real answer is posted and rendered in the thread under the educator's name.
    const posted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${REPORTS_URL}/${report.id}/messages`,
    );
    await textarea.fill(REPLY);
    await send.click();
    const postedResponse = await posted;
    expect(postedResponse.status(), `POST ${REPORTS_URL}/${report.id}/messages`).toBe(201);
    const postedMessage = (await postedResponse.json()) as ApiEnvelope<ReportMessage>;
    expect(postedMessage.data.sender_id, 'the answer is authored by the educator').toBe(
      educator.id,
    );

    await expect(main.getByText(REPLY, { exact: true })).toBeVisible();
    await expect(main.getByText('QA teacher', { exact: true }).first()).toBeVisible();
    await expect(textarea, 'the composer resets after sending').toHaveValue('');

    // The thread is server state: the answer is stored between the two messages.
    const detail = await getData<ReportDetail>(page, `${REPORTS_URL}/${report.id}`);
    expect(detail.messages.map((message) => message.body)).toEqual([REPORT_MESSAGE, REPLY]);
    expect(detail.messages[1].sender_id).toBe(educator.id);
    expect(detail.report.status, 'answering an open report keeps it open').toBe('open');

    // ── Step 2: the reporting student sees the answer and the unread badge ──
    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

    const studentNav = reportsNav(page, '/app');
    await expect(studentNav).toBeVisible();
    // STU-41: the answer makes the report unread again for the reporter.
    await expect(studentNav.getByText('1', { exact: true })).toBeVisible();
    const studentUnread = await getData<{ count: number }>(page, `${REPORTS_URL}/unread-count`);
    expect(studentUnread.count, 'the student has exactly the answered report unread').toBe(1);
    const unreadRow = await getData<ReportListResult>(page, `${REPORTS_URL}?limit=100`);
    expect(
      unreadRow.items.find((item) => item.id === report.id)?.isUnread,
      'the answered report is unread for its reporter',
    ).toBe(true);

    // The answer is visible in the student's thread, next to the original message.
    await page.goto(`/app/reports/${report.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/reports/${report.id}$`));
    const studentMain = content(page);
    await expect(studentMain.getByText(REPORT_MESSAGE, { exact: true })).toBeVisible();
    await expect(studentMain.getByText(REPLY, { exact: true })).toBeVisible();
    await expect(studentMain.getByText('QA teacher', { exact: true }).first()).toBeVisible();
    await expect(studentMain.getByText(QUESTION_CONTENT, { exact: true })).toBeVisible();

    // Opening the thread marks it read: the badge disappears (STU-41).
    await expect
      .poll(async () => {
        const count = await getData<{ count: number }>(page, `${REPORTS_URL}/unread-count`);
        return count.count;
      })
      .toBe(0);
    await expect(studentNav.getByText('1', { exact: true })).toHaveCount(0);

    // The answer survives a reload — it is the thread, not a one-off client render.
    await page.reload();
    await expect(content(page).getByText(REPLY, { exact: true })).toBeVisible();
    await expect(content(page).getByText(REPORT_MESSAGE, { exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
