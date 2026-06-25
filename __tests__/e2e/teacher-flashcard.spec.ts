import { test, expect } from '@playwright/test';
import { t } from './utils';

const PASSWORD = 'pass';

async function login(page: import('@playwright/test').Page, email: string, redirectPattern: RegExp) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(redirectPattern);
}

test.describe('Teacher Flashcards', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
  });

  test('shows all owned context menu items on a flashcard', async ({ page }) => {
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    const manageButton = page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first();
    await expect(manageButton).toBeVisible();
    await manageButton.click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();

    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();

    await expect(page.getByRole('menuitem', { name: t('EduDeckViewPage.select_cards') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('Common.common_edit') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_topics') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_link') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_copy') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_delete') })).toBeVisible();
  });

  test('topics submenu has add, manage, view items', async ({ page }) => {
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    const manageButton = page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first();
    await manageButton.click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();

    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();

    const topicsMenuItem = page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_topics') });
    await topicsMenuItem.hover();

    await expect(page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_add_topic') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_manage_topics') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_view_by_topic') })).toBeVisible();
  });

  test('owned menu triggers edit dialog', async ({ page }) => {
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    const manageButton = page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first();
    await manageButton.click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();

    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();

    await page.getByRole('menuitem', { name: t('Common.common_edit') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('EduDeckViewPage.edit_title'))).toBeVisible();
  });

  test('owned menu triggers link dialog', async ({ page }) => {
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    const manageButton = page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first();
    await manageButton.click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();

    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();

    await page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_link') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('EduDeckViewPage.link_title'))).toBeVisible();
  });

  test('deck context menu has select, edit, export, delete items', async ({ page }) => {
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.setViewportSize({ width: 375, height: 812 });

    const deckCard = page.locator('a[href*="/edu/flashcards/decks/"]').first();
    await deckCard.scrollIntoViewIfNeeded();

    const menuButton = page.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();

    await expect(page.getByRole('menuitem', { name: t('EduFlashcardDecksPage.select_cards') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('Common.common_edit') })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: t('Common.common_delete') })).toBeVisible();
  });

  test('creates, edits, and deletes a deck', async ({ page }) => {
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardDecksPage.new_deck') }).click();
    await page.getByLabel(t('EduFlashcardDecksPage.name_label')).fill('Teacher Test Deck');
    await page.getByLabel(t('EduFlashcardDecksPage.description_label')).fill('Created by teacher');
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Teacher Test Deck').first()).toBeVisible();

    await page.getByText('Teacher Test Deck').hover();
    await page.getByRole('button', { name: t('Common.common_edit') }).first().click();
    await page.getByLabel(t('EduFlashcardDecksPage.name_label')).fill('Teacher Updated Deck');
    await page.getByRole('button', { name: t('Common.common_update') }).click();
    await expect(page.getByText('Teacher Updated Deck')).toBeVisible();

    await page.getByText('Teacher Updated Deck').hover();
    await page.getByRole('button', { name: t('Common.common_delete') }).first().click();
    await page.getByRole('button', { name: t('Common.common_delete') }).last().click();
    await expect(page.getByText('Teacher Updated Deck')).not.toBeVisible();
  });

  test('FAB has new deck, import, and select cards items', async ({ page }) => {
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.setViewportSize({ width: 375, height: 812 });

    const fabButton = page.locator('button').filter({ has: page.locator('svg.lucide-plus') }).first();
    await fabButton.click();

    await expect(page.getByText(t('EduFlashcardDecksPage.new_deck'))).toBeVisible();
    await expect(page.getByText(t('Common.common_import'))).toBeVisible();
    await expect(page.getByText(t('EduFlashcardDecksPage.select_cards'))).toBeVisible();
  });
});
