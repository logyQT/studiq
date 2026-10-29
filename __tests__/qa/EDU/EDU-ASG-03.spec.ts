import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-03 — Dodawanie pytań – losowanie (`/edu/assignments/:id`).
 *
 * Case steps: in a draft assignment pick the source bank „Geografia i Nauka”, types WW
 * and P/F, count 3, click „Losuj” → „Dodaj wylosowane”; then set the count to 0 and try
 * to draw.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-03 --fresh
 *
 * gives the org `qa-edu-asg-03-<suffix>` with a manager, an educator and a student, plus
 * the default group `G1` (`tenantKey('qa/cases/EDU-ASG-03.md', 'EDU-ASG-03#<suffix>',
 * 'qa-shared')` + `tenantId` for every id). The legacy manual accounts
 * (`teacher-classroom@dev.local`, password `pass`) are never used.
 *
 * Prerequisite „szkic kartkówki; bank z ≥ 6 pytaniami” is built by the spec through the
 * product API as the tenant teacher, idempotently: bank „EDU-ASG-03 bank” with exactly six
 * questions (2 × WW/`mcq`, 2 × P/F/`true_false`, 2 × open) and one draft assignment
 * „EDU-ASG-03 kartkówka” with no questions. Both are recreated on every run, so a retry
 * against the same tenant (CI seeds once) starts from the same state. Every row carries
 * this tenant's `organization_id` and the teacher's `created_by`, so the draw pool cannot
 * see another worker's questions. Nothing global is read or written: no admin setting,
 * feature flag, plan, platform stat or singleton row.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. The draft starts empty („Brak pytań”).
 * 2. „Losuj” opens the „Losuj” dialog with the source radios, the bank select, the three
 *    type checkboxes, the „Liczba” input and the draw action „Dodaj wylosowane”.
 * 3. Drawing 3 from the bank with WW + P/F adds exactly 3 questions, all `mcq` /
 *    `true_false` and all from that bank, with no duplicates.
 * 4. A second draw with the same filters adds only the one still-unused eligible question
 *    (4 of 4) — never a duplicate.
 * 5. At „Liczba” 0 the draw action is disabled and the API rejects the same request with
 *    422.
 *
 * Copy note (P3, not a defect): the case's expected result names the „Losuj” button as the
 * one that is inactive for a number below 1. The number only exists inside the dialog the
 * „Losuj” trigger opens, so the control that can be disabled is the draw action
 * „Dodaj wylosowane”; the page-level „Losuj” trigger only opens the dialog and stays
 * enabled. That is the behaviour asserted here, together with the API's 422.
 */

const CASE = 'EDU-ASG-03';
const BANK_NAME = 'EDU-ASG-03 bank';
const ASSIGNMENT_TITLE = 'EDU-ASG-03 kartkówka';

/** Polish copy from `EduAssignmentDetailPage` (pl.json). */
const COPY = {
  trigger: 'Losuj',
  sourceBank: 'Bank pytań',
  typeMcq: 'Wielokrotny wybór',
  typeTrueFalse: 'Prawda/Fałsz',
  typeOpen: 'Otwarte',
  draw: 'Dodaj wylosowane',
  back: 'Powrót do kartkówek',
  empty: 'Brak pytań',
} as const;

/** The case's six-question bank; only the WW/P-F rows are eligible for the draw. */
const QUESTIONS = [
  { type: 'mcq', content: 'EDU-ASG-03 WW 1' },
  { type: 'mcq', content: 'EDU-ASG-03 WW 2' },
  { type: 'true_false', content: 'EDU-ASG-03 P/F 1' },
  { type: 'true_false', content: 'EDU-ASG-03 P/F 2' },
  { type: 'open', content: 'EDU-ASG-03 otwarte 1' },
  { type: 'open', content: 'EDU-ASG-03 otwarte 2' },
] as const;

const ANSWERS: Record<string, { content: string; isCorrect: boolean; orderIndex: number }[]> = {
  mcq: [
    { content: 'Odpowiedź poprawna', isCorrect: true, orderIndex: 0 },
    { content: 'Odpowiedź błędna', isCorrect: false, orderIndex: 1 },
  ],
  true_false: [
    { content: 'Prawda', isCorrect: true, orderIndex: 0 },
    { content: 'Fałsz', isCorrect: false, orderIndex: 1 },
  ],
  open: [],
};

/** The eligible draw pool: the four WW/P-F questions of the bank. */
const ELIGIBLE_TYPES = ['mcq', 'true_false'] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankRow {
  id: string;
  name: string;
}

interface QuestionRow {
  id: string;
  bank_id: string;
  type: 'mcq' | 'true_false' | 'open';
  content: string;
}

interface AssignmentRow {
  id: string;
  title: string;
  status: string;
}

interface AssignmentQuestionRow {
  id: string;
  question_id: string;
  order_index: number;
  points: number;
  question: QuestionRow;
}

interface AssignmentDetail extends AssignmentRow {
  question_count: number;
  assignment_questions: AssignmentQuestionRow[];
}

/** `GET` an endpoint as the signed-in teacher and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `POST` an endpoint and unwrap the response envelope. */
async function postData<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  expect(response.ok(), `POST ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

/** `DELETE` an endpoint, asserting the product accepted it. */
async function deleteResource(page: Page, url: string): Promise<void> {
  const response = await page.request.delete(url);
  expect(response.ok(), `DELETE ${url} → ${response.status()} ${await response.text()}`).toBe(true);
}

/** The draft assignment detail — the same payload the page renders. */
async function readAssignment(page: Page, id: string): Promise<AssignmentDetail> {
  return getData<AssignmentDetail>(page, `/api/v1/teacher/assignments/${id}`);
}

/**
 * Rebuild the case's fixture from scratch: drop the previous run's draft assignment (its
 * questions are removed with it), then the bank's questions, then recreate both. Deleting
 * the assignment first keeps the question deletes free of foreign-key references, so a
 * retry on the same tenant never sees leftovers from the previous attempt.
 */
async function prepareFixture(
  page: Page,
): Promise<{ bank: BankRow; questions: QuestionRow[]; assignment: AssignmentRow }> {
  const assignments = await getData<AssignmentRow[]>(page, '/api/v1/teacher/assignments');
  for (const existing of assignments.filter((row) => row.title === ASSIGNMENT_TITLE)) {
    await deleteResource(page, `/api/v1/teacher/assignments/${existing.id}`);
  }

  const banks = await getData<{ items: BankRow[] }>(
    page,
    '/api/v1/questions/banks?limit=100&owner=mine',
  );
  const bank =
    banks.items.find((row) => row.name === BANK_NAME) ??
    (await postData<BankRow>(page, '/api/v1/questions/banks', {
      name: BANK_NAME,
      description: 'EDU-ASG-03 draw fixture',
    }));

  const previous = await getData<QuestionRow[]>(page, `/api/v1/questions?bankId=${bank.id}`);
  for (const question of previous) {
    await deleteResource(page, `/api/v1/questions/${question.id}`);
  }

  const questions: QuestionRow[] = [];
  for (const question of QUESTIONS) {
    questions.push(
      await postData<QuestionRow>(page, '/api/v1/questions', {
        bankId: bank.id,
        type: question.type,
        content: question.content,
        answers: ANSWERS[question.type],
      }),
    );
  }

  const assignment = await postData<AssignmentRow>(page, '/api/v1/teacher/assignments', {
    title: ASSIGNMENT_TITLE,
    description: 'EDU-ASG-03 draft',
  });

  return { bank, questions, assignment };
}

/** The „Losuj” dialog (Radix `DialogContent`). */
function randomizeDialog(page: Page): Locator {
  return page.getByRole('dialog');
}

/** The summary counter card: the „Pytania” card whose text is exactly `Pytania <n>`. */
function questionCounter(page: Page): Locator {
  // `hasText` matches the element's `textContent`, where the title and the value are
  // adjacent ("Pytania0"); the list/action cards carry extra text and do not match.
  return page.locator('[data-slot="card"]').filter({ hasText: /^Pytania\s*\d+$/ });
}

/** The counter's value (`<p>{assignment.question_count}</p>` inside the summary card). */
async function expectQuestionCounter(page: Page, count: number): Promise<void> {
  await expect(questionCounter(page).locator('[data-slot="card-content"] p')).toHaveText(
    String(count),
  );
}

/** The draft question list: the only card carrying type badges. */
function questionListCard(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="badge"]') });
}

/** Open the draw dialog through the page's own „Losuj” trigger. */
async function openRandomize(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: COPY.trigger, exact: true }).click();
  const dialog = randomizeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: COPY.trigger, exact: true })).toBeVisible();
  return dialog;
}

/** `setChecked` without toggling: the dialog keeps its state between openings. */
async function setChecked(box: Locator, checked: boolean): Promise<void> {
  if ((await box.isChecked()) !== checked) await box.setChecked(checked);
}

/**
 * Fill the dialog with the case's filters: source „Bank pytań”, the case bank, types WW
 * and P/F (open unchecked) and the requested count. Explicit on every opening, so the
 * assertion never depends on the state the previous draw left behind.
 */
async function fillDraw(dialog: Locator, count: number): Promise<void> {
  await dialog.getByRole('radio', { name: COPY.sourceBank, exact: true }).check();
  await dialog.locator('select').selectOption({ label: BANK_NAME });
  await setChecked(dialog.getByRole('checkbox', { name: COPY.typeMcq, exact: true }), true);
  await setChecked(dialog.getByRole('checkbox', { name: COPY.typeTrueFalse, exact: true }), true);
  await setChecked(dialog.getByRole('checkbox', { name: COPY.typeOpen, exact: true }), false);
  await dialog.locator('input[type="number"]').fill(String(count));
}

/** Click the draw action and return the endpoint's `added` count. */
async function draw(page: Page, dialog: Locator, assignmentId: string): Promise<number> {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/v1/teacher/assignments/${assignmentId}/randomize`,
  );
  await dialog.getByRole('button', { name: COPY.draw, exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), 'POST randomize').toBe(200);
  const body = (await response.json()) as ApiEnvelope<{ added: number }>;
  expect(body.success, 'POST randomize success flag').toBe(true);
  await expect(dialog).toBeHidden();
  return body.data.added;
}

/** Wait until the assignment holds `count` questions and return its detail. */
async function expectQuestionCount(
  page: Page,
  assignmentId: string,
  count: number,
): Promise<AssignmentDetail> {
  await expect
    .poll(async () => (await readAssignment(page, assignmentId)).assignment_questions.length, {
      timeout: 15_000,
      message: `assignment holds ${count} questions`,
    })
    .toBe(count);
  return readAssignment(page, assignmentId);
}

test.describe('@case:EDU-ASG-03 @area:EDU @prio:P2 draft assignment random draw', () => {
  test('draws N questions of the selected types from the selected bank, without duplicates', async ({
    page,
  }) => {
    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    if (!tenant.org || !tenant.users.teacher) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const { bank, questions, assignment } = await prepareFixture(page);

    // --- Step 0: the draft starts empty -------------------------------------
    await page.goto(`/edu/assignments/${assignment.id}`);
    await expect(page).toHaveURL(new RegExp(`/edu/assignments/${assignment.id}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { name: ASSIGNMENT_TITLE, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.empty, { exact: true })).toBeVisible();
    await expectQuestionCounter(page, 0);
    await expect(questionListCard(page)).toHaveCount(0);

    // --- Step 1 + 2: source bank, WW + P/F, count 3, draw -------------------
    const dialog = await openRandomize(page);
    await fillDraw(dialog, 3);
    await expect(dialog.getByRole('button', { name: COPY.draw, exact: true })).toBeEnabled();
    expect(await draw(page, dialog, assignment.id), 'the first draw adds the requested 3').toBe(3);

    const first = await expectQuestionCount(page, assignment.id, 3);
    const firstIds = first.assignment_questions.map((row) => row.question_id);
    const bankQuestionIds = new Set(questions.map((question) => question.id));

    // Exactly N, of the selected types, from the selected bank, never duplicated.
    expect(new Set(firstIds).size, 'no duplicate question ids').toBe(3);
    for (const row of first.assignment_questions) {
      expect(bankQuestionIds.has(row.question_id), `${row.question_id} belongs to the bank`).toBe(
        true,
      );
      expect(row.question.bank_id, 'question comes from the selected bank').toBe(bank.id);
      expect(
        ELIGIBLE_TYPES,
        `question type ${row.question.type} is one of the selected types`,
      ).toContain(row.question.type);
    }

    // The screen renders that same set: the counter, three type badges and the contents.
    await expectQuestionCounter(page, 3);
    const listCard = questionListCard(page);
    await expect(listCard).toHaveCount(1);
    const badges = listCard.locator('[data-slot="badge"]');
    await expect(badges, 'one badge per drawn question').toHaveCount(3);
    for (const badge of await badges.allInnerTexts()) {
      expect(ELIGIBLE_TYPES, `badge ${badge}`).toContain(badge.trim());
    }
    for (const row of first.assignment_questions) {
      await expect(
        listCard.getByText(row.question.content, { exact: true }),
        `drawn question "${row.question.content}" is listed`,
      ).toBeVisible();
    }

    // --- Step 2b: drawing again must not duplicate a question ---------------
    // The bank has exactly four WW/P-F questions, so the second draw can only add the
    // one still unused: 4 of 4, all distinct.
    const secondDialog = await openRandomize(page);
    await fillDraw(secondDialog, 3);
    expect(await draw(page, secondDialog, assignment.id), 'only the unused question is left').toBe(
      1,
    );

    const second = await expectQuestionCount(page, assignment.id, 4);
    const secondIds = second.assignment_questions.map((row) => row.question_id);
    expect(new Set(secondIds).size, 'no duplicate question ids after the second draw').toBe(4);
    for (const id of firstIds) {
      expect(secondIds, `the second draw kept the earlier question ${id}`).toContain(id);
    }
    for (const row of second.assignment_questions) {
      expect(bankQuestionIds.has(row.question_id), `${row.question_id} belongs to the bank`).toBe(
        true,
      );
      expect(ELIGIBLE_TYPES).toContain(row.question.type);
    }
    await expectQuestionCounter(page, 4);
    await expect(questionListCard(page).locator('[data-slot="badge"]')).toHaveCount(4);

    // --- Step 3: a count below 1 cannot draw -------------------------------
    const zeroDialog = await openRandomize(page);
    await fillDraw(zeroDialog, 0);
    const drawButton = zeroDialog.getByRole('button', { name: COPY.draw, exact: true });
    await expect(drawButton, '„Dodaj wylosowane” is inactive at „Liczba” 0').toBeDisabled();

    // The same rule on the API: the request is rejected, not silently executed.
    const rejected = await page.request.post(
      `/api/v1/teacher/assignments/${assignment.id}/randomize`,
      {
        data: {
          source: 'bank',
          sourceId: bank.id,
          count: 0,
          types: ['mcq', 'true_false'],
        },
      },
    );
    expect(rejected.status(), 'randomize with count 0').toBe(422);
    const rejectedBody = (await rejected.json()) as { success: boolean; error: string };
    expect(rejectedBody.success).toBe(false);
    expect(rejectedBody.error).toBe('UNPROCESSABLE_ENTITY');

    await zeroDialog.getByRole('button', { name: COPY.back, exact: true }).click();
    await expect(zeroDialog).toBeHidden();

    // Nothing was added by the blocked attempt.
    const final = await expectQuestionCount(page, assignment.id, 4);
    expect(final.assignment_questions.map((row) => row.question_id)).toEqual(secondIds);
    await expectQuestionCounter(page, 4);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
