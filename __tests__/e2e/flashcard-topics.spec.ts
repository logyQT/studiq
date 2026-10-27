import type { Page } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

const topicNamePlaceholder = t('EduFlashcardTopicsPage.topic_name_placeholder');

async function openTopics(page: Page) {
  await page.goto('/edu/topics');
  await page.waitForLoadState('networkidle');
}

function topicCard(page: Page, name: string) {
  return page.locator('.group:visible').filter({ hasText: name }).first();
}

function topicMenu(page: Page, name: string) {
  return topicCard(page, name)
    .locator('button:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first();
}

async function createTopic(page: Page, name: string) {
  await page
    .getByRole('button', { name: t('EduFlashcardTopicsPage.new_topic') })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder(topicNamePlaceholder).fill(name);
  await dialog.getByRole('button', { name: t('Common.common_create') }).click();
  await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
}

test.describe('Flashcard Topic Management', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'teacher');
    await openTopics(page);
  });

  test('creates a new topic', async ({ page }) => {
    await createTopic(page, 'E2E Test Topic');
  });

  test('edits a topic name', async ({ page }) => {
    await createTopic(page, 'Topic To Edit');

    await topicMenu(page, 'Topic To Edit').click();
    await page.getByRole('menuitem', { name: t('Common.common_edit') }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(topicNamePlaceholder).fill('Edited Topic');
    await dialog.getByRole('button', { name: t('Common.common_update') }).click();
    await expect(page.getByText('Edited Topic').filter({ visible: true }).first()).toBeVisible();
  });

  test('deletes a topic', async ({ page }) => {
    await createTopic(page, 'Topic To Delete');

    await topicMenu(page, 'Topic To Delete').click();
    await page.getByRole('menuitem', { name: t('Common.common_delete') }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: t('Common.common_delete') }).click();
    await expect(page.getByText('Topic To Delete')).toHaveCount(0);
  });

  test('clicking a topic card opens view dialog', async ({ page }) => {
    await topicCard(page, 'Topic A').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(t('EduFlashcardTopicsPage.question_label')).first(),
    ).toBeVisible();
  });

  test('view dialog shows flashcards for topic with cards', async ({ page }) => {
    await topicCard(page, 'Topic A').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The content profile assigns deck A's cards to the topic, so this is not
    // the empty variant.
    await expect(dialog.getByText(t('EduFlashcardTopicsPage.no_flashcards_for_topic'))).toHaveCount(
      0,
    );
    await expect(dialog.getByText('Card 1-1 front').first()).toBeVisible();
  });

  test('bulk select topics via FAB on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openTopics(page);

    const dial = page.locator('[data-speed-dial]');
    await dial.locator('button').last().click();
    // Items are icon-only and ordered: new topic, select topics.
    const items = dial
      .locator('button:visible')
      .filter({ hasNot: page.locator('svg.lucide-plus') });
    await items.nth(1).click();

    await expect(page.getByText(t('EduFlashcardTopicsPage.select_all')).first()).toBeVisible();

    await page.getByRole('checkbox').filter({ visible: true }).first().click();
    await expect(page.getByText(/\d+ selected/i).first()).toBeVisible();
  });
});
