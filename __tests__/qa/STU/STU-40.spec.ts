import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-40 — the student's side of a question-report thread („Wątek zgłoszenia –
 * odpowiedzi”).
 *
 * Case (verbatim → tenant model): open the report from `/app/reports`, read the
 * educator's answer, write an answer in „Napisz odpowiedź…” and send it. The thread
 * shows the messages in chronological order with their authors and the new message
 * appears immediately.
 *
 * Tenant (`content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-40 --fresh
 *
 * gives the org `qa-stu-40-<suffix>` with a manager, an educator and a student, plus
 * the default group `G1`. Every id derives from
 * `tenantKey('qa/cases/STU-40.md', 'STU-40#<suffix>', 'qa-shared')` + `tenantId`, so
 * nothing global is read or written: no admin setting, feature flag, plan, platform
 * stat or singleton row, and no other worker's tenant.
 *
 * The case was written against the legacy seed (`student1@dev.local`,
 * `teacher1@dev.local`, password `pass`, bank/question `O1G1T1`). The prerequisite
 * „EDU-REP-02 — nauczyciel odpowiedział na zgłoszenie” is rebuilt inside this tenant
 * through the product API: the tenant educator owns one question bank with one open
 * question in the tenant organization, the tenant student reports that question
 * (STU-39), and the educator answers it once. The report is addressed to the
 * question's author by the product itself, not by a hard-coded recipient.
 *
 * Attempt isolation (CI seeds once and retries against the same tenant): every
 * attempt clears the stale unread receipts of both participants, then creates its
 * own report row and its own answer, so the thread it asserts on holds exactly the
 * three expected messages and the badge counts stay exact (student 1 → 0) instead of
 * accumulating across retries. The bank and its question are reused by name.
 *
 * Acceptance points (confirmed on the shared app, worker qa-env-7, before writing):
 * 1. `/app/reports` lists the report with the counterpart, the reported question, the
 *    „Otwarte” status and the unread marker; „Zgłoszenia” carries the unread badge.
 * 2. The thread header shows the counterpart, the question and the status, and the
 *    messages are rendered in chronological order with their authors.
 * 3. „Napisz odpowiedź…” is disabled while empty or whitespace-only and Enter on an
 *    empty field posts nothing.
 * 4. A real answer is posted to `POST /api/v1/question-reports/<id>/messages`,
 *    appears in the thread immediately under the student's name, clears the input and
 *    survives a reload; the educator sees the same thread.
 */

const CASE = 'STU-40';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const REPORTS_URL = '/api/v1/question-reports';

/** Polish copy from `QuestionReports` (pl.json) and the student reports screens. */
const COPY = {
  title: 'Zgłoszenia',
  description: 'Twoje zgłoszenia nieprawidłowości pytań i odpowiedzi wykładowców.',
  open: 'Otwarte',
  unread: 'Nieprzeczytane',
  replyPlaceholder: 'Napisz odpowiedź...',
  sendReply: 'Wyślij odpowiedź',
} as const;

/** Case-scoped content, reused by name so a retry never duplicates the bank/question. */
const BANK_NAME = 'STU-40 bank';
const QUESTION_CONTENT = 'STU-40: Która planeta jest największa?';
const REPORT_MESSAGE = 'Odpowiedź jest błędna';
const TEACHER_REPLY = 'Dziękuję za zgłoszenie, poprawiliśmy odpowiedź.';
const STUDENT_REPLY = 'Dziękuję za wyjaśnienie, teraz wszystko jest jasne.';

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
  updated_at: string;
  isUnread: boolean;
  reported_by: string;
  teacher_id: string;
  question: { id: string; content: string } | null;
  reporter: { id: string; full_name: string | null; email: string } | null;
  teacher: { id: string; full_name: string | null; email: string } | null;
}

interface ReportListResult {
  items: ReportListItem[];
}

interface ReportMessage {
  id: string;
  body: string;
  sender_id: string;
  created_at: string;
  sender: { id: string; full_name: string | null; email: string } | null;
}

interface ReportDetail {
  report: ReportListItem & { canResolve: boolean; canReopen: boolean };
  messages: ReportMessage[];
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
    description: 'Wątek zgłoszenia (STU-40)',
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
 * Clear every unread receipt the caller still has in this tenant. A previous attempt
 * that failed mid-thread leaves a report unread; clearing it up front keeps this
 * attempt's badge assertions exact (`1`, not „1 or more”).
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

/** The message bodies of the thread, in the order the screen renders them. */
function threadBodies(page: Page) {
  return content(page).locator('[data-slot="card"] p.whitespace-pre-wrap');
}

/** The author label above each bubble (own messages included). */
function threadAuthors(page: Page) {
  return content(page).locator('span[class*="text-[10px]"][class*="font-medium"]');
}

test.describe('@case:STU-40 @area:STU @prio:P2 student report thread replies', () => {
  test('the student answers the educator in the report thread and the message shows up at once', async ({
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
    // Everything already read: the badge below counts only this attempt's thread.
    await clearUnread(page);

    // ── Prerequisite STU-39 / EDU-REP-01+02: report the question, educator answers ──
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

    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const teacherAnswer = await sendData<ReportMessage>(
      page,
      'post',
      `${REPORTS_URL}/${report.id}/messages`,
      201,
      { body: TEACHER_REPLY },
    );
    expect(teacherAnswer.sender_id, 'the answer is authored by the educator').toBe(educator.id);
    // The educator has read the thread; the student's later answer is what turns it
    // unread for them again.
    await sendData(page, 'post', `${REPORTS_URL}/${report.id}/read`, 200, {});

    // ── Step 1: the student opens the report from the list ──────────────────
    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await page.goto('/app/reports');
    await expect(page).toHaveURL(/\/app\/reports$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const main = content(page);
    await expect(main.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();
    await expect(main.getByText(COPY.description, { exact: true })).toBeVisible();

    const reportRow = main.locator(`a[href="/app/reports/${report.id}"]`);
    await expect(reportRow, 'the answered report is listed for its reporter').toBeVisible();
    await expect(reportRow).toContainText(QUESTION_CONTENT);
    await expect(reportRow).toContainText('QA teacher');
    await expect(reportRow.getByText(COPY.open, { exact: true })).toBeVisible();
    await expect(reportRow.getByText(COPY.unread, { exact: true })).toBeVisible();
    await expect(reportRow.locator('time'), 'the row shows the last activity').not.toBeEmpty();

    // The educator's answer makes exactly this report unread for the reporter.
    const studentNav = reportsNav(page, '/app');
    await expect(studentNav).toBeVisible();
    await expect(studentNav.getByText('1', { exact: true })).toBeVisible();
    const unread = await getData<{ count: number }>(page, `${REPORTS_URL}/unread-count`);
    expect(unread.count, 'the student has exactly the answered report unread').toBe(1);

    await reportRow.click();
    await expect(page).toHaveURL(new RegExp(`/app/reports/${report.id}$`));
    // Opening the thread marks it read (STU-41).
    await expect
      .poll(async () => {
        const count = await getData<{ count: number }>(page, `${REPORTS_URL}/unread-count`);
        return count.count;
      })
      .toBe(0);
    await expect(studentNav.getByText('1', { exact: true })).toHaveCount(0);

    // ── Step 2: read the educator's answer, then answer back ────────────────
    // Header: the counterpart, the reported question and the status.
    await expect(main.getByText('QA teacher', { exact: true }).first()).toBeVisible();
    await expect(main.getByText(QUESTION_CONTENT, { exact: true }).first()).toBeVisible();
    await expect(main.getByText(COPY.open, { exact: true })).toBeVisible();

    // Expected result: the thread shows the messages in chronological order with
    // their authors.
    await expect(threadBodies(page)).toHaveText([REPORT_MESSAGE, TEACHER_REPLY]);
    await expect(threadAuthors(page)).toHaveText(['QA student', 'QA teacher']);
    await expect(main.getByText(REPORT_MESSAGE, { exact: true })).toBeVisible();
    await expect(main.getByText(TEACHER_REPLY, { exact: true })).toBeVisible();

    // Expected (prereq EDU-REP-02): „Pusta odpowiedź nie jest wysyłana.” — the
    // composer sends nothing while empty or whitespace-only, not even on Enter.
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveAttribute('placeholder', COPY.replyPlaceholder);
    await expect(textarea).toHaveValue('');
    const send = page.locator(`button[aria-label="${COPY.sendReply}"]`);
    await expect(send, 'an empty answer cannot be sent').toBeDisabled();
    await textarea.fill('   ');
    await expect(send, 'a whitespace-only answer cannot be sent').toBeDisabled();
    await textarea.press('Enter');
    await page.waitForTimeout(500);
    expect(messagePosts, 'no request is sent for an empty answer').toEqual([]);
    await textarea.fill('');

    // A real answer is posted and rendered in the thread right away, without a
    // reload, under the student's name.
    const posted = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${REPORTS_URL}/${report.id}/messages`,
    );
    await textarea.fill(STUDENT_REPLY);
    await textarea.press('Enter');
    const postedResponse = await posted;
    expect(postedResponse.status(), `POST ${REPORTS_URL}/${report.id}/messages`).toBe(201);
    const postedMessage = (await postedResponse.json()) as ApiEnvelope<ReportMessage>;
    expect(postedMessage.data.sender_id, 'the answer is authored by the student').toBe(student.id);
    expect(postedMessage.data.body).toBe(STUDENT_REPLY);

    await expect(main.getByText(STUDENT_REPLY, { exact: true })).toBeVisible();
    await expect(threadBodies(page)).toHaveText([REPORT_MESSAGE, TEACHER_REPLY, STUDENT_REPLY]);
    await expect(threadAuthors(page)).toHaveText(['QA student', 'QA teacher', 'QA student']);
    await expect(textarea, 'the composer resets after sending').toHaveValue('');
    await expect(send, 'the composer is empty again').toBeDisabled();
    await expect(page).toHaveURL(new RegExp(`/app/reports/${report.id}$`));

    // The thread is server state: the answer is stored after the educator's reply,
    // in chronological order, and answering an open report keeps it open.
    const detail = await getData<ReportDetail>(page, `${REPORTS_URL}/${report.id}`);
    expect(detail.messages.map((message) => message.body)).toEqual([
      REPORT_MESSAGE,
      TEACHER_REPLY,
      STUDENT_REPLY,
    ]);
    expect(detail.messages.map((message) => message.sender_id)).toEqual([
      student.id,
      educator.id,
      student.id,
    ]);
    const timestamps = detail.messages.map((message) => Date.parse(message.created_at));
    expect(timestamps, 'messages are stored in chronological order').toEqual(
      [...timestamps].sort((a, b) => a - b),
    );
    expect(detail.report.status, 'answering an open report keeps it open').toBe('open');

    // The answer survives a reload — it is the thread, not a one-off client render.
    await page.reload();
    await expect(threadBodies(page)).toHaveText([REPORT_MESSAGE, TEACHER_REPLY, STUDENT_REPLY]);
    await expect(main.getByText(STUDENT_REPLY, { exact: true })).toBeVisible();

    // The other side of the thread: the educator sees the student's answer too.
    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const teacherDetail = await getData<ReportDetail>(page, `${REPORTS_URL}/${report.id}`);
    expect(teacherDetail.messages.map((message) => message.body)).toEqual([
      REPORT_MESSAGE,
      TEACHER_REPLY,
      STUDENT_REPLY,
    ]);
    expect(teacherDetail.messages.at(-1)?.sender_id).toBe(student.id);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
