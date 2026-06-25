import { test, expect } from '@playwright/test';
import { t } from './utils';

const PASSWORD = 'pass';

async function login(page: import('@playwright/test').Page, email: string, redirect: RegExp) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(redirect);
}

test.describe('Flashcard Selection Mode', () => {
  test('flashcard enters selection mode from context menu', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first().click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();
    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();

    await page.getByRole('menuitem', { name: t('EduDeckViewPage.select_cards') }).click();

    await expect(page.getByRole('checkbox').first()).toBeVisible();
    await expect(page.getByText(t('EduDeckViewPage.select_all'))).toBeVisible();
  });

  test('toggle individual flashcard selection', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first().click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();
    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();
    await page.getByRole('menuitem', { name: t('EduDeckViewPage.select_cards') }).click();

    const firstCheckbox = page.getByRole('checkbox').first();
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked();
  });

  test('select all / deselect all flashcards', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first().click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();
    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();
    await page.getByRole('menuitem', { name: t('EduDeckViewPage.select_cards') }).click();

    await page.getByRole('button', { name: t('EduDeckViewPage.select_all') }).click();
    const checkboxes = page.getByRole('checkbox');
    const checkboxCount = await checkboxes.count();
    for (let i = 0; i < checkboxCount; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }

    await page.getByRole('button', { name: t('EduDeckViewPage.deselect_all') }).click();
    for (let i = 0; i < checkboxCount; i++) {
      await expect(checkboxes.nth(i)).not.toBeChecked();
    }
  });

  test('escape key clears flashcard selection', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first().click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();
    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();
    await page.getByRole('menuitem', { name: t('EduDeckViewPage.select_cards') }).click();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('checkbox').first()).not.toBeVisible();
  });

  test('bulk actions bar appears when flashcards are selected', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') }).first().click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();
    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();
    await page.getByRole('menuitem', { name: t('EduDeckViewPage.select_cards') }).click();

    await page.getByRole('checkbox').first().click();

    const bulkBar = page.getByText(t('EduDeckViewPage.n_selected')).first();
    await expect(bulkBar).toBeVisible();
  });

  test('bulk delete flashcards removes them', async ({ page }) => {
    await login(page, 'student@dev.local', /\/app/);
    await page.goto('/app/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('AppFlashcardDecksPage.new_deck') }).click();
    await page.getByLabel(t('AppFlashcardDecksPage.name_label')).fill('Bulk Delete Deck');
    await page.getByRole('checkbox').first().click();
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Bulk Delete Deck').first()).toBeVisible();

    await page.getByText('Bulk Delete Deck').hover();
    await page.getByRole('button', { name: t('AppFlashcardDecksPage.manage_deck') }).first().click();
    await page.waitForURL(/\/app\/flashcards\/decks\//);
    await page.waitForLoadState('networkidle');

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();
    const menuButton = flashcardCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();
    await page.getByRole('menuitem', { name: t('AppFlashcardDeckViewPage.select_cards') }).click();

    await page.getByRole('checkbox').first().click();

    const deleteButton = page.locator('button').filter({ has: page.locator('svg.lucide-trash-2') }).first();
    await deleteButton.click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: t('Common.common_delete') }).last().click();
    await expect(page.getByText(t('AppFlashcardDeckViewPage.no_flashcards'))).toBeVisible();
  });

  test('topic enters selection mode and clears on escape', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/topics');
    await page.waitForLoadState('networkidle');

    await page.setViewportSize({ width: 375, height: 812 });

    const fabButton = page.locator('button').filter({ has: page.locator('svg.lucide-plus') }).first();
    await fabButton.click();

    await page.getByText(t('EduFlashcardTopicsPage.select_topics')).click();

    await expect(page.getByText(t('EduFlashcardTopicsPage.select_all'))).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText(t('EduFlashcardTopicsPage.select_all'))).not.toBeVisible();
  });

  test('deck enters selection mode from context menu (mobile)', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.setViewportSize({ width: 375, height: 812 });

    const menuButton = page.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') }).first();
    await menuButton.click();
    await page.getByRole('menuitem', { name: t('EduFlashcardDecksPage.select_cards') }).click();

    await expect(page.getByRole('checkbox').first()).toBeVisible();
  });
});
