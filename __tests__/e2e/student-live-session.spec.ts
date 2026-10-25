import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const email = 'student1@dev.local';
const password = 'pass';

test.describe('Student Live Study placeholder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    const emailInput = page.getByLabel(t('LoginPage.email_label'));
    await emailInput.click();
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await page.getByLabel(t('LoginPage.password_label')).fill(password);
    await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
    await page.waitForURL(/\/app/);
    await page.goto('/app/study/live');
  });

  test('Explains the feature, exposes a join button and does not crash', async ({ page }) => {
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(
      page.getByRole('heading', { level: 1, name: t('AppLiveStudyPage.title') }),
    ).toBeVisible();
    await expect(page.getByText(t('AppLiveStudyPage.subtitle'))).toBeVisible();
    // Next.js renders its own route announcer with role="alert", so scope the assertion.
    await expect(
      page.getByRole('alert').filter({ hasText: t('AppLiveStudyPage.coming_soon') }),
    ).toBeVisible();

    for (const key of ['step1_title', 'step2_title', 'step3_title']) {
      await expect(page.getByText(t(`AppLiveStudyPage.${key}`))).toBeVisible();
    }

    const join = page.getByRole('button', { name: t('AppLiveStudyPage.join_button') });
    await expect(join).toBeDisabled();

    await page.locator('#live-session-code').focus();
    await page.keyboard.type('ABC123');

    await expect(join).toBeEnabled();
    await join.click();

    await expect(
      page.locator('[data-sonner-toast]').getByText(t('AppLiveStudyPage.coming_soon')),
    ).toBeVisible();
    // Joining is a placeholder: no navigation, no crash.
    await expect(page).toHaveURL(/\/app\/study\/live$/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('AppLiveStudyPage.title') }),
    ).toBeVisible();
  });

  test('FAQ sub-page still renders the three steps', async ({ page }) => {
    await page.goto('/app/study/live/faq');
    await expect(
      page.getByRole('heading', { level: 1, name: t('AppLiveStudyPage.faq_title') }),
    ).toBeVisible();
    for (const key of ['step1_title', 'step2_title', 'step3_title']) {
      await expect(page.getByText(t(`AppLiveStudyPage.${key}`))).toBeVisible();
    }
  });
});
