import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

const deckNamePlaceholder = t('AppFlashcardDecksPage.name_placeholder');

function deckCard(page: import('@playwright/test').Page, name: string) {
  return page.locator('.group:visible').filter({ hasText: name }).first();
}

function deckMenu(page: import('@playwright/test').Page, name: string) {
  return deckCard(page, name)
    .locator('button:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first();
}

test.describe('Student Flashcard Flow', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'student');
  });

  test('manages decks: create, edit, and delete', async ({ page }) => {
    await page.goto('/app/flashcards');

    // The toolbar button and the empty-state CTA share the label.
    await page
      .getByRole('button', { name: t('AppFlashcardDecksPage.new_deck') })
      .first()
      .click();
    await page.getByPlaceholder(deckNamePlaceholder).fill('Test Deck');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('Common.common_create') })
      .click();
    await expect(page.getByText('Test Deck').filter({ visible: true }).first()).toBeVisible();

    await deckMenu(page, 'Test Deck').click();
    await page.getByRole('menuitem', { name: t('Common.common_edit') }).click();
    await page.getByPlaceholder(deckNamePlaceholder).fill('Updated Deck');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('Common.common_update') })
      .click();
    await expect(page.getByText('Updated Deck').filter({ visible: true }).first()).toBeVisible();

    await deckMenu(page, 'Updated Deck').click();
    await page.getByRole('menuitem', { name: t('Common.common_delete') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: t('Common.common_delete') }).click();
    await expect(page.getByText('Updated Deck')).toHaveCount(0);
  });

  test('starts a learn session from the study page', async ({ page }) => {
    await page.goto('/app/study/learn');

    // The content profile gives the student 20 unseen cards, so the page offers
    // a learn session instead of "All Caught Up".
    await expect(page.getByText(/new cards available/i)).toBeVisible();
    await page.getByRole('button', { name: t('AppFlashcardStudyPage.start_learning') }).click();
    await expect(page).toHaveURL(/\/app\/study\/session\//);
  });

  test('crams a deck shared with the group', async ({ page }) => {
    await page.goto('/app/study/cram');

    await deckCard(page, 'Deck A').click();
    await expect(page).toHaveURL(/\/app\/study\/session\/cram\?deckId=/);
  });

  test('sees the decks shared with the group', async ({ page }) => {
    await page.goto('/app/flashcards');

    await expect(page.getByText('Deck A').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('Deck B').filter({ visible: true }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('AppFlashcardDecksPage.new_deck') }).first(),
    ).toBeVisible();
  });
});
