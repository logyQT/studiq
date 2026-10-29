import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-10 — printing an assignment („kartkówka”) and its answer key.
 *
 * Case steps: open the assignment and click „Drukuj” / „Drukuj pusty test”,
 * check that the print view carries the name/class/date fields, the points next
 * to each question and the answer key, then use Ctrl+P → „Zapisz jako PDF”.
 * Expected result: a print-optimised view with the „Użyj Ctrl+P…” hint, fields
 * that follow the print settings, an open question marked „(pytanie otwarte)”,
 * and the answer key on its own page when it is enabled.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-10 --fresh
 *
 * gives the org `qa-edu-asg-10-<suffix>` with a manager, an educator and a
 * student, plus the default group `G1`
 * (`tenantKey('qa/cases/EDU-ASG-10.md', 'EDU-ASG-10#<suffix>', 'qa-shared')` +
 * `tenantId` for every id). The case's legacy account (`teacher-classroom@dev.local`)
 * is never used. Nothing global is read or written: no admin setting, feature
 * flag, plan, platform stat or singleton row.
 *
 * The case's prerequisite („Kartkówka z pytaniami”) is built by the spec through
 * the same API the product uses: a personal bank with one multiple-choice, one
 * true/false and one open question, attached to a fresh draft assignment. Every
 * assertion follows the ids returned by those calls, so a re-run on the same
 * tenant (CI seeds once and retries against it) only adds assignments the
 * assertions do not depend on. Print settings live in the browser's
 * `localStorage` (`assignment-print-settings`, the key the „Ustawienia
 * drukowania” page writes), so each test starts from an empty context and never
 * inherits another case's settings.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. The detail page offers „Drukuj” and, because the assignment has questions,
 *    „Drukuj pusty test”; both open `/edu/assignments/<id>/print`.
 * 2. The print view shows the „Ta strona jest zoptymalizowana do druku. Użyj
 *    Ctrl+P (Cmd+P), aby zapisać jako PDF.” hint, the title, the description, the
 *    „Razem: N punktów” total, the „Imię i nazwisko:” / „Klasa:” / „Data:” lines,
 *    the numbered questions with „1 pkt” next to each, choice bubbles for the
 *    closed questions and three answer lines for the open one.
 * 3. The answer key lists the correct option per question and marks the open one
 *    „(pytanie otwarte)”; under print media the hint, the dashboard sidebar and
 *    the dashboard header disappear, the key starts on a new page („break-before:
 *    page”), and the saved PDF really has the key on its own page (two pages).
 * 4. The switches on „Ustawienia drukowania” drive the print view: with all five
 *    on (the documented defaults) every field and the key are printed, and after
 *    turning them all off and saving, none of the fields, the per-question
 *    „pkt” labels or the key is rendered while the questions stay.
 */

const CASE = 'EDU-ASG-10';

/** How long a run may take: two assignments, two settings saves, two walks. */
const RUN_TIMEOUT = 150_000;

/** Polish copy from `EduAssignmentPrintPage` / `EduAssignmentSettingsPage` (pl.json). */
const COPY = {
  printButton: 'Drukuj',
  printBlankButton: 'Drukuj pusty test',
  printHint: 'Ta strona jest zoptymalizowana do druku. Użyj Ctrl+P (Cmd+P), aby zapisać jako PDF.',
  name: 'Imię i nazwisko:',
  className: 'Klasa:',
  date: 'Data:',
  answerKey: 'Klucz odpowiedzi',
  openQuestion: '(pytanie otwarte)',
  points: '1 pkt',
  settingsTitle: 'Ustawienia drukowania',
  saveSettings: 'Zapisz ustawienia',
  settingsSaved: 'Ustawienia zapisane',
} as const;

/** The switches on the settings page, in the order the page renders them. */
const SWITCHES = {
  name: 'Pole imienia i nazwiska',
  className: 'Pole klasy',
  date: 'Pole daty',
  points: 'Punkty za pytanie',
  answerKey: 'Klucz odpowiedzi',
} as const;

const DESCRIPTION = 'Sprawdzian wiadomości o Układzie Słonecznym';

/** Per-run suffix: unique titles keep two runs on the same tenant apart. */
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? Date.now().toString(36);

const ASSIGNMENTS_URL = '/api/v1/teacher/assignments';
const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';

interface PrintAssignment {
  id: string;
  title: string;
  questions: {
    mcq: { content: string; answers: string[]; correct: string };
    trueFalse: { content: string; answers: string[]; correct: string };
    open: { content: string };
  };
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

async function postJson<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.status(), `POST ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.status(), `GET ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(200);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/**
 * Found-or-created personal bank. The educator's plan caps question banks
 * (`max_question_banks`), so a CI retry against the same tenant must reuse the
 * bank this run already created instead of spending another slot.
 */
async function ensureBank(page: Page, name: string): Promise<{ id: string }> {
  const list = await getData<{ items: Array<{ id: string; name: string }> }>(
    page,
    `${BANKS_URL}?limit=100`,
  );
  const existing = list.items.find((bank) => bank.name === name);
  if (existing) return existing;
  return postJson<{ id: string }>(page, BANKS_URL, { name, visibility: 'personal' });
}

/**
 * Builds the case prerequisite: a bank with the three question types the print
 * view renders differently (bubbles, checkboxes, answer lines), attached to a
 * fresh draft assignment. Everything is addressed by the returned ids.
 *
 * The bank and its questions are reused within one run (same `RUN_SUFFIX`), so a
 * retry only adds a new assignment — it never hits the educator's question or
 * bank caps. The independent runs of the admission gate each seed a fresh
 * tenant, so they start from an empty quota.
 */
async function createAssignmentWithQuestions(page: Page, label: string): Promise<PrintAssignment> {
  const title = `Kartkówka wydruk ${label} ${RUN_SUFFIX}`;
  const bank = await ensureBank(page, `Bank wydruku EDU-ASG-10 ${RUN_SUFFIX}`);

  const mcq = {
    content: `Która planeta jest najbliżej Słońca? (${RUN_SUFFIX})`,
    answers: ['Merkury', 'Wenus'],
    correct: 'Merkury',
  };
  const trueFalse = {
    content: `Słońce jest gwiazdą. (${RUN_SUFFIX})`,
    answers: ['Prawda', 'Fałsz'],
    correct: 'Prawda',
  };
  const open = { content: `Opisz Układ Słoneczny. (${RUN_SUFFIX})` };

  const existingQuestions = await getData<Array<{ id: string; content: string }>>(
    page,
    `${QUESTIONS_URL}?bankId=${bank.id}`,
  );

  const questionIds: string[] = [];
  for (const question of [
    {
      type: 'mcq',
      content: mcq.content,
      answers: mcq.answers.map((content, index) => ({
        content,
        isCorrect: content === mcq.correct,
        orderIndex: index,
      })),
    },
    {
      type: 'true_false',
      content: trueFalse.content,
      answers: trueFalse.answers.map((content, index) => ({
        content,
        isCorrect: content === trueFalse.correct,
        orderIndex: index,
      })),
    },
    { type: 'open', content: open.content, answers: [] },
  ]) {
    const existing = existingQuestions.find((row) => row.content === question.content);
    const created =
      existing ??
      (await postJson<{ id: string }>(page, QUESTIONS_URL, { bankId: bank.id, ...question }));
    questionIds.push(created.id);
  }

  const assignment = await postJson<{ id: string; status: string; question_count: number }>(
    page,
    ASSIGNMENTS_URL,
    { title, description: DESCRIPTION },
  );
  expect(assignment.status, 'a freshly created assignment is a draft').toBe('draft');

  const attached = await page.request.post(`${ASSIGNMENTS_URL}/${assignment.id}/questions`, {
    data: { questionIds },
  });
  expect(
    attached.status(),
    `POST ${ASSIGNMENTS_URL}/${assignment.id}/questions → ${attached.status()} ${await attached.text()}`,
  ).toBe(200);

  const detail = await page.request.get(`${ASSIGNMENTS_URL}/${assignment.id}`);
  expect(detail.status(), 'the seeded assignment is readable').toBe(200);
  const detailBody = (await detail.json()) as ApiEnvelope<{ question_count: number }>;
  expect(detailBody.data.question_count, 'all three questions are attached').toBe(3);

  return {
    id: assignment.id,
    title,
    questions: { mcq, trueFalse, open },
  };
}

/** A question block in the print view, addressed by its own content. */
function questionBlock(page: Page, content: string) {
  return page.locator('.question-block').filter({ hasText: content });
}

/**
 * Page count of a Chromium PDF. The generated file keeps the page-tree
 * `/Count` token uncompressed, so the head of the tree is visible in the bytes.
 * Used to prove the answer key really starts on its own page instead of trusting
 * the CSS rule alone (a scroll ancestor can suppress `break-before`, #194).
 */
function pdfPageCount(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  return counts.length > 0 ? Math.max(...counts) : 0;
}

/** The settings row that owns a switch, so a toggle is never picked by index. */
function settingsRow(page: Page, label: string) {
  return page.locator('div.flex.items-center.justify-between').filter({ hasText: label });
}

async function setSwitch(page: Page, label: string, on: boolean): Promise<void> {
  const row = settingsRow(page, label);
  await expect(row, `settings row “${label}” is unique`).toHaveCount(1);
  const toggle = row.getByRole('switch');
  await expect(toggle).toHaveAttribute('aria-checked', String(!on));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
}

async function saveSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: COPY.saveSettings, exact: true }).click();
  await expect(page.getByText(COPY.settingsSaved, { exact: true })).toBeVisible();
}

/** Opens the print view from the assignment detail page, as the case does. */
async function openPrintView(page: Page, assignment: PrintAssignment, button: string) {
  await page.goto(`/edu/assignments/${assignment.id}`);
  await expect(page.locator('h1')).toHaveText(assignment.title);
  await page.getByRole('link', { name: button, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/edu/assignments/${assignment.id}/print$`));
  await expect(page.locator('h1')).toHaveText(assignment.title);
}

test.describe('@case:EDU-ASG-10 @area:EDU @prio:P2 print an assignment and its answer key', () => {
  test('the print view carries the student fields, the points and a separate answer key', async ({
    page,
  }) => {
    test.setTimeout(RUN_TIMEOUT);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const educator = tenant.users.teacher;
    if (!tenant.org || !educator) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    const assignment = await createAssignmentWithQuestions(page, 'podstawowy');
    const { mcq, trueFalse, open } = assignment.questions;

    // --- Step 1: „Drukuj” opens the print view ------------------------------
    await openPrintView(page, assignment, COPY.printButton);

    // --- Step 2: print-optimised view with the Ctrl+P hint ------------------
    await expect(page.getByText(COPY.printHint, { exact: true })).toBeVisible();
    await expect(page.getByText(DESCRIPTION, { exact: true })).toBeVisible();
    await expect(page.getByText(/^Razem: 3/)).toBeVisible();

    // Student fields, each with a fill-in line.
    for (const label of [COPY.name, COPY.className, COPY.date]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    // Points next to every question; the three types render their own answer area.
    const blocks = page.locator('.question-block');
    await expect(blocks).toHaveCount(3);
    for (const content of [mcq.content, trueFalse.content, open.content]) {
      const block = questionBlock(page, content);
      await expect(block, `question “${content}” is printed`).toHaveCount(1);
      await expect(block).toContainText(COPY.points);
    }
    await expect(questionBlock(page, mcq.content).locator('.bubble'), 'mcq bubbles').toHaveCount(2);
    await expect(
      questionBlock(page, trueFalse.content).locator('.checkbox-box'),
      'true/false checkboxes',
    ).toHaveCount(2);
    await expect(
      questionBlock(page, open.content).locator('.answer-line'),
      'an open question gets three answer lines',
    ).toHaveCount(3);
    await expect(
      questionBlock(page, open.content).locator('.bubble, .checkbox-box'),
      'an open question offers no selectable answer',
    ).toHaveCount(0);

    // The answer key is rendered with the correct option per question.
    const answerKey = page.locator('.answer-key');
    await expect(answerKey.getByRole('heading', { name: COPY.answerKey })).toBeVisible();
    const keyLines = answerKey.locator('p');
    await expect(keyLines).toHaveCount(3);
    await expect(keyLines.nth(0)).toHaveText(`1. ${mcq.correct}`);
    await expect(keyLines.nth(1)).toHaveText(`2. ${trueFalse.correct}`);
    await expect(keyLines.nth(2)).toHaveText(`3. ${COPY.openQuestion}`);

    // --- Step 3: Ctrl+P / „Zapisz jako PDF” --------------------------------
    // Print media is what Ctrl+P renders: the dashboard chrome and the hint are
    // screen-only and the answer key starts on its own page.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByText(COPY.printHint, { exact: true })).toBeHidden();
    await expect(
      page.locator('[data-slot="sidebar"]'),
      'no dashboard sidebar in the printout',
    ).toBeHidden();
    await expect(page.locator('header'), 'no dashboard header in the printout').toBeHidden();
    const breakBefore = await answerKey.evaluate(
      (element) => getComputedStyle(element).breakBefore,
    );
    expect(breakBefore, 'the answer key starts on a new printed page').toBe('page');

    const pdf = await page.pdf({ format: 'A4' });
    expect(pdf.subarray(0, 5).toString(), 'the print view saves as a PDF').toBe('%PDF-');
    expect(pdf.length, 'the saved PDF is not empty').toBeGreaterThan(1000);
    expect(
      pdfPageCount(pdf),
      'the saved PDF has the questions and a separate key page',
    ).toBeGreaterThan(1);
    await page.emulateMedia({ media: 'screen' });

    // --- Adjacent path: „Drukuj pusty test” opens the same view ------------
    await page.goto(`/edu/assignments/${assignment.id}`);
    const blankLink = page.getByRole('link', { name: COPY.printBlankButton, exact: true });
    await expect(blankLink, 'the actions card offers a blank test print').toBeVisible();
    await blankLink.click();
    await expect(page).toHaveURL(new RegExp(`/edu/assignments/${assignment.id}/print$`));
    await expect(page.locator('h1')).toHaveText(assignment.title);
    await expect(page.getByText(COPY.name, { exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });

  test('the print-settings switches hide the fields and the key they own', async ({ page }) => {
    test.setTimeout(RUN_TIMEOUT);
    const tenant = loadTenant(CASE);
    const educator = tenant.users.teacher;
    if (!tenant.org || !educator) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    const assignment = await createAssignmentWithQuestions(page, 'ustawienia');
    const { mcq, trueFalse, open } = assignment.questions;

    // --- The settings page starts from the documented defaults -------------
    // A fresh browser context has no stored `assignment-print-settings`, so the
    // documented defaults (everything on) are what a first-time educator sees.
    await page.goto('/edu/assignments/settings');
    await expect(page.getByRole('heading', { name: COPY.settingsTitle })).toBeVisible();
    for (const label of Object.values(SWITCHES)) {
      const row = settingsRow(page, label);
      await expect(row, `settings row “${label}” exists`).toHaveCount(1);
      await expect(row.getByRole('switch'), `“${label}” defaults to on`).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }

    // --- Turn off every switch, save, and print ----------------------------
    for (const label of Object.values(SWITCHES)) {
      await setSwitch(page, label, false);
    }
    await saveSettings(page);

    await openPrintView(page, assignment, COPY.printButton);

    // Every field the switches own is gone; the questions themselves stay.
    await expect(page.getByText(COPY.name, { exact: true }), 'name off').toHaveCount(0);
    await expect(page.getByText(COPY.className, { exact: true }), 'class off').toHaveCount(0);
    await expect(page.getByText(COPY.date, { exact: true }), 'date off').toHaveCount(0);
    await expect(page.getByText(COPY.points, { exact: true }), 'points off').toHaveCount(0);
    await expect(page.locator('.answer-key'), 'answer key off').toHaveCount(0);

    await expect(page.getByText(COPY.printHint, { exact: true })).toBeVisible();
    await expect(page.getByText(/^Razem: 3/), 'the total is not a setting').toBeVisible();
    await expect(page.locator('.question-block')).toHaveCount(3);
    for (const content of [mcq.content, trueFalse.content, open.content]) {
      await expect(questionBlock(page, content)).toHaveCount(1);
    }

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
