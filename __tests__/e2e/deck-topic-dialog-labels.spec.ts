import type { Locator, Page } from '@playwright/test';
import en from '@/i18n/messages/en.json';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

// #680: every field of the deck and topic dialogs is reached by its accessible name, as a
// screen reader announces it. The tenant fixtures pin English, and the names are matched
// exactly: a placeholder standing in for a missing label must not pass.

// `i18n/request.ts` folds `Common` into every namespace, so the app's copy of one is both.
const common = en.Common;
const decks = { ...common, ...en.EduFlashcardDecksPage };
const topics = { ...common, ...en.EduFlashcardTopicsPage };
const view = { ...common, ...en.EduDeckViewPage };
const exact = { exact: true } as const;

const field = (scope: Locator, name: string) => scope.getByLabel(name, exact);
const named = (scope: Locator, role: 'combobox' | 'radiogroup' | 'textbox', name: string) =>
  scope.getByRole(role, { name, ...exact });

function cardMenu(page: Page, text: string) {
  return page
    .locator('.group:visible')
    .filter({ hasText: text })
    .first()
    .locator('button:visible')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .first();
}

/** Switches a form to group visibility, picks the first group and checks it stays readable. */
async function pickAGroup(page: Page, dialog: Locator, labels: typeof decks | typeof topics) {
  const visibility = named(dialog, 'radiogroup', labels.visibility_label);
  await visibility.getByRole('radio', { name: labels.visibility_group, ...exact }).click();

  const picker = named(dialog, 'combobox', labels.groups_placeholder);
  await picker.click();
  const option = page.getByRole('option').first();
  const group = (await option.innerText()).trim();
  await option.click();
  await page.keyboard.press('Escape');

  // The name stays the picker's label, and the selection stays in its accessible content.
  await expect(picker).toContainText(group);
  await expect(picker).toMatchAriaSnapshot(`- combobox "${labels.groups_placeholder}": /.+/`);

  await visibility.getByRole('radio', { name: labels.visibility_personal, ...exact }).click();
}

test.describe('Deck and topic dialog field names', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'teacher');
  });

  test('creates and edits a deck through named fields', async ({ page }) => {
    await page.goto('/edu/flashcards');
    await page.getByRole('button', { name: decks.new_deck }).first().click();
    const dialog = page.getByRole('dialog');

    await field(dialog, decks.name_label).fill('Labelled Deck');
    await field(dialog, decks.description_label).fill('Filled by label');
    await pickAGroup(page, dialog, decks);
    await dialog.getByRole('button', { name: common.common_create, ...exact }).click();
    await expect(page.getByText('Labelled Deck').filter({ visible: true }).first()).toBeVisible();

    await cardMenu(page, 'Labelled Deck').click();
    await page.getByRole('menuitem', { name: common.common_edit, ...exact }).click();
    await expect(field(dialog, decks.name_label)).toHaveValue('Labelled Deck');
    await expect(field(dialog, decks.description_label)).toHaveValue('Filled by label');
    await field(dialog, decks.name_label).fill('Relabelled Deck');
    await dialog.getByRole('button', { name: common.common_update, ...exact }).click();
    await expect(page.getByText('Relabelled Deck').filter({ visible: true }).first()).toBeVisible();
  });

  test('creates and edits a topic through named fields', async ({ page }) => {
    await page.goto('/edu/topics');
    await page.getByRole('button', { name: topics.new_topic }).first().click();
    const dialog = page.getByRole('dialog');

    await field(dialog, topics.topic_name_label).fill('Labelled Topic');
    await pickAGroup(page, dialog, topics);
    await dialog.getByRole('button', { name: common.common_create, ...exact }).click();
    await expect(page.getByText('Labelled Topic').filter({ visible: true }).first()).toBeVisible();

    await cardMenu(page, 'Labelled Topic').click();
    await page.getByRole('menuitem', { name: common.common_edit, ...exact }).click();
    await expect(field(dialog, topics.topic_name_label)).toHaveValue('Labelled Topic');
    await field(dialog, topics.topic_name_label).fill('Relabelled Topic');
    await dialog.getByRole('button', { name: common.common_update, ...exact }).click();
    await expect(
      page.getByText('Relabelled Topic').filter({ visible: true }).first(),
    ).toBeVisible();
  });

  test('names the fields of the deck view dialogs', async ({ page }) => {
    await page.goto('/edu/flashcards');
    await page
      .locator('.group:visible')
      .filter({ hasText: 'Deck A' })
      .first()
      .getByRole('button', { name: decks.manage_deck })
      .click();
    await page.waitForURL(/\/edu\/flashcards\/[0-9a-f-]{36}$/);
    const dialog = page.getByRole('dialog');

    await page.getByRole('button', { name: en.A11y.more_actions_deck, ...exact }).click();
    await page.getByRole('menuitem', { name: view.menu_edit, ...exact }).click();
    await expect(field(dialog, view.deck_name_label)).toHaveValue('Deck A');
    await expect(field(dialog, view.deck_description_label)).toBeVisible();
    await expect(named(dialog, 'radiogroup', view.visibility_label)).toBeVisible();
    await dialog.getByRole('button', { name: common.common_cancel, ...exact }).click();
    await expect(dialog).toHaveCount(0);

    const openTopicDialog = async (item: string) => {
      await page.locator('.group:visible').filter({ hasText: 'Card 1-1 front' }).first().hover();
      await cardMenu(page, 'Card 1-1 front').click();
      await page.getByRole('menuitem', { name: view.menu_topics, ...exact }).click();
      await page.getByRole('menuitem', { name: item, ...exact }).click();
    };

    await openTopicDialog(view.menu_add_topic);
    await named(dialog, 'textbox', view.add_topic_input_placeholder).fill('Typed By Name');
    await expect(dialog.getByRole('button', { name: /Typed By Name/ })).toBeVisible();
    await dialog.getByRole('button', { name: common.common_cancel, ...exact }).click();
    await expect(dialog).toHaveCount(0);

    await openTopicDialog(view.menu_manage_topics);
    const picker = named(dialog, 'combobox', view.manage_topic_title);
    await picker.click();
    const option = page.getByRole('option').first();
    const topic = (await option.innerText()).trim();
    const wasSelected = (await picker.innerText()).includes(topic);
    await option.click();
    await page.keyboard.press('Escape');
    if (wasSelected) await expect(picker).not.toContainText(topic);
    else await expect(picker).toContainText(topic);
  });
});
