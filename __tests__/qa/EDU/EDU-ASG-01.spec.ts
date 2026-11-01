import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-01 — creating an assignment („kartkówka”) from the educator form.
 *
 * Case steps: `/edu/assignments` → „Nowa kartkówka”, fill title „Kartkówka 1”,
 * description, deadline in two days, 10-minute limit, max attempts 1, passing
 * score 50%, turn on „Losuj pytania” + „Losuj odpowiedzi”, turn on „Pokaż
 * wyniki”, then „Utwórz kartkówkę”.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-01 --fresh
 *
 * gives the org `qa-edu-asg-01-<suffix>` with a manager, an educator and a
 * student, plus the default group `G1`
 * (`tenantKey('qa/cases/EDU-ASG-01.md', 'EDU-ASG-01#<suffix>', 'qa-shared')` +
 * `tenantId` for every id). The case's legacy account
 * (`teacher-classroom@dev.local`) is never used. Nothing global is read or
 * written: no admin setting, feature flag, plan, platform stat or singleton row.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. „Utwórz kartkówkę” is disabled while the title is empty and enabled once a
 *    title is typed.
 * 2. Saving navigates to `/edu/assignments/<id>`, which shows the title, the
 *    description and the status badge „Szkic”.
 * 3. „Edytuj” shows every saved setting: the exact deadline, 10-minute limit,
 *    max attempts 1, passing score 50% and all three switches on.
 * 4. Adjacent regression: the new draft is listed on `/edu/assignments` with the
 *    „Szkic” badge, linked to its own detail page.
 *
 * The title is the case's own copy, so a re-run on the same tenant (CI seeds one
 * tenant per spec and retries against it) creates a second draft with the same
 * title. Every assertion follows the id captured from the URL after saving, so
 * the duplicates cannot change the result.
 */

const CASE = 'EDU-ASG-01';

/** Polish copy from `EduAssignmentNewPage` / `EduAssignmentDetailPage` (pl.json). */
const COPY = {
  listTitle: 'Kartkówki',
  newAssignment: 'Nowa kartkówka',
  newSubtitle: 'Utwórz nową kartkówkę dla uczniów',
  editTitle: 'Edytuj kartkówkę',
  create: 'Utwórz kartkówkę',
  draft: 'Szkic',
  edit: 'Edytuj',
  shuffleQuestions: 'Losuj pytania',
  shuffleAnswers: 'Losuj odpowiedzi',
  showResults: 'Pokaż wyniki',
} as const;

/** The values the case asks the teacher to enter. */
const FORM = {
  title: 'Kartkówka 1',
  description: 'Kartkówka z rozdziału 5',
  timeLimitMin: '10',
  maxAttempts: '1',
  passingScore: '50',
} as const;

const ASSIGNMENT_ID = /\/edu\/assignments\/([0-9a-f-]{36})$/;

/** `datetime-local` value for „za 2 dni”, at minute precision (what the input accepts). */
function twoDaysFromNow(): Date {
  return new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
}

function toDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * The switch of one settings row. Radix renders the switch as an unnamed
 * `<button role="switch">`, so it is addressed through the row label: the label's
 * parent is the text block, whose parent is the row that also holds the switch.
 */
function settingSwitch(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator('xpath=../..').getByRole('switch');
}

/** The list card that links to a specific assignment id. */
function assignmentCard(page: Page, id: string): Locator {
  return page.locator(`a[href="/edu/assignments/${id}"]`);
}

test.describe('@case:EDU-ASG-01 @area:EDU @prio:P1 create an assignment from the form', () => {
  test('creates a draft assignment and shows the saved settings in the edit form', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const educator = tenant.users.teacher;
    if (!tenant.org || !educator) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const deadline = twoDaysFromNow();
    const deadlineValue = toDatetimeLocal(deadline);
    // The detail card formats the stored deadline with `toLocaleDateString('pl')`.
    const deadlineLabel = deadline.toLocaleDateString('pl');

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    // --- Step 1: the assignments hub → the create form ----------------------
    await page.goto('/edu/assignments');
    await expect(page).toHaveURL(/\/edu\/assignments$/);
    await expect(page.locator('h1')).toHaveText(COPY.listTitle);

    await page.getByRole('link', { name: COPY.newAssignment }).first().click();
    await expect(page).toHaveURL(/\/edu\/assignments\/new$/);
    await expect(page.locator('h1')).toHaveText(COPY.newAssignment);
    await expect(page.getByText(COPY.newSubtitle, { exact: true })).toBeVisible();

    // --- Step 2: the empty-title gate --------------------------------------
    const submit = page.locator('form button[type="submit"]');
    await expect(submit).toHaveText(COPY.create);
    await expect(submit, 'an empty title keeps the create button disabled').toBeDisabled();

    await page.locator('#title').fill(FORM.title);
    await expect(submit, 'a title enables the create button').toBeEnabled();

    await page.locator('#description').fill(FORM.description);
    await page.locator('#deadline').fill(deadlineValue);
    await page.locator('#timeLimit').fill(FORM.timeLimitMin);
    await expect(page.locator('#maxAttempts')).toHaveValue(FORM.maxAttempts);
    await page.locator('#passingScore').fill(FORM.passingScore);

    // „Losuj pytania” / „Losuj odpowiedzi” are on by default: the case's „włącz”
    // is already satisfied, and clicking them would turn them off.
    await expect(settingSwitch(page, COPY.shuffleQuestions)).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(settingSwitch(page, COPY.shuffleAnswers)).toHaveAttribute('aria-checked', 'true');
    await expect(settingSwitch(page, COPY.showResults)).toHaveAttribute('aria-checked', 'false');
    await settingSwitch(page, COPY.showResults).click();
    await expect(settingSwitch(page, COPY.showResults)).toHaveAttribute('aria-checked', 'true');

    // --- Step 3: save → the assignment detail in „Szkic” --------------------
    await submit.click();
    await page.waitForURL(ASSIGNMENT_ID);
    const id = page.url().match(ASSIGNMENT_ID)![1];

    await expect(page.locator('h1')).toHaveText(FORM.title);
    await expect(page.getByText(COPY.draft, { exact: true })).toBeVisible();
    await expect(page.getByText(FORM.description, { exact: true })).toBeVisible();
    await expect(page.getByText(deadlineLabel, { exact: true })).toBeVisible();

    // --- Expected result: „Edytuj” shows every saved setting ---------------
    await page.getByRole('link', { name: COPY.edit }).click();
    await expect(page).toHaveURL(new RegExp(`/edu/assignments/${id}/edit$`));
    await expect(page.locator('h1')).toHaveText(COPY.editTitle);

    await expect(page.locator('#title')).toHaveValue(FORM.title);
    await expect(page.locator('#description')).toHaveValue(FORM.description);
    await expect(page.locator('#deadline')).toHaveValue(deadlineValue);
    await expect(page.locator('#timeLimit')).toHaveValue(FORM.timeLimitMin);
    await expect(page.locator('#maxAttempts')).toHaveValue(FORM.maxAttempts);
    await expect(page.locator('#passingScore')).toHaveValue(FORM.passingScore);
    for (const label of [COPY.shuffleQuestions, COPY.shuffleAnswers, COPY.showResults]) {
      await expect(settingSwitch(page, label), `switch „${label}” after saving`).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }

    // --- Adjacent regression: the hub lists the new draft ------------------
    await page.goto('/edu/assignments');
    const card = assignmentCard(page, id);
    await expect(card, 'the created draft is listed on the assignments hub').toBeVisible();
    await expect(card).toContainText(FORM.title);
    await expect(card.getByText(COPY.draft, { exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
