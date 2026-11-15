import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { firstRecorded, requiredValue } from '#test/mocks/recorded';

const PASSWORD = 'pass';

/**
 * Seeded per-org students (`supabase/seeds/01_seed.sql`): each org has a
 * distinct student, so which org's data is on screen is unambiguous.
 */
const ORG_STUDENT: Record<string, string> = {
  'WSB Merito': 'student1@dev.local',
  'UE Wrocław': 'student2@dev.local',
};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('manager@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/manage/);
}

test.describe('Manager organization switch', () => {
  test('overview follows the active org without a reload (#216)', async ({ page }) => {
    await login(page);

    const switcher = page.getByRole('button', {
      name: new RegExp(Object.keys(ORG_STUDENT).join('|')),
    });
    await expect(switcher).toBeVisible();

    // Whichever org the manager landed on, derive it from the switcher itself
    // instead of relying on seed ordering.
    const switcherText = await switcher.innerText();
    const activeOrg = firstRecorded(
      Object.keys(ORG_STUDENT).filter((name) => switcherText.includes(name)),
      'the organisation the manager landed on',
    );
    const otherOrg = firstRecorded(
      Object.keys(ORG_STUDENT).filter((name) => name !== activeOrg),
      'a second organisation to switch to',
    );
    const activeName = requiredValue(ORG_STUDENT[activeOrg], activeOrg);
    const otherName = requiredValue(ORG_STUDENT[otherOrg], otherOrg);

    await expect(page.getByText(activeName)).toBeVisible();

    // Switch while already on the overview — this is the reported repro: the
    // route does not change, so nothing remounts the page.
    await switcher.click();
    await page.getByRole('menuitem', { name: new RegExp(otherOrg) }).click();

    await expect(switcher).toContainText(otherOrg);
    expect(new URL(page.url()).pathname).toBe('/manage');
    await expect(page.getByText(otherName)).toBeVisible();
    await expect(page.getByText(activeName)).toHaveCount(0);

    // Symmetric: switch back on the same page and expect the first org again.
    await switcher.click();
    await page.getByRole('menuitem', { name: new RegExp(activeOrg) }).click();

    await expect(switcher).toContainText(activeOrg);
    await expect(page.getByText(activeName)).toBeVisible();
    await expect(page.getByText(otherName)).toHaveCount(0);
  });
});
