import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const email = 'teacher-classroom@dev.local';
const password = 'pass';

async function loginTeacher(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(password);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/edu/);
}

/**
 * The big number rendered by the `StatCard` with the given title.
 * In `packages/ui/src/components/ui/stat-card.tsx` the title and the value are
 * sibling `<p>` elements, so the value is the next sibling of the title.
 */
function statCardValue(page: import('@playwright/test').Page, title: RegExp) {
  return page
    .locator('p.uppercase', { hasText: title })
    .first()
    .locator('xpath=following-sibling::p[1]');
}

/** The big number rendered in the "Content Overview" row with the given title. */
function overviewValue(page: import('@playwright/test').Page, rowTitle: RegExp) {
  return page
    .locator('div.flex.items-center.justify-between', { hasText: rowTitle })
    .first()
    .locator('span.text-3xl');
}

test.describe('EDU dashboard stats (#133)', () => {
  test('stat cards and content overview show the counts from the stats API', async ({ page }) => {
    await loginTeacher(page);

    // Compare against the live API response instead of hard-coded seed numbers, so the
    // assertion stays valid if the seed changes. The seeded Classroom org (this account)
    // has content, hence the non-zero guards: with the envelope bug every card rendered 0.
    const response = await page.request.get('/api/v1/stats/teacher');
    expect(response.status()).toBe(200);
    const body = await response.json();
    const { totalQuestions, totalFlashcards } = body.data as {
      totalQuestions: number;
      totalFlashcards: number;
    };

    expect(totalQuestions).toBeGreaterThan(0);
    expect(totalFlashcards).toBeGreaterThan(0);

    await expect(statCardValue(page, t('EduOverviewPage.total_questions'))).toHaveText(
      String(totalQuestions),
    );
    await expect(statCardValue(page, t('EduOverviewPage.flashcards'))).toHaveText(
      String(totalFlashcards),
    );

    await expect(overviewValue(page, t('EduOverviewPage.questions_card_title'))).toHaveText(
      String(totalQuestions),
    );
    await expect(overviewValue(page, t('EduOverviewPage.flashcards_card_title'))).toHaveText(
      String(totalFlashcards),
    );
  });
});
