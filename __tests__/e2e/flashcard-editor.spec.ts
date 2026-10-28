import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

// The Markdown editor lives in CreateCardDialog (opened from the deck view), not on a
// dedicated /new page. There is deliberately no Edit/Preview toggle: the textareas and a
// live Markdown preview render side by side (see issue #333 / design for STU-21 step 3).

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill('student1@dev.local');
  await page.getByLabel(t('LoginPage.password_label')).fill('pass');
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/app/);
}

async function openFlashcardDialog(page: Page) {
  await login(page);

  await page.goto('/app/flashcards');

  // Seeded personal deck of student1 (supabase/seeds/01_seed.sql).
  await page
    .locator('div', { has: page.getByText('O1S1', { exact: true }) })
    .getByRole('button', { name: t('AppFlashcardDecksPage.manage_deck') })
    .last()
    .click();
  await page.waitForURL(/\/app\/flashcards\/[^/]+$/);

  await page.getByRole('button', { name: t('AppFlashcardDeckViewPage.new_flashcard') }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const front = page.getByPlaceholder(t('FlashcardEditorComponent.front_placeholder'));
  const back = page.getByPlaceholder(t('FlashcardEditorComponent.back_placeholder'));
  await expect(front).toBeVisible();
  await expect(front).toHaveValue('');
  return { dialog, front, back };
}

test.describe('Flashcard Editor', () => {
  test('bold button wraps selected text', async ({ page }) => {
    const { front } = await openFlashcardDialog(page);

    await front.fill('hello world');
    await front.selectText();
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_bold') }).click();
    await expect(front).toHaveValue('**hello world**');
  });

  test('italic button wraps selected text', async ({ page }) => {
    const { front } = await openFlashcardDialog(page);

    await front.fill('hello world');
    await front.selectText();
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_italic') }).click();
    await expect(front).toHaveValue('*hello world*');
  });

  test('link button asks for a URL and inserts Markdown link syntax', async ({ page }) => {
    const { front } = await openFlashcardDialog(page);

    await front.fill('hello world');
    await front.selectText();
    await page.getByRole('button', { name: t('FlashcardEditorComponent.toolbar_link') }).click();
    await page
      .getByPlaceholder(t('FlashcardEditorComponent.link_url_prompt'))
      .fill('https://example.com');
    await page.keyboard.press('Enter');
    await expect(front).toHaveValue('[hello world](https://example.com)');
  });

  test('heading buttons insert prefix', async ({ page }) => {
    const { dialog, front } = await openFlashcardDialog(page);

    await front.fill('heading text');
    await front.selectText();
    await page
      .getByRole('button', { name: t('FlashcardEditorComponent.toolbar_heading1') })
      .click();
    await expect(front).toHaveValue('# heading text');

    // wrapSelection() restores the wrapped selection on the next animation frame. Waiting for
    // the 300 ms-debounced preview proves that frame has run; select-all then makes the clear
    // independent of the restored selection (#333 review 2). The preview headings are matched
    // by accessible name because the dialog title itself renders as an <h2>.
    await expect(dialog.getByRole('heading', { name: 'heading text', level: 1 })).toHaveText(
      'heading text',
    );
    await front.selectText();
    await front.fill('');
    await expect(front).toHaveValue('');

    await front.fill('heading2 text');
    await expect(front).toHaveValue('heading2 text');
    await front.selectText();
    await page
      .getByRole('button', { name: t('FlashcardEditorComponent.toolbar_heading2') })
      .click();
    await expect(front).toHaveValue('## heading2 text');

    await expect(dialog.getByRole('heading', { name: 'heading2 text', level: 2 })).toHaveText(
      'heading2 text',
    );
    await front.selectText();
    await front.fill('');
    await expect(front).toHaveValue('');

    await front.fill('heading3 text');
    await expect(front).toHaveValue('heading3 text');
    await front.selectText();
    await page
      .getByRole('button', { name: t('FlashcardEditorComponent.toolbar_heading3') })
      .click();
    await expect(front).toHaveValue('### heading3 text');
  });

  test('list buttons insert prefix', async ({ page }) => {
    const { dialog, front } = await openFlashcardDialog(page);

    await front.fill('item');
    await front.selectText();
    await page
      .getByRole('button', { name: t('FlashcardEditorComponent.toolbar_bullet_list') })
      .click();
    await expect(front).toHaveValue('- item');

    // Same reset as the heading test: the debounced preview proves wrapSelection()'s pending
    // animation frame has run before the textarea is cleared (#333 review 2).
    await expect(dialog.locator('ul li')).toHaveText('item');
    await front.selectText();
    await front.fill('');
    await expect(front).toHaveValue('');

    await front.fill('item');
    await expect(front).toHaveValue('item');
    await front.selectText();
    await page
      .getByRole('button', { name: t('FlashcardEditorComponent.toolbar_ordered_list') })
      .click();
    await expect(front).toHaveValue('1. item');
  });

  test('live preview renders Markdown next to the still-visible editor', async ({ page }) => {
    const { dialog, front } = await openFlashcardDialog(page);

    await front.fill('**bold** and *italic*');

    await expect(dialog.locator('strong')).toHaveText('bold');
    await expect(dialog.locator('em')).toHaveText('italic');
    // No mode switch: the editor stays visible while the preview renders.
    await expect(front).toBeVisible();

    // The issue's core symptom: this editor has no Edit/Preview mode switch. The
    // toolbar_edit/toolbar_preview keys were deleted, so pin both locale labels literally.
    await expect(
      dialog.getByRole('button', { name: /^(Edytuj|Podgląd|Edit|Preview)$/i }),
    ).toHaveCount(0);
  });

  test('media upload button opens the file picker', async ({ page }) => {
    await openFlashcardDialog(page);

    const chooserPromise = page.waitForEvent('filechooser');
    await page
      .getByRole('button', { name: t('FlashcardEditorComponent.toolbar_upload_media') })
      .click();
    const accept = await (await chooserPromise).element().getAttribute('accept');
    expect(accept).toContain('image/png');
  });

  test('creating a flashcard saves and closes the dialog', async ({ page }) => {
    const { dialog, front, back } = await openFlashcardDialog(page);

    const question = `E2E question ${Date.now()}`;
    await front.fill(question);
    await back.fill('Test answer');

    const created = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/flashcards',
    );
    await dialog.getByRole('button', { name: t('AppFlashcardDeckViewPage.create') }).click();
    const response = await created;
    const payload = (await response.json()) as { data?: { id?: string } } | null;
    const id = payload?.data?.id;

    try {
      expect(response.status()).toBe(201);
      expect(id, 'create response must carry the new card id').toBeTruthy();
      await expect(dialog).toBeHidden();
      // The deck view renders the card list for both mobile and desktop layouts; only one
      // copy is visible at this viewport.
      await expect(page.getByText(question).filter({ visible: true }).first()).toBeVisible();
    } finally {
      // Keep the seeded O1S1 deck below Base's max_flashcards (100) on long-lived QA envs.
      if (id) {
        const cleanup = await page.request.delete(
          `${new URL(page.url()).origin}/api/v1/flashcards/${id}`,
        );
        expect(cleanup.ok()).toBeTruthy();
      }
    }
  });
});
