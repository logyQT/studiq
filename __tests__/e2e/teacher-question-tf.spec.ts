import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const email = 'teacher1@dev.local';
const password = 'pass';

const newBankButton = t('QuestionBankManagement.new_bank');
const createQuestionButton = t('QuestionBankDetail.create_question');
const createButton = t('QuestionForm.create');
const questionPlaceholder = t('QuestionForm.question_placeholder');
const trueFalseOption = t('QuestionForm.true_false');

/**
 * Regression guard for #154 (EDU-Q-03): picking the True/False type must
 * immediately render two *editable* option rows seeded from the i18n defaults,
 * with no "Generuj opcje Prawda/Fałsz" button needed.
 */
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(password);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/edu/);
  // Login ends with router.refresh(); wait for that transition to finish so the
  // dashboard is interactive and cannot remount the screen under our clicks.
  await page.waitForLoadState('networkidle');
}

function uniqueBankName(prefix: string) {
  return `QA154 ${prefix} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Create a throwaway bank and open its detail page (the question form lives there). */
async function openEmptyBank(page: Page, name: string) {
  await page.getByRole('link', { name: t('DashboardLayout.edu_questions') }).click();
  await page.waitForURL(/\/edu\/questions/);

  await page.getByRole('button', { name: newBankButton }).first().click();
  const bankDialog = page.getByRole('dialog');
  await bankDialog.getByLabel(t('QuestionBankManagement.name_label')).fill(name);
  await bankDialog.getByRole('button', { name: t('Common.common_create') }).click();

  const bankCard = page.getByText(name, { exact: true }).filter({ visible: true }).first();
  await expect(bankCard).toBeVisible({ timeout: 10_000 });
  await bankCard.click();
  await page.waitForURL(/\/edu\/questions\/[^/]+$/);
}

async function deleteBank(page: Page) {
  const bankId = new URL(page.url()).pathname.split('/').pop();
  const cleanup = await page.request.delete(`/api/v1/questions/banks/${bankId}`);
  expect(cleanup.ok()).toBeTruthy();
}

/** The answer option inputs (never the content textarea or the radio column). */
function optionInputs(page: Page) {
  return page
    .getByRole('dialog')
    .locator('input[placeholder^="Odpowiedź"], input[placeholder^="Answer"]');
}

async function openFormAndPickTrueFalse(page: Page) {
  await page.getByRole('button', { name: createQuestionButton }).click();
  const formDialog = page.getByRole('dialog');
  await expect(
    formDialog.getByRole('heading', { name: t('QuestionForm.create_title') }),
  ).toBeVisible();

  // The dialog has two comboboxes: the question-type Select carries
  // `data-slot="select-trigger"`, the topics MultiSelect does not (#452).
  await formDialog.locator('[data-slot="select-trigger"]').click();
  await page.getByRole('option', { name: trueFalseOption }).click();
  return formDialog;
}

test.describe('Teacher True/False question form (#154)', () => {
  test('Selecting True/False seeds two editable options without the generate button', async ({
    page,
  }) => {
    const bankName = uniqueBankName('Seed');
    await login(page);
    await openEmptyBank(page, bankName);
    const formDialog = await openFormAndPickTrueFalse(page);

    const options = optionInputs(page);
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveValue(t('QuestionForm.tf_true'));
    await expect(options.nth(1)).toHaveValue(t('QuestionForm.tf_false'));

    // Exactly one correct answer, defaulting to the first row.
    const radios = formDialog.locator('input[type="radio"]');
    await expect(radios).toHaveCount(2);
    await expect(radios.nth(0)).toBeChecked();
    await expect(radios.nth(1)).not.toBeChecked();

    // T/F is binary: no add-answer control and no removable rows (the dialog's
    // own close X lives outside the answer rows).
    await expect(
      formDialog.getByRole('button', { name: t('QuestionForm.add_answer') }),
    ).toHaveCount(0);
    const rows = formDialog.locator('div.space-y-2 > div');
    await expect(rows).toHaveCount(2);
    await expect(rows.locator('button')).toHaveCount(0);

    // The prefilled rows stay editable and the edited wording is what gets saved.
    await options.nth(0).fill('Tak');
    const content = `QA154 true/false ${Date.now()}`;
    await formDialog.getByPlaceholder(questionPlaceholder).fill(content);

    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          new URL(resp.url()).pathname === '/api/v1/questions' &&
          resp.request().method() === 'POST',
      ),
      formDialog.getByRole('button', { name: createButton }).click(),
    ]);
    expect(response.ok()).toBeTruthy();

    await expect(page.getByText(t('QuestionForm.created'))).toBeVisible();
    await expect(page.locator('tbody').getByText(content)).toBeVisible({ timeout: 10_000 });

    await deleteBank(page);
  });

  test('Clearing one True/False option blocks submit with the inline alert', async ({ page }) => {
    const bankName = uniqueBankName('Validation');
    await login(page);
    await openEmptyBank(page, bankName);
    const formDialog = await openFormAndPickTrueFalse(page);

    let posted = false;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/questions') {
        posted = true;
      }
    });

    await optionInputs(page).nth(1).fill('');
    await formDialog.getByPlaceholder(questionPlaceholder).fill(`QA154 blank option ${Date.now()}`);
    await formDialog.getByRole('button', { name: createButton }).click();

    await expect(formDialog.getByRole('alert')).toHaveText(t('QuestionForm.answers_required'));
    expect(posted).toBe(false);
    await expect(formDialog).toBeVisible();

    await deleteBank(page);
  });
});
