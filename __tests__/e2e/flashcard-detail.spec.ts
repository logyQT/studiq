import { expect, test } from '@playwright/test';
import { t } from './utils';

const PASSWORD = 'pass';

async function loginTeacher(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('e2e-teacher1@test.local');
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/edu/);
}

async function loginStudent(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('student@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/app/);
}

test.describe('Flashcard Deck Detail', () => {
  test('loads deck hero card with name and flashcard count', async ({ page }) => {
    await loginTeacher(page);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') })
      .first()
      .click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const heading = page.locator('h2');
    await expect(heading.first()).toBeVisible();
    await expect(page.getByText(t('EduDeckViewPage.flashcards_section'))).toBeVisible();
  });

  test('search filters flashcards', async ({ page }) => {
    await loginTeacher(page);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') })
      .first()
      .click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const searchInput = page.getByPlaceholder(t('EduDeckViewPage.search_placeholder'));
    await expect(searchInput).toBeVisible();
    await searchInput.fill('nonexistent-card-xyz');
    await page.waitForTimeout(500);
    await expect(page.getByText(t('EduDeckViewPage.no_flashcards'))).toBeVisible();
  });

  test('topic filter shows when topics exist', async ({ page }) => {
    await loginTeacher(page);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    const manageButton = page
      .getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') })
      .first();
    await manageButton.click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const topicSelect = page
      .getByRole('combobox')
      .filter({ hasText: t('EduDeckViewPage.topic_all') });
    await expect(topicSelect).toBeVisible();
  });

  test('sort dropdown is visible', async ({ page }) => {
    await loginTeacher(page);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') })
      .first()
      .click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    await expect(
      page
        .getByRole('combobox')
        .filter({ hasText: t('EduDeckViewPage.sort_newest') })
        .first(),
    ).toBeVisible();
  });

  test('new flashcard button navigates to create page', async ({ page }) => {
    await loginStudent(page);
    await page.goto('/app/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('AppFlashcardDecksPage.new_deck') }).click();
    await page.getByLabel(t('AppFlashcardDecksPage.name_label')).fill('Detail Test Deck');
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Detail Test Deck').first()).toBeVisible();

    await page.getByText('Detail Test Deck').hover();
    await page
      .getByRole('button', { name: t('AppFlashcardDecksPage.manage_deck') })
      .first()
      .click();
    await page.waitForURL(/\/app\/flashcards\/decks\//);

    await page.getByRole('button', { name: t('AppFlashcardDeckViewPage.new_flashcard') }).click();
    await expect(page).toHaveURL(/\/new$/);
  });

  test('keyboard shortcut n navigates to new flashcard', async ({ page }) => {
    await loginStudent(page);
    await page.goto('/app/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('AppFlashcardDecksPage.new_deck') }).click();
    await page.getByLabel(t('AppFlashcardDecksPage.name_label')).fill('Shortcut Deck');
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Shortcut Deck').first()).toBeVisible();

    await page.getByText('Shortcut Deck').hover();
    await page
      .getByRole('button', { name: t('AppFlashcardDecksPage.manage_deck') })
      .first()
      .click();
    await page.waitForURL(/\/app\/flashcards\/decks\//);

    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/new$/);
  });

  test('flip card practice button navigates to session', async ({ page }) => {
    await loginTeacher(page);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    const manageButton = page
      .getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') })
      .first();
    await manageButton.click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const practiceButton = page.getByRole('button', { name: t('EduDeckViewPage.practice_deck') });
    if (await practiceButton.isVisible()) {
      await practiceButton.click();
      await expect(page).toHaveURL(/session/);
    }
  });

  test('flashcard link dialog opens from context menu', async ({ page }) => {
    await loginTeacher(page);
    await page.goto('/edu/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: t('EduFlashcardDecksPage.manage_deck') })
      .first()
      .click();
    await page.waitForURL(/\/edu\/flashcards\/decks\//);

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();

    const menuButton = flashcardCard
      .locator('button')
      .filter({ has: page.locator('svg.lucide-more-vertical') })
      .first();
    await menuButton.click();

    await page.getByRole('menuitem', { name: t('EduDeckViewPage.menu_link') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('EduDeckViewPage.link_title'))).toBeVisible();
  });

  test('flashcard delete removes it from grid', async ({ page }) => {
    await loginStudent(page);
    await page.goto('/app/flashcards/decks');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('AppFlashcardDecksPage.new_deck') }).click();
    await page.getByLabel(t('AppFlashcardDecksPage.name_label')).fill('Delete Test Deck');
    await page.getByRole('checkbox').first().click();
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Delete Test Deck').first()).toBeVisible();

    await page.getByText('Delete Test Deck').hover();
    await page
      .getByRole('button', { name: t('AppFlashcardDecksPage.manage_deck') })
      .first()
      .click();
    await page.waitForURL(/\/app\/flashcards\/decks\//);
    await page.waitForLoadState('networkidle');

    const flashcardCard = page.locator('.group').first();
    await flashcardCard.hover();

    const menuButton = flashcardCard
      .locator('button')
      .filter({ has: page.locator('svg.lucide-more-vertical') })
      .first();
    await menuButton.click();

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
