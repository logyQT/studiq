import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

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

/** The "Attempts ({days} days)" title in both locales, with the number left open. */
function completedStatTitle() {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = (message: string) => message.split('{days}').map(escape).join('\\d+');
  return new RegExp(
    `${pattern(en.EduOverviewPage.completed_stat)}|${pattern(pl.EduOverviewPage.completed_stat)}`,
    'i',
  );
}

test.describe('EDU dashboard stats (#133, #654)', () => {
  test('the stat cards show the counts from the stats APIs', async ({ page }) => {
    await loginTeacher(page);

    // Compare against the live API responses instead of hard-coded seed numbers, so the
    // assertions stay valid if the seed changes. The seeded Classroom org (this account) has
    // content, hence the non-zero guards: with the envelope bug every card rendered 0.
    const overview = await page.request.get('/api/v1/stats/teacher');
    expect(overview.status()).toBe(200);
    const { totalQuestions, totalFlashcards } = (await overview.json()).data as {
      totalQuestions: number;
      totalFlashcards: number;
    };
    expect(totalQuestions).toBeGreaterThan(0);
    expect(totalFlashcards).toBeGreaterThan(0);

    // Learners and attempts come from the group aggregate: distinct totals, never a row sum.
    const groups = await page.request.get('/api/v1/stats/teacher/groups?days=30');
    expect(groups.status()).toBe(200);
    const { totals } = (await groups.json()).data as {
      totals: { students: number; completedAttempts: number };
    };

    await expect(statCardValue(page, t('EduOverviewPage.total_questions'))).toHaveText(
      String(totalQuestions),
    );
    await expect(statCardValue(page, t('EduOverviewPage.flashcards'))).toHaveText(
      String(totalFlashcards),
    );
    await expect(statCardValue(page, t('EduOverviewPage.students_stat'))).toHaveText(
      String(totals.students),
    );
    await expect(statCardValue(page, completedStatTitle())).toHaveText(
      String(totals.completedAttempts),
    );
  });
});
