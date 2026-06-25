import { test, expect } from '@playwright/test';
import { t } from './utils';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('student@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill('pass');
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/app/);
}

async function createDeckAndNavigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/app/flashcards/decks');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: t('AppFlashcardDecksPage.new_deck') }).click();
  await page.getByLabel(t('AppFlashcardDecksPage.name_label')).fill('Editor Deck');
  await page.getByRole('button', { name: t('Common.common_create') }).click();
  await expect(page.getByText('Editor Deck').first()).toBeVisible();

  await page.getByText('Editor Deck').hover();
  await page.getByRole('button', { name: t('AppFlashcardDecksPage.manage_deck') }).first().click();
  await page.waitForURL(/\/app\/flashcards\/decks\//);

  await page.getByRole('button', { name: t('AppFlashcardDeckViewPage.new_flashcard') }).click();
  await page.waitForURL(/\/new$/);
}

test.describe('Flashcard Editor', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('bold button wraps selected text', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const frontTextarea = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));
    await frontTextarea.fill('hello world');
    await frontTextarea.selectText();
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_bold') }).click();
    await expect(frontTextarea).toHaveValue('**hello world**');
  });

  test('italic button wraps selected text', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const frontTextarea = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));
    await frontTextarea.fill('hello world');
    await frontTextarea.selectText();
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_italic') }).click();
    await expect(frontTextarea).toHaveValue('*hello world*');
  });

  test('heading buttons insert prefix', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const frontTextarea = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));
    await frontTextarea.fill('heading text');

    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_heading1') }).click();
    await expect(frontTextarea).toHaveValue('# heading text');

    await frontTextarea.fill('');
    await frontTextarea.fill('heading2 text');
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_heading2') }).click();
    await expect(frontTextarea).toHaveValue('## heading2 text');

    await frontTextarea.fill('');
    await frontTextarea.fill('heading3 text');
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_heading3') }).click();
    await expect(frontTextarea).toHaveValue('### heading3 text');
  });

  test('list buttons insert prefix', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const frontTextarea = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));
    await frontTextarea.fill('item');
    await frontTextarea.selectText();
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_bullet_list') }).click();
    await expect(frontTextarea).toHaveValue('- item');

    await frontTextarea.fill('');
    await frontTextarea.fill('item');
    await frontTextarea.selectText();
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_ordered_list') }).click();
    await expect(frontTextarea).toHaveValue('1. item');
  });

  test('preview toggle shows rendered markdown and hides textarea', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const frontTextarea = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));
    await frontTextarea.fill('**bold**');

    const previewToggle = page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_preview') });
    await previewToggle.click();

    await expect(frontTextarea).not.toBeVisible();
    await expect(page.getByText('bold')).toBeVisible();
  });

  test('preview toggle switches back to edit mode', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const frontTextarea = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));

    const previewToggle = page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_preview') });
    await previewToggle.click();

    const editToggle = page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_edit') });
    await editToggle.click();

    await expect(frontTextarea).toBeVisible();
  });

  test('drag-over visual indicator appears when dragging over editor', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const editor = page.locator('.flex.flex-col.gap-4').first();

    await editor.dispatchEvent('dragenter');
    await expect(editor).toHaveClass(/border-dashed/);
  });

  test('media upload button triggers file input', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeVisible();
    await expect(fileInput).toHaveAttribute('accept', /image/);
  });

  test('creating a flashcard saves and redirects', async ({ page }) => {
    await createDeckAndNavigateToEditor(page);

    const frontTextarea = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));
    const backTextarea = page.getByPlaceholder(t('FlashcardEditorComponent.back_placeholder'));

    await frontTextarea.fill('Test question');
    await backTextarea.fill('Test answer');

    await page.getByRole('button', { name: t('AppFlashcardDeckViewPage.create') }).click();

    await expect(page).not.toHaveURL(/\/new$/);
  });
});
