import type { Page } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

const deckUrl = /\/flashcards\/[0-9a-f-]{36}$/;
const manageDeck = t('EduFlashcardDecksPage.manage_deck');
const firstCard = 'Card 1-1 front';

async function openDeck(page: Page, base: '/edu/flashcards' | '/app/flashcards') {
  await page.goto(base);
  await page.waitForLoadState('networkidle');

  const card = page.locator('.group:visible').filter({ hasText: 'Deck A' }).first();
  await card.getByRole('button', { name: manageDeck }).click();
  await page.waitForURL(deckUrl);
}

function cardNamed(page: Page, text: string) {
  return page.locator('.group:visible').filter({ hasText: text }).first();
}

async function enterSelectionMode(
  page: Page,
  base: '/edu/flashcards' | '/app/flashcards',
  cardText = firstCard,
) {
  await openDeck(page, base);

  // Scope the menu to the card under test — "first card" is not stable when the
  // list is sorted by creation date.
  const card = cardNamed(page, cardText);
  await card.hover();
  await card
    .locator('button:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first()
    .click();
  await page.getByRole('menuitem', { name: t('EduDeckViewPage.select_cards') }).click();
  await expect(page.getByRole('checkbox').filter({ visible: true }).first()).toBeVisible();
}

test.describe('Flashcard Selection Mode', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'teacher');
  });

  test('flashcard enters selection mode from context menu', async ({ page }) => {
    await enterSelectionMode(page, '/edu/flashcards');

    await expect(page.getByText(t('EduDeckViewPage.select_all')).first()).toBeVisible();
  });

  test('toggle individual flashcard selection', async ({ page }) => {
    await enterSelectionMode(page, '/edu/flashcards');

    const checkbox = page.getByRole('checkbox').filter({ visible: true }).first();
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
  });

  test('select all / deselect all flashcards', async ({ page }) => {
    await enterSelectionMode(page, '/edu/flashcards');

    await page.getByRole('button', { name: t('EduDeckViewPage.select_all') }).click();
    const checkboxes = page.getByRole('checkbox');
    const checkboxCount = await checkboxes.count();
    expect(checkboxCount).toBeGreaterThan(0);
    for (let i = 0; i < checkboxCount; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }

    await page.getByRole('button', { name: t('EduDeckViewPage.deselect_all') }).click();
    for (let i = 0; i < checkboxCount; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }
  });

  test('escape key clears flashcard selection', async ({ page }) => {
    await enterSelectionMode(page, '/edu/flashcards');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('checkbox').first()).not.toBeVisible();
  });

  test('bulk actions bar appears when flashcards are selected', async ({ page }) => {
    await enterSelectionMode(page, '/edu/flashcards');

    await page.getByRole('checkbox').filter({ visible: true }).first().click();

    // `n_selected` is an ICU plural, so match the rendered count, not the key.
    await expect(page.getByText(/\d+ selected/i).first()).toBeVisible();
  });

  test('bulk delete flashcards removes them', async ({ page }) => {
    await enterSelectionMode(page, '/edu/flashcards');

    await page.getByRole('checkbox').filter({ visible: true }).first().click();

    const deleteButton = page
      .locator('button:visible')
      .filter({ has: page.locator('svg.lucide-trash-2') })
      .first();
    await deleteButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The dialog also has an X ("Close") button; scope the confirm to the dialog.
    await dialog.getByRole('button', { name: t('Common.common_delete') }).click();
    await expect(page.getByText(firstCard)).toHaveCount(0);
  });

  test('topic enters selection mode and clears on escape', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/edu/topics');
    await page.waitForLoadState('networkidle');

    const dial = page.locator('[data-speed-dial]');
    await dial.locator('button').last().click();
    // Items are icon-only and ordered: new topic, select topics.
    const items = dial
      .locator('button:visible')
      .filter({ hasNot: page.locator('svg.lucide-plus') });
    await items.nth(1).click();

    await expect(page.getByText(t('EduFlashcardTopicsPage.select_all')).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText(t('EduFlashcardTopicsPage.select_all'))).toHaveCount(0);
  });

  test('deck enters selection mode from context menu (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/edu/flashcards');
    await page.waitForLoadState('networkidle');

    const menuButton = page
      .locator('.group:visible')
      .filter({ hasText: 'Deck A' })
      .first()
      .locator('button:visible')
      .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
      .first();
    await menuButton.click();
    await page.getByRole('menuitem', { name: t('EduFlashcardDecksPage.select_cards') }).click();

    await expect(page.getByRole('checkbox').first()).toBeVisible();
  });
});
