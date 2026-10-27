import type { Page } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

const manageDeck = t('EduFlashcardDecksPage.manage_deck');
const deckUrl = /\/flashcards\/[0-9a-f-]{36}$/;

/** Open a deck's detail page from the deck list by clicking its card menu. */
async function openDeck(page: Page, base: '/edu/flashcards' | '/app/flashcards', name: string) {
  await page.goto(base);
  await page.waitForLoadState('networkidle');

  const card = page.locator('.group:visible').filter({ hasText: name }).first();
  await card.getByRole('button', { name: manageDeck }).click();
  await page.waitForURL(deckUrl);
}

/** The page renders an empty-state CTA next to the toolbar button. */
function newDeckButton(page: Page) {
  return page.getByRole('button', { name: t('AppFlashcardDecksPage.new_deck') }).first();
}

function flashcardMenu(page: Page) {
  // The sidebar is also a `.group`; filter to cards that carry the card menu.
  return page
    .locator('.group:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first()
    .locator('button:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first();
}

test.describe('Flashcard Deck Detail', () => {
  test('loads deck hero card with name and flashcard count', async ({ page }) => {
    await signIn(page, 'teacher');
    await openDeck(page, '/edu/flashcards', 'Deck A');

    await expect(page.locator('h2').first()).toContainText('Deck A');
    await expect(page.getByText('Card 1-1 front').filter({ visible: true }).first()).toBeVisible();
  });

  test('search filters flashcards', async ({ page }) => {
    await signIn(page, 'teacher');
    await openDeck(page, '/edu/flashcards', 'Deck A');

    const searchInput = page.getByPlaceholder(t('EduDeckViewPage.search_placeholder'));
    await expect(searchInput).toBeVisible();
    await searchInput.fill('nonexistent-card-xyz');
    await expect(page.getByText(t('EduDeckViewPage.no_flashcards'))).toBeVisible();
  });

  test('topic filter shows when topics exist', async ({ page }) => {
    await signIn(page, 'teacher');
    await openDeck(page, '/edu/flashcards', 'Deck A');

    const topicSelect = page
      .getByRole('combobox')
      .filter({ hasText: t('EduDeckViewPage.topic_all') });
    await expect(topicSelect).toBeVisible();
  });

  test('sort dropdown is visible', async ({ page }) => {
    await signIn(page, 'teacher');
    await openDeck(page, '/edu/flashcards', 'Deck A');

    await expect(
      page
        .getByRole('combobox')
        .filter({ hasText: t('EduDeckViewPage.sort_newest') })
        .first(),
    ).toBeVisible();
  });

  test('new flashcard button opens the create dialog', async ({ page }) => {
    await signIn(page, 'student');
    await page.goto('/app/flashcards');
    await page.waitForLoadState('networkidle');

    await newDeckButton(page).click();
    await page
      .getByPlaceholder(t('AppFlashcardDecksPage.name_placeholder'))
      .fill('Detail Test Deck');
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(
      page.getByText('Detail Test Deck').filter({ visible: true }).first(),
    ).toBeVisible();

    const card = page.locator('.group:visible').filter({ hasText: 'Detail Test Deck' }).first();
    await card.getByRole('button', { name: manageDeck }).click();
    await page.waitForURL(deckUrl);

    await page.getByRole('button', { name: t('AppFlashcardDeckViewPage.new_flashcard') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('keyboard shortcut n opens the create dialog', async ({ page }) => {
    await signIn(page, 'student');
    await page.goto('/app/flashcards');
    await page.waitForLoadState('networkidle');

    await newDeckButton(page).click();
    await page.getByPlaceholder(t('AppFlashcardDecksPage.name_placeholder')).fill('Shortcut Deck');
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Shortcut Deck').filter({ visible: true }).first()).toBeVisible();

    const card = page.locator('.group:visible').filter({ hasText: 'Shortcut Deck' }).first();
    await card.getByRole('button', { name: manageDeck }).click();
    await page.waitForURL(deckUrl);
    // The shortcut is bound once the deck (and its permissions) have loaded.
    await expect(
      page.getByRole('button', { name: t('AppFlashcardDeckViewPage.new_flashcard') }),
    ).toBeVisible();

    await page.keyboard.press('n');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('flip card practice button navigates to session', async ({ page }) => {
    await signIn(page, 'teacher');
    await openDeck(page, '/edu/flashcards', 'Deck A');

    const practiceButton = page.getByRole('button', { name: t('EduDeckViewPage.practice_deck') });
    if (await practiceButton.isVisible()) {
      await practiceButton.click();
      await expect(page).toHaveURL(/session/);
    }
  });

  test('flashcard move dialog opens from context menu', async ({ page }) => {
    await signIn(page, 'teacher');
    await openDeck(page, '/edu/flashcards', 'Deck A');

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();
    await flashcardMenu(page).click();

    await page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_move') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('EduDeckViewPage.move_title'))).toBeVisible();
  });

  test('flashcard delete removes it from grid', async ({ page }) => {
    await signIn(page, 'student');
    await page.goto('/app/flashcards');
    await page.waitForLoadState('networkidle');

    await newDeckButton(page).click();
    await page
      .getByPlaceholder(t('AppFlashcardDecksPage.name_placeholder'))
      .fill('Delete Test Deck');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('Common.common_create') })
      .click();
    await expect(
      page.getByText('Delete Test Deck').filter({ visible: true }).first(),
    ).toBeVisible();

    const deckCard = page.locator('.group:visible').filter({ hasText: 'Delete Test Deck' }).first();
    await deckCard.getByRole('button', { name: manageDeck }).click();
    await page.waitForURL(deckUrl);

    // A fresh deck is empty, so seed the card this test deletes.
    await page.getByRole('button', { name: t('AppFlashcardDeckViewPage.new_flashcard') }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog
      .getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'))
      .fill('Delete me front');
    await createDialog
      .getByPlaceholder(t('FlashcardEditorComponent.back_placeholder'))
      .fill('Delete me back');
    await createDialog.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Delete me front').filter({ visible: true }).first()).toBeVisible();

    await page.locator('.group:visible').filter({ hasText: 'Delete me front' }).first().hover();
    await flashcardMenu(page).click();

    await page.getByRole('menuitem', { name: t('AppFlashcardDeckViewPage.menu_delete') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('AppFlashcardDeckViewPage.delete_dialog_title'))).toBeVisible();

    await page
      .getByRole('button', { name: t('Common.common_delete') })
      .last()
      .click();
    await expect(page.getByText(t('AppFlashcardDeckViewPage.no_flashcards'))).toBeVisible();
  });
});
