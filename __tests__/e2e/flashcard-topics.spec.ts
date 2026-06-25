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

test.describe('Flashcard Topic Management', () => {
  test('creates a new topic', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/topics');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardTopicsPage.new_topic') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(t('EduFlashcardTopicsPage.topic_name_label')).fill('E2E Test Topic');
    await page.getByRole('button', { name: t('Common.common_create') }).click();

    await expect(page.getByText('E2E Test Topic').first()).toBeVisible();
  });

  test('edits a topic name', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/topics');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardTopicsPage.new_topic') }).click();
    await page.getByLabel(t('EduFlashcardTopicsPage.topic_name_label')).fill('Topic To Edit');
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Topic To Edit').first()).toBeVisible();

    const topicCard = page.locator('.group').filter({ hasText: 'Topic To Edit' }).first();
    await topicCard.hover();
    const menuButton = topicCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') });
    await menuButton.click();

    await page.getByRole('menuitem', { name: t('Common.common_edit') }).click();
    await page.getByLabel(t('EduFlashcardTopicsPage.topic_name_label')).fill('Edited Topic');
    await page.getByRole('button', { name: t('Common.common_update') }).click();
    await expect(page.getByText('Edited Topic').first()).toBeVisible();
  });

  test('deletes a topic', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/topics');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: t('EduFlashcardTopicsPage.new_topic') }).click();
    await page.getByLabel(t('EduFlashcardTopicsPage.topic_name_label')).fill('Topic To Delete');
    await page.getByRole('button', { name: t('Common.common_create') }).click();
    await expect(page.getByText('Topic To Delete').first()).toBeVisible();

    const topicCard = page.locator('.group').filter({ hasText: 'Topic To Delete' }).first();
    await topicCard.hover();
    const menuButton = topicCard.locator('button').filter({ has: page.locator('svg.lucide-more-vertical') });
    await menuButton.click();

    await page.getByRole('menuitem', { name: t('Common.common_delete') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: t('Common.common_delete') }).last().click();
    await expect(page.getByText('Topic To Delete')).not.toBeVisible();
  });

  test('clicking a topic card opens view dialog', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/topics');
    await page.waitForLoadState('networkidle');

    const firstTopicLink = page.getByText(t('EduFlashcardTopicsPage.view_flashcards')).first();
    const topicCard = firstTopicLink.locator('..').locator('..');
    await topicCard.click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('EduFlashcardTopicsPage.question_label'))).toBeVisible();
  });

  test('view dialog shows flashcards for topic with cards', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/topics');
    await page.waitForLoadState('networkidle');

    const firstTopicLink = page.getByText(t('EduFlashcardTopicsPage.view_flashcards')).first();
    const topicCard = firstTopicLink.locator('..').locator('..');
    await topicCard.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const noFlashcards = dialog.getByText(t('EduFlashcardTopicsPage.no_flashcards_for_topic'));
    if (!(await noFlashcards.isVisible())) {
      await expect(dialog.getByText(t('EduFlashcardTopicsPage.question_label'))).toBeVisible();
      await expect(dialog.getByText(t('EduFlashcardTopicsPage.answer_label'))).toBeVisible();
    }
  });

  test('bulk select topics via FAB on mobile', async ({ page }) => {
    await login(page, 'e2e-teacher1@test.local', /\/edu/);
    await page.goto('/edu/flashcards/topics');
    await page.waitForLoadState('networkidle');

    await page.setViewportSize({ width: 375, height: 812 });

    const fabButton = page.locator('button').filter({ has: page.locator('svg.lucide-plus') }).first();
    await fabButton.click();

    await page.getByText(t('EduFlashcardTopicsPage.select_topics')).click();
    await expect(page.getByText(t('EduFlashcardTopicsPage.select_all'))).toBeVisible();

    await page.getByRole('checkbox').first().click();
    await expect(page.getByText(t('EduFlashcardTopicsPage.n_selected'))).toBeVisible();
  });
});
