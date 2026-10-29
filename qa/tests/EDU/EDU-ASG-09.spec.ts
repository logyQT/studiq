import { readFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-09 — eksport odpowiedzi kartkówki („Eksportuj odpowiedzi”).
 *
 * Case steps: click „Eksportuj odpowiedzi” and open the downloaded file.
 * Acceptance: a CSV file downloads, correctly encoded (Polish characters), and its
 * content matches the results view.
 *
 * Tenant (`content` profile, deterministic ids, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-09 --fresh
 *
 * gives the org `qa-edu-asg-09-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1` (`tenantKey('qa/cases/EDU-ASG-09.md',
 * 'EDU-ASG-09#<suffix>', 'qa-shared')` + `tenantId` for every id). Nothing global
 * is read or written: no admin setting, feature flag, plan, platform stat or
 * singleton row.
 *
 * The case was written against the legacy manual seed (`teacher-classroom@dev.local`,
 * `student-classroom@dev.local`, group „Classroom Group”). In the tenant model the
 * spec builds the prerequisite — a quiz with completed attempts — through the
 * product API inside its own tenant: one bank, one multiple-choice question, one
 * assignment targeted at the tenant student, publish, then the student starts and
 * submits the attempt. Every write is idempotent and an already-completed attempt is
 * reused, so a CI retry against the same seeded tenant (`--retries=2`) starts from
 * the same state instead of depending on an earlier run.
 *
 * Acceptance points confirmed on the shared app during the walk (2026-10-29):
 * 1. `/edu/assignments/<id>` shows „Eksportuj odpowiedzi” in the „Akcje” card once
 *    the published quiz has at least one question.
 * 2. Clicking it downloads `assignment-<id>-answers.csv` with
 *    `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment`.
 * 3. The file is UTF-8 with a BOM (`EF BB BF`), so Excel renders the Polish header
 *    „Uczeń … Ukończono” and the status „Przesłane” instead of mojibake.
 * 4. Header and the student's row equal the `/edu/assignments/<id>/results` table:
 *    student name, e-mail, score, status and completion date (the browser timezone
 *    is forwarded to the export so the date matches the view).
 * 5. A student cannot download the class export (PII): the endpoint answers 403.
 */

const CASE = 'EDU-ASG-09';

/** Polish copy from `EduAssignmentDetailPage` / `EduAssignmentResultsPage`. */
const COPY = {
  resultsTitle: 'Wyniki',
  resultsSubtitle: 'Wyniki uczniów i status ukończenia',
  exportAnswers: 'Eksportuj odpowiedzi',
  headerStudent: 'Uczeń',
  headerEmail: 'E-mail',
  headerScore: 'Wynik',
  headerStatus: 'Status',
  headerCompletedAt: 'Ukończono',
  submitted: 'Przesłane',
} as const;

/** The quiz the spec prepares in its own tenant; names are case-scoped. */
const BANK_NAME = 'EDU-ASG-09 bank';
const QUESTION_CONTENT = 'Które miasto jest stolicą Polski?';
const CORRECT_ANSWER = 'Warszawa';
const ASSIGNMENT_TITLE = 'EDU-ASG-09 kartkówka';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const TEACHER_ASSIGNMENTS_URL = '/api/v1/teacher/assignments';
const STUDENT_ASSIGNMENTS_URL = '/api/v1/assignments';
const QUIZ_URL = '/api/v1/quiz';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankListResult {
  items: Array<{ id: string; name: string }>;
}

interface Question {
  id: string;
  content: string;
}

interface AssignmentSummary {
  id: string;
  title: string;
  status: 'draft' | 'published';
}

interface AssignmentDetail extends AssignmentSummary {
  assignment_questions: Array<{ question_id: string }>;
}

interface StudentAssignment extends AssignmentSummary {
  attempt: { id: string; completed_at: string | null } | null;
  last_completed_attempt: { id: string; completed_at: string | null } | null;
  attempts_used: number;
}

interface AttemptForTake {
  id: string;
  questions: Array<{
    id: string;
    content: string;
    question_answers: Array<{ id: string; content: string }>;
  }>;
}

interface ResultRow {
  user_id: string;
  score: number;
  total_questions: number;
  total_points: number | null;
  completed_at: string | null;
  graded_at: string | null;
  user: { id: string; email: string; full_name: string };
}

/** Send one product-API request and unwrap the `{ success, data }` envelope. */
async function api<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(url, { method, data });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok() || !body.success) {
    throw new Error(`${method} ${url} → ${response.status()} ${JSON.stringify(body)}`);
  }
  return body.data;
}

/**
 * The tenant's bank for this case. Reused when it already exists, so a re-run on
 * the same seeded tenant (CI retries) does not pile up duplicates.
 */
async function ensureBank(page: Page): Promise<string> {
  const banks = await api<BankListResult>(page.request, 'GET', `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
  if (existing) return existing.id;

  const created = await api<{ id: string }>(page.request, 'POST', BANKS_URL, {
    name: BANK_NAME,
    description: 'Kartkówka dla EDU-ASG-09',
  });
  return created.id;
}

/** One multiple-choice question in the case's bank, reused when it already exists. */
async function ensureQuestion(page: Page, bankId: string): Promise<string> {
  const questions = await api<Question[]>(page.request, 'GET', `${QUESTIONS_URL}?bankId=${bankId}`);
  const existing = questions.find((question) => question.content === QUESTION_CONTENT);
  if (existing) return existing.id;

  const created = await api<Question>(page.request, 'POST', QUESTIONS_URL, {
    bankId,
    type: 'mcq',
    content: QUESTION_CONTENT,
    answers: [
      { content: CORRECT_ANSWER, isCorrect: true, orderIndex: 0 },
      { content: 'Kraków', isCorrect: false, orderIndex: 1 },
    ],
  });
  return created.id;
}

/**
 * Prepare the case's prerequisite: a published assignment targeted at the tenant
 * student. Every write is idempotent — an earlier failed run's assignment is reused
 * and republished, so CI retries start from the same published state.
 */
async function preparePublishedAssignment(page: Page, studentId: string): Promise<string> {
  const bankId = await ensureBank(page);
  const questionId = await ensureQuestion(page, bankId);

  const assignments = await api<AssignmentSummary[]>(page.request, 'GET', TEACHER_ASSIGNMENTS_URL);
  let assignment = assignments.find((candidate) => candidate.title === ASSIGNMENT_TITLE);
  if (!assignment) {
    assignment = await api<AssignmentSummary>(page.request, 'POST', TEACHER_ASSIGNMENTS_URL, {
      title: ASSIGNMENT_TITLE,
    });
  }

  const detail = await api<AssignmentDetail>(
    page.request,
    'GET',
    `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}`,
  );
  if (!detail.assignment_questions.some((row) => row.question_id === questionId)) {
    await api(page.request, 'POST', `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}/questions`, {
      questionIds: [questionId],
    });
  }

  await api(page.request, 'PUT', `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}/targets`, {
    studentIds: [studentId],
  });
  if (assignment.status !== 'published') {
    await api(page.request, 'POST', `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}/publish`, {});
  }

  const published = await api<AssignmentDetail>(
    page.request,
    'GET',
    `${TEACHER_ASSIGNMENTS_URL}/${assignment.id}`,
  );
  expect(published.status, 'the prerequisite quiz is published').toBe('published');
  return assignment.id;
}

async function findStudentAssignment(page: Page, assignmentId: string): Promise<StudentAssignment> {
  const assignments = await api<StudentAssignment[]>(page.request, 'GET', STUDENT_ASSIGNMENTS_URL);
  const found = assignments.find((assignment) => assignment.id === assignmentId);
  if (!found) throw new Error(`assignment ${assignmentId} is not visible to the tenant student`);
  return found;
}

/**
 * Complete the quiz as the student, or reuse the completed attempt an earlier run
 * left behind. A submitted attempt is never re-created (the quiz allows one
 * attempt), so this stays green when CI retries the spec on the same tenant.
 */
async function ensureCompletedAttempt(page: Page, assignmentId: string): Promise<void> {
  let assignment = await findStudentAssignment(page, assignmentId);
  if (assignment.last_completed_attempt) return;

  if (!assignment.attempt) {
    await api(page.request, 'POST', `${STUDENT_ASSIGNMENTS_URL}/${assignmentId}/start`);
    assignment = await findStudentAssignment(page, assignmentId);
    if (!assignment.attempt) {
      throw new Error('the student attempt was not created');
    }
  }

  const attempt = await api<AttemptForTake>(
    page.request,
    'GET',
    `${QUIZ_URL}/${assignment.attempt.id}`,
  );
  const answers = attempt.questions.map((question) => {
    const correct = question.question_answers.find((answer) => answer.content === CORRECT_ANSWER);
    const selected = correct ?? question.question_answers[0];
    if (!selected) throw new Error(`question ${question.id} has no answers to submit`);
    return { questionId: question.id, selectedAnswerId: selected.id };
  });
  await api(page.request, 'POST', `${QUIZ_URL}/${attempt.id}`, { answers });

  const after = await findStudentAssignment(page, assignmentId);
  if (!after.last_completed_attempt) {
    throw new Error('the student attempt was not completed');
  }
}

/** RFC 4180 parser — the export quotes cells containing commas, quotes or breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

test.describe('@case:EDU-ASG-09 @area:EDU @prio:P2 export quiz answers', () => {
  test('„Eksportuj odpowiedzi” downloads a UTF-8 CSV that matches the results view', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!student) {
      throw new Error(`${CASE} needs the content tenant profile (org, group and student)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: a published quiz with a completed attempt ------------
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const assignmentId = await preparePublishedAssignment(page, student.id);

    const studentContext = await browser.newContext({ baseURL });
    const studentPage = await studentContext.newPage();
    try {
      await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
      await ensureCompletedAttempt(studentPage, assignmentId);

      // --- Baseline: the results view the export must match -----------------
      await page.goto(`/edu/assignments/${assignmentId}/results`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
      await expect(
        page.getByRole('heading', { name: COPY.resultsTitle, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(COPY.resultsSubtitle, { exact: true }),
        'the results subtitle describes the same summary the CSV exports',
      ).toBeVisible();

      const row = page.locator('tbody tr').filter({ hasText: student.email });
      await expect(row, 'the completed attempt is listed once').toHaveCount(1);
      const cells = row.locator('td');
      await expect(cells.nth(3)).toHaveText(COPY.submitted);
      await expect(cells.nth(4)).not.toHaveText('-');

      const viewRow = {
        name: (await cells.nth(0).innerText()).trim(),
        email: (await cells.nth(1).innerText()).trim(),
        score: (await cells.nth(2).innerText()).trim(),
        status: (await cells.nth(3).innerText()).trim(),
        completedAt: (await cells.nth(4).innerText()).trim(),
      };
      // Cross-check the view against the teacher API payload, so the baseline is
      // both what a teacher reads and what the export is built from.
      const results = await api<ResultRow[]>(
        page.request,
        'GET',
        `${TEACHER_ASSIGNMENTS_URL}/${assignmentId}/results`,
      );
      const attempt = results.find((result) => result.user_id === student.id);
      expect(attempt, 'the results API lists the tenant student').toBeDefined();
      expect(viewRow.name).toBe(attempt!.user.full_name);
      expect(viewRow.email).toBe(attempt!.user.email);
      expect(viewRow.score).toBe(
        `${attempt!.score}/${attempt!.total_points || attempt!.total_questions}`,
      );

      // --- Step 1: click „Eksportuj odpowiedzi” on the quiz detail ----------
      await page.goto(`/edu/assignments/${assignmentId}`);
      await expect(
        page.getByRole('heading', { name: ASSIGNMENT_TITLE, exact: true }),
      ).toBeVisible();

      const exportLink = page.getByRole('link', { name: COPY.exportAnswers, exact: true });
      await expect(exportLink).toBeVisible();
      // The detail screen forwards the browser timezone so the CSV date matches
      // the results view; the value must be present before the click.
      await expect(exportLink).toHaveAttribute(
        'href',
        new RegExp(
          `^/api/v1/teacher/assignments/${assignmentId}/export-answers\\?tz=[A-Za-z/_+\\-]+$`,
        ),
      );

      // The API-level response carries the file headers the browser download uses.
      const headers = await page.request.get(
        `${TEACHER_ASSIGNMENTS_URL}/${assignmentId}/export-answers`,
      );
      expect(headers.status(), 'GET …/export-answers').toBe(200);
      expect(headers.headers()['content-type']).toBe('text/csv; charset=utf-8');
      expect(headers.headers()['content-disposition']).toBe(
        `attachment; filename="assignment-${assignmentId}-answers.csv"`,
      );
      expect(headers.headers()['cache-control']).toBe('private, no-store');

      const [download] = await Promise.all([page.waitForEvent('download'), exportLink.click()]);
      expect(download.suggestedFilename()).toBe(`assignment-${assignmentId}-answers.csv`);

      // --- Step 2: open the downloaded file ---------------------------------
      const file = readFileSync(await download.path());
      // UTF-8 BOM: Excel on Windows needs it to render „Uczeń”/„Ukończono”.
      expect([...file.subarray(0, 3)], 'the CSV starts with a UTF-8 BOM').toEqual([
        0xef, 0xbb, 0xbf,
      ]);
      // Strict decoding fails on mojibake/invalid sequences.
      const csv = new TextDecoder('utf-8', { fatal: true }).decode(file.subarray(3));
      const rows = parseCsv(csv);

      expect(rows[0], 'the CSV header matches the results table').toEqual([
        COPY.headerStudent,
        COPY.headerEmail,
        COPY.headerScore,
        COPY.headerStatus,
        COPY.headerCompletedAt,
      ]);
      expect(rows, 'one data row per completed attempt').toHaveLength(2);

      const csvRow = rows[1];
      expect(csvRow, 'the CSV row is the tenant student').toEqual([
        viewRow.name,
        viewRow.email,
        viewRow.score,
        viewRow.status,
        viewRow.completedAt,
      ]);
      // The Polish characters survive the round-trip in both header and status.
      expect(csv).toContain(COPY.headerStudent);
      expect(csv).toContain(COPY.headerCompletedAt);
      expect(csv).toContain(COPY.submitted);

      // --- Adjacent regression path: the export is teacher-only (student PII) --
      const denied = await studentPage.request.get(
        `${TEACHER_ASSIGNMENTS_URL}/${assignmentId}/export-answers`,
      );
      expect(denied.status(), 'a student cannot export the class answers').toBe(403);
      expect((await denied.json()) as { error?: string }).toMatchObject({ error: 'FORBIDDEN' });
    } finally {
      await studentContext.close();
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
