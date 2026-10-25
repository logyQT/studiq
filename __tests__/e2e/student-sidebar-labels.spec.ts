import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const STUDENT_EMAIL = 'student1@dev.local';
const PASSWORD = 'pass';

/**
 * STU-03 pins the student „Treści” section to Fiszki, Tematy, Pytania,
 * Kartkówki, Zgłoszenia. #335 — the deck entry used the shared educator label
 * („Talie”) while the page it opens is titled „Fiszki”.
 */
const CONTENT_LABELS = [
  'DashboardLayout.app_flashcard_decks',
  'DashboardLayout.flashcard_topics',
  'DashboardLayout.question_banks',
  'DashboardLayout.app_assignments',
  'DashboardLayout.question_reports',
] as const;

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(STUDENT_EMAIL);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/app/);
}

test.describe('Student sidebar content labels', () => {
  test('labels the deck entry like the page it opens (#335)', async ({ page }) => {
    await login(page);

    // Scope by the deck link, not the group label: the PL stats group contains a
    // "Treści" link (`/app/stats/content`) that collides with the label text.
    const contentGroup = page
      .locator('[data-slot="sidebar-group"]')
      .filter({ has: page.locator('a[href="/app/flashcards"]') });

    await expect(contentGroup).toHaveCount(1);
    await expect(contentGroup.locator('[data-sidebar="group-label"]')).toHaveText(
      t('DashboardLayout.sidebar_content'),
    );

    const links = contentGroup.getByRole('link');
    await expect(links).toHaveText(CONTENT_LABELS.map((key) => t(key)));

    await links.first().click();
    await page.waitForURL(/\/app\/flashcards$/);
    await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(
      t('AppFlashcardDecksPage.title'),
    );
  });
});
