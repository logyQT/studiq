import { expect, test } from '@playwright/test';
import { t } from './utils';

const email = 'teacher@dev.local';
const password = 'pass';

const heading = t('EduQuestionsPage.title');
const createButton = t('EduQuestionsPage.create_question');
const createTitle = t('EduQuestionsPage.create_title');
const saveButton = t('EduQuestionsPage.create');

test.describe('Teacher Question Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    const emailInput = page.getByLabel(t('LoginPage.email_label'));
    await emailInput.click();
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await page.getByLabel(t('LoginPage.password_label')).fill(password);
    await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
    await page.waitForURL(/\/edu/);
  });

  test('Teacher creates an MCQ question and sees it in the list', async ({ page }) => {
    await page.getByRole('link', { name: t('DashboardLayout.edu_questions') }).click();
    await page.waitForURL(/\/edu\/questions/);

    await expect(page.getByText(heading).first()).toBeVisible();

    await page.getByRole('button', { name: createButton }).click();
    await expect(page.getByRole('heading', { name: createTitle })).toBeVisible();

    await page
      .locator(
        'button:has-text("MCQ"), button:has-text("Multiple Choice"), button:has-text("Wielokrotny wybór")',
      )
      .first()
      .click();
    await page.waitForTimeout(500);
    await page.getByRole('option', { name: t('EduQuestionsPage.multiple_choice') }).click();

    await page.getByPlaceholder(t('EduQuestionsPage.question_placeholder')).fill('What is 2 + 2?');

    await page
      .getByPlaceholder(/Answer|Odpowiedź/)
      .first()
      .fill('3');
    await page.getByRole('button', { name: t('EduQuestionsPage.add_answer') }).click();
    await page
      .getByPlaceholder(/Answer|Odpowiedź/)
      .nth(1)
      .fill('4');

    await page.locator('input[type="radio"]').nth(1).check();

    await page.getByRole('button', { name: saveButton }).click();
    await page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/questions') && resp.request().method() === 'POST',
    );
    await page.waitForTimeout(1000);
    await expect(page.locator('tbody').getByText('What is 2 + 2?').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('Teacher sees existing seeded questions', async ({ page }) => {
    await page.getByRole('link', { name: t('DashboardLayout.edu_questions') }).click();
    await page.waitForURL(/\/edu\/questions/);

    await expect(page.getByText('typeof null')).toBeVisible();
    await expect(page.getByText('GROUP BY')).toBeVisible();
  });
});
