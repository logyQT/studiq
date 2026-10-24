import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const email = 'student1@dev.local';
const password = 'pass';

test.describe('Student Question Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    const emailInput = page.getByLabel(t('LoginPage.email_label'));
    await emailInput.click();
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await page.getByLabel(t('LoginPage.password_label')).fill(password);
    await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
    await page.waitForURL(/\/app/);
  });

  test('Student edits and deletes an own question', async ({ page }) => {
    const bankName = `QA370 Bank ${Date.now()}`;
    const questionContent = 'QA370 question content';
    const updatedContent = 'QA370 question content (edited)';

    await page.goto('/app/questions');

    // Create an own bank
    await page
      .getByRole('button', { name: t('QuestionBankManagement.new_bank') })
      .first()
      .click();
    const bankDialog = page.getByRole('dialog');
    await bankDialog.getByLabel(t('QuestionBankManagement.name_label')).fill(bankName);
    await bankDialog.getByRole('button', { name: t('Common.common_create') }).click();
    const bankNameCell = page.getByText(bankName).filter({ visible: true });
    await expect(bankNameCell.first()).toBeVisible({ timeout: 10000 });

    // Open the bank and create a question in it
    await bankNameCell.first().click();
    await page.waitForURL(/\/app\/questions\/[^/]+$/);
    await page.getByRole('button', { name: t('QuestionBankDetail.create_question') }).click();

    const formDialog = page.getByRole('dialog');
    await expect(
      formDialog.getByRole('heading', { name: t('QuestionForm.create_title') }),
    ).toBeVisible();
    await formDialog.getByRole('combobox').click();
    await page.getByRole('option', { name: t('QuestionForm.open_answer') }).click();
    await formDialog.getByPlaceholder(t('QuestionForm.question_placeholder')).fill(questionContent);
    await formDialog.getByRole('button', { name: t('QuestionForm.create') }).click();
    await expect(page.getByText(t('QuestionForm.created'))).toBeVisible();
    await expect(page.locator('tbody').getByText(questionContent).first()).toBeVisible();

    // Own questions expose authoring actions *in addition* to the report action
    await expect(page.getByTitle(t('Common.common_edit')).first()).toBeVisible();
    await expect(page.getByTitle(t('Common.common_delete')).first()).toBeVisible();
    await expect(page.getByTitle(t('QuestionReports.report_button_title')).first()).toBeVisible();

    // Edit
    await page.getByTitle(t('Common.common_edit')).first().click();
    await expect(
      formDialog.getByRole('heading', { name: t('QuestionForm.edit_title') }),
    ).toBeVisible();
    await formDialog.getByPlaceholder(t('QuestionForm.question_placeholder')).fill(updatedContent);
    await formDialog.getByRole('button', { name: t('QuestionForm.update') }).click();
    await expect(page.getByText(t('QuestionForm.updated'))).toBeVisible();
    await expect(page.locator('tbody').getByText(updatedContent).first()).toBeVisible();

    // Delete
    await page.getByTitle(t('Common.common_delete')).first().click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog.getByText(t('QuestionBankDetail.delete_title'))).toBeVisible();
    await deleteDialog.getByRole('button', { name: t('Common.common_delete') }).click();
    await expect(page.getByText(t('QuestionForm.deleted'))).toBeVisible();
    await expect(page.locator('tbody').getByText(updatedContent)).not.toBeVisible();
  });
});
