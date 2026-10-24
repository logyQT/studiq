import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';

/**
 * Seeded decks (`supabase/seeds/01_seed.sql`): each org has one group deck whose
 * name identifies the org, and `teacher1@dev.local` is a teacher in both.
 */
const ORG_DECK: Record<string, string> = {
  'WSB Merito': 'O1G1T1',
  'UE Wrocław': 'O2G1T1',
};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('teacher1@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/edu/);
}

test.describe('Teacher organization switch', () => {
  test('deck list follows the active org without a reload (#135)', async ({ page }) => {
    await login(page);

    const switcher = page.getByRole('button', {
      name: new RegExp(Object.keys(ORG_DECK).join('|')),
    });
    await expect(switcher).toBeVisible();

    // Whichever org the teacher landed on, derive it from the switcher itself
    // instead of relying on seed ordering.
    const switcherText = await switcher.innerText();
    const activeOrg = Object.keys(ORG_DECK).find((name) => switcherText.includes(name));
    expect(activeOrg).toBeDefined();
    const otherOrg = Object.keys(ORG_DECK).find((name) => name !== activeOrg) as string;

    const activeDeck = ORG_DECK[activeOrg as string];
    const otherDeck = ORG_DECK[otherOrg];

    // Full load: warms the deck query cache for the org we landed on.
    // `DeckCard` renders a mobile and a desktop variant, so match the visible one.
    await page.goto('/edu/flashcards');
    await expect(
      page.getByText(activeDeck, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();

    // Arm before switching: with the org in the query key, the mounted deck list
    // observes a new key and must fetch it with the new `active_org_id` cookie.
    // Without the org in the key nothing refetches and this never resolves.
    const deckResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/flashcards/decks') &&
        response.request().method() === 'GET',
    );

    await switcher.click();
    await page.getByRole('menuitem', { name: new RegExp(otherOrg) }).click();
    await expect(switcher).toContainText(otherOrg);
    await page.waitForURL(/\/edu$/);
    await deckResponse;

    // Client-side navigation only (no goto/reload), exactly the reported repro.
    await page.getByRole('link', { name: t('DashboardLayout.flashcard_decks') }).click();
    await page.waitForURL(/\/edu\/flashcards$/);

    await expect(
      page.getByText(otherDeck, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(activeDeck, { exact: true })).toHaveCount(0);

    // Symmetric: switch back and expect the first org's deck again. The
    // previous entry is still cached (staleTime: Infinity), so this transition
    // is a pure cache re-read — only the content must match the active org.
    await switcher.click();
    await page.getByRole('menuitem', { name: new RegExp(activeOrg as string) }).click();
    await expect(switcher).toContainText(activeOrg as string);
    await page.waitForURL(/\/edu$/);

    await page.getByRole('link', { name: t('DashboardLayout.flashcard_decks') }).click();
    await page.waitForURL(/\/edu\/flashcards$/);

    await expect(
      page.getByText(activeDeck, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(otherDeck, { exact: true })).toHaveCount(0);
  });
});
