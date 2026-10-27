import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

const createTitle = t('QuestionForm.create_title');
const saveButton = t('QuestionForm.create');

/** Open one of the tenant's seeded question banks by name. */
async function openBank(page: import('@playwright/test').Page, name = 'Bank A') {
  await page.goto('/edu/questions');
  await page.waitForLoadState('networkidle');

  await page.locator('.group:visible').filter({ hasText: name }).first().click();
  await page.waitForURL(/\/edu\/questions\/[0-9a-f-]{36}$/);
}

test.describe('Teacher Question Flow', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'teacher');
  });

  test('Teacher creates an MCQ question and sees it in the list', async ({ page }) => {
    await openBank(page);

    await page.getByRole('button', { name: t('QuestionBankDetail.create_question') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: createTitle })).toBeVisible();

    // The dialog has two comboboxes (type Select + topics MultiSelect).
    await dialog.locator('[data-slot="select-trigger"]').click();
    await page.getByRole('option', { name: t('QuestionForm.multiple_choice') }).click();

    await dialog.getByPlaceholder(t('QuestionForm.question_placeholder')).fill('What is 2 + 2?');

    await dialog.getByPlaceholder(/Answer 1|Odpowiedź 1/).fill('3');
    await dialog.getByRole('button', { name: t('QuestionForm.add_answer') }).click();
    await dialog.getByPlaceholder(/Answer 2|Odpowiedź 2/).fill('4');
    await dialog.locator('input[type="radio"]').nth(1).check();

    await dialog.getByRole('button', { name: saveButton }).click();
    await expect(page.locator('tbody').getByText('What is 2 + 2?').first()).toBeVisible();
  });

  test('Teacher sees existing seeded questions', async ({ page }) => {
    await openBank(page);

    await expect(page.locator('tbody').getByText('Question 1-1?').first()).toBeVisible();
  });

  test('Teacher deletes a question with the question-specific dialog and delete toast', async ({
    page,
  }) => {
    const bankName = `QA157 Bank ${Date.now()}`;
    const questionContent = 'QA157 question content';

    // Navigate directly: clicking the sidebar link immediately after the post-login
    // redirect can be swallowed while the App Router hydrates (seen on prod builds).
    await page.goto('/edu/questions');
    await page.waitForURL(/\/edu\/questions/);

    // Create an own bank so the test only ever touches its own data.
    await page
      .getByRole('button', { name: t('QuestionBankManagement.new_bank') })
      .first()
      .click();
    const bankDialog = page.getByRole('dialog');
    await bankDialog.getByLabel(t('QuestionBankManagement.name_label')).fill(bankName);
    await bankDialog.getByRole('button', { name: t('Common.common_create') }).click();

    const bankCard = page.getByText(bankName).filter({ visible: true });
    await expect(bankCard.first()).toBeVisible({ timeout: 10000 });
    await bankCard.first().click();
    await page.waitForURL(/\/edu\/questions\/[^/]+$/);

    // Create a question in it
    await page.getByRole('button', { name: t('QuestionBankDetail.create_question') }).click();
    const formDialog = page.getByRole('dialog');
    await expect(
      formDialog.getByRole('heading', { name: t('QuestionForm.create_title') }),
    ).toBeVisible();
    // The dialog has two comboboxes (#452): the question-type Select
    // ([data-slot="select-trigger"]) and the topics MultiSelect (a role=combobox
    // button). Target the type select explicitly instead of the bare role locator.
    await formDialog.locator('[data-slot="select-trigger"]').click();
    await page.getByRole('option', { name: t('QuestionForm.open_answer') }).click();
    await formDialog.getByPlaceholder(t('QuestionForm.question_placeholder')).fill(questionContent);
    await formDialog.getByRole('button', { name: t('QuestionForm.create') }).click();
    await expect(page.getByText(t('QuestionForm.created'))).toBeVisible();
    await expect(page.locator('tbody').getByText(questionContent).first()).toBeVisible();

    // Regression guard for the delete *failure* copy: fail only the DELETE call
    // (the glob also covers GET /api/v1/questions/banks/:id) and assert the
    // question-specific toast instead of the generic error.
    const deleteGlob = '**/api/v1/questions/**';
    await page.route(deleteGlob, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'INTERNAL_SERVER' }),
          })
        : route.continue(),
    );

    await page.getByTitle(t('Common.common_delete')).first().click();
    const failureDialog = page.getByRole('dialog');
    await expect(failureDialog.getByText(t('QuestionBankDetail.delete_title'))).toBeVisible();
    await failureDialog.getByRole('button', { name: t('Common.common_delete') }).click();
    await expect(page.getByText(t('QuestionForm.delete_failed'))).toBeVisible();
    // No optimistic removal: the question row must survive a failed delete.
    await expect(page.locator('tbody').getByText(questionContent).first()).toBeVisible();
    await expect(failureDialog).toBeHidden();

    await page.unroute(deleteGlob);

    // The confirm dialog must use the question-specific copy, not the generic
    // "Delete" / "Confirm" strings (regression guard for EDU-Q-05).
    await page.getByTitle(t('Common.common_delete')).first().click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog.getByText(t('QuestionBankDetail.delete_title'))).toBeVisible();
    await expect(deleteDialog.getByText(t('QuestionBankDetail.delete_desc'))).toBeVisible();
    await expect(deleteDialog.getByText(t('Common.common_confirm'))).toHaveCount(0);

    await deleteDialog.getByRole('button', { name: t('Common.common_delete') }).click();
    await expect(page.getByText(t('QuestionForm.deleted'))).toBeVisible();
    await expect(page.getByText(t('QuestionForm.updated'))).toHaveCount(0);
    await expect(page.locator('tbody').getByText(questionContent)).not.toBeVisible();
    await expect(page.getByText(t('QuestionBankDetail.no_questions'))).toBeVisible();

    // Clean up the now-empty bank so repeated runs don't accumulate data. The
    // bank delete action is behind an unlabelled dropdown menu, so use the API
    // with the browser's authenticated cookies.
    const bankId = new URL(page.url()).pathname.split('/').pop();
    const cleanup = await page.request.delete(`/api/v1/questions/banks/${bankId}`);
    expect(cleanup.ok()).toBeTruthy();
  });
});
