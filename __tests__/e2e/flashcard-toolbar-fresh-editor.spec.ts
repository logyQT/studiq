import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

// Regression for #330: on a freshly opened „Nowa Fiszka" dialog the Markdown toolbar did
// nothing until the first keystroke. Unlike flashcard-editor.spec.ts, these tests never
// type into the textarea before using the toolbar, which is what hid the bug.

async function openFreshFlashcardDialog(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('student1@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill('pass');
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/app/);

  await page.goto('/app/flashcards');
  await page.waitForLoadState('networkidle');

  // Seeded personal deck of student1.
  await page
    .locator('div', { has: page.getByText('O1S1', { exact: true }) })
    .getByRole('button', { name: t('AppFlashcardDecksPage.manage_deck') })
    .last()
    .click();
  await page.waitForURL(/\/app\/flashcards\/[^/]+$/);

  await page.getByRole('button', { name: t('AppFlashcardDeckViewPage.new_flashcard') }).click();

  const front = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));
  await expect(front).toBeVisible();
  await expect(front).toHaveValue('');
  return front;
}

test.describe('Markdown toolbar on a freshly opened flashcard dialog', () => {
  test('bold works without typing first', async ({ page }) => {
    const front = await openFreshFlashcardDialog(page);

    await front.click();
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_bold') }).click();

    const defaultText = t('FlashcardEditorComponent.bold_default_text').source;
    await expect(front).toHaveValue(new RegExp(`^\\*\\*(${defaultText})\\*\\*$`, 'i'));
  });

  test('heading 1 and bullet list work without typing first', async ({ page }) => {
    const front = await openFreshFlashcardDialog(page);

    await front.click();
    await page
      .getByRole('button', { name: t('FlashcardEditorComponent.toolbar_heading1') })
      .click();
    await expect(front).toHaveValue(/^# /);

    await front.fill('');
    // Wait for the controlled value to settle: clicking the toolbar before the
    // editor state catches up applies the bullet marker to the stale heading.
    await expect(front).toHaveValue('');
    await front.click();
    await page
      .getByRole('button', { name: t('FlashcardEditorComponent.toolbar_bullet_list') })
      .click();
    await expect(front).toHaveValue(/^- /);
  });
});
