import type { Page } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

const deckUrl = /\/edu\/flashcards\/[0-9a-f-]{36}$/;
const manageDeck = t('EduFlashcardDecksPage.manage_deck');

async function openDeck(page: Page, name = 'Deck A') {
  await page.goto('/edu/flashcards');

  const card = page.locator('.group:visible').filter({ hasText: name }).first();
  await card.getByRole('button', { name: manageDeck }).click();
  await page.waitForURL(deckUrl);
}

/** The sidebar is also a `.group`; filter to cards that carry the card menu. */
function flashcardMenu(page: Page) {
  return page
    .locator('.group:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first()
    .locator('button:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first();
}

function deckCard(page: Page, name: string) {
  return page.locator('.group:visible').filter({ hasText: name }).first();
}

function deckMenu(page: Page, name: string) {
  return deckCard(page, name)
    .locator('button:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first();
}

test.describe('Teacher Flashcards', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'teacher');
  });

  test('shows all owned context menu items on a flashcard', async ({ page }) => {
    await openDeck(page);

    await page.locator('.group:visible').filter({ hasText: 'Card 1-1 front' }).first().hover();
    await flashcardMenu(page).click();

    await expect(
      page.getByRole('menuitem', { name: t('EduDeckViewPage.select_cards') }),
    ).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('Common.common_edit') })).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_topics') }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_move') }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_copy') }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_delete') }),
    ).toBeVisible();
  });

  test('topics submenu has add, manage, view items', async ({ page }) => {
    await openDeck(page);

    await page.locator('.group:visible').filter({ hasText: 'Card 1-1 front' }).first().hover();
    await flashcardMenu(page).click();

    const topicsMenuItem = page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_topics') });
    await topicsMenuItem.hover();

    await expect(
      page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_add_topic') }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_manage_topics') }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_view_by_topic') }),
    ).toBeVisible();
  });

  test('owned menu triggers edit dialog', async ({ page }) => {
    await openDeck(page);

    await page.locator('.group:visible').filter({ hasText: 'Card 1-1 front' }).first().hover();
    await flashcardMenu(page).click();

    await page.getByRole('menuitem', { name: t('Common.common_edit') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('EduDeckViewPage.edit_title'))).toBeVisible();
  });

  test('owned menu triggers move dialog', async ({ page }) => {
    await openDeck(page);

    await page.locator('.group:visible').filter({ hasText: 'Card 1-1 front' }).first().hover();
    await flashcardMenu(page).click();

    await page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_move') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('EduDeckViewPage.move_title'))).toBeVisible();
  });

  test('deck context menu has select, edit, export, delete items', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/edu/flashcards');

    await deckMenu(page, 'Deck A').click();

    await expect(
      page.getByRole('menuitem', { name: t('EduFlashcardDecksPage.select_cards') }),
    ).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('Common.common_edit') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('Common.common_export') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('Common.common_delete') })).toBeVisible();
  });

  test('creates, edits, and deletes a deck', async ({ page }) => {
    await page.goto('/edu/flashcards');

    await page
      .getByRole('button', { name: t('EduFlashcardDecksPage.new_deck') })
      .first()
      .click();
    await page
      .getByPlaceholder(t('EduFlashcardDecksPage.name_placeholder'))
      .fill('Teacher Test Deck');
    await page
      .getByPlaceholder(t('EduFlashcardDecksPage.description_placeholder'))
      .fill('Created by teacher');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('Common.common_create') })
      .click();
    await expect(
      page.getByText('Teacher Test Deck').filter({ visible: true }).first(),
    ).toBeVisible();

    await deckMenu(page, 'Teacher Test Deck').click();
    await page.getByRole('menuitem', { name: t('Common.common_edit') }).click();
    await page
      .getByPlaceholder(t('EduFlashcardDecksPage.name_placeholder'))
      .fill('Teacher Updated Deck');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('Common.common_update') })
      .click();
    await expect(
      page.getByText('Teacher Updated Deck').filter({ visible: true }).first(),
    ).toBeVisible();

    await deckMenu(page, 'Teacher Updated Deck').click();
    await page.getByRole('menuitem', { name: t('Common.common_delete') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page
      .getByRole('button', { name: t('Common.common_delete') })
      .last()
      .click();
    await expect(page.getByText('Teacher Updated Deck')).toHaveCount(0);
  });

  test('FAB has new deck, import, and select cards items', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/edu/flashcards');

    const dial = page.locator('[data-speed-dial]');
    await dial.locator('button').last().click();

    // The items are icon-only; their labels live in the tooltips.
    const items = dial
      .locator('button:visible')
      .filter({ hasNot: page.locator('svg.lucide-plus') });
    await expect(items).toHaveCount(3);

    const labels = [
      t('EduFlashcardDecksPage.new_deck'),
      t('Common.common_import'),
      t('EduFlashcardDecksPage.select_cards'),
    ];
    for (const [i, label] of labels.entries()) {
      await items.nth(i).hover();
      await expect(page.getByRole('tooltip', { name: label })).toBeVisible();
    }
  });
});
