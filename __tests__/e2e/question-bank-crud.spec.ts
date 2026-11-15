import type { Page } from '@playwright/test';
import { sidebarLink, t } from '#test/e2e/utils';
import { expect, test } from '#test/e2e/fixtures/tenant';
import { json } from '#test/helpers/json';

const newBankButton = t('QuestionBankManagement.new_bank');
const editBankTitle = t('QuestionBankManagement.edit_bank');
const deleteBankTitle = t('QuestionBankManagement.delete_title');
const bankUpdated = t('QuestionBankManagement.bank_updated');
const bankDeleted = t('QuestionBankManagement.bank_deleted');
const editItem = t('Common.common_edit');
const deleteItem = t('Common.common_delete');
const manageItem = t('Common.common_manage');
const selectItem = t('QuestionBankManagement.select_banks');
const createButton = t('Common.common_create');
const updateButton = t('Common.common_update');
const cancelButton = t('Common.common_cancel');

function uniqueBankName(prefix: string) {
  return `QA371 ${prefix} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

// The card renders both the mobile and the desktop layout; only one is visible per viewport.
function visibleBankName(page: Page, name: string) {
  return page.getByText(name, { exact: true }).filter({ visible: true }).first();
}

function cardFor(page: Page, name: string) {
  return page.locator('.group').filter({ hasText: name }).first();
}

function cardMenuTrigger(page: Page, name: string) {
  return cardFor(page, name)
    .locator('button')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .filter({ visible: true })
    .first();
}

async function openCardMenu(page: Page, name: string) {
  await cardFor(page, name).hover();
  await cardMenuTrigger(page, name).click();
}

// Client-side navigation from the already-hydrated dashboard (as other edu specs do):
// a full page load right after login can still remount the screen and drop dialog state.
async function openBanksPage(page: Page) {
  await sidebarLink(page, 'DashboardLayout.edu_questions').click();
  await page.waitForURL(/\/edu\/questions/);
  await expect(page.getByRole('button', { name: newBankButton }).first()).toBeVisible();
}

async function createBank(page: Page, name: string) {
  await page.getByRole('button', { name: newBankButton }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: newBankButton })).toBeVisible();

  await page.locator('#bank-name').fill(name);
  await dialog.getByRole('button', { name: createButton }).click();

  await expect(dialog).not.toBeVisible();
  await expect(visibleBankName(page, name)).toBeVisible({ timeout: 10_000 });
}

/**
 * The id of a bank the list is showing, read from the endpoint the screen itself calls —
 * so a menu item can be asserted to open *that* card rather than any uuid-shaped detail.
 */
async function bankIdByName(page: Page, name: string): Promise<string> {
  const res = await page.request.get(`/api/v1/questions/banks?q=${encodeURIComponent(name)}`);
  expect(res.status(), await res.text()).toBe(200);
  const body = await json<{ data: { items: Array<{ id: string; name: string }> } }>(res);
  const bank = body.data.items.find((item) => item.name === name);
  expect(bank, `bank "${name}" missing from the list response`).toBeTruthy();
  return bank!.id;
}

async function deleteBankFromMenu(page: Page, name: string) {
  await openCardMenu(page, name);
  await page.getByRole('menuitem', { name: deleteItem }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: deleteBankTitle })).toBeVisible();
  await dialog.getByRole('button', { name: deleteItem }).click();

  await expect(page.getByText(bankDeleted).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
}

test.describe('Question bank card menu', () => {
  test.beforeEach(async ({ page, loginAs }) => {
    await loginAs('teacher');
    await openBanksPage(page);
  });

  test('Edit from the card menu updates the bank without leaving the list', async ({ page }) => {
    const name = uniqueBankName('Edit');
    const renamed = `${name} renamed`;
    await createBank(page, name);

    await openCardMenu(page, name);
    await page.getByRole('menuitem', { name: editItem }).click();

    // Regression #371: activating the item must not bubble to the clickable card
    // (which would router.push to the bank detail and unmount the dialog).
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: editBankTitle })).toBeVisible();
    await expect(page).toHaveURL(/\/edu\/questions\/?$/);

    await page.locator('#bank-name').fill(renamed);
    await dialog.getByRole('button', { name: updateButton }).click();

    await expect(page.getByText(bankUpdated).first()).toBeVisible({ timeout: 10_000 });
    await expect(dialog).not.toBeVisible();
    await expect(visibleBankName(page, renamed)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/edu\/questions\/?$/);

    // The propagation barrier lives inside the portaled menu only: the card body
    // must still navigate to the bank detail page.
    await cardFor(page, renamed).click({ position: { x: 24, y: 24 } });
    await expect(page).toHaveURL(/\/edu\/questions\/[0-9a-f-]{36}/);
    await page.goBack();
    await expect(visibleBankName(page, renamed)).toBeVisible({ timeout: 10_000 });

    await deleteBankFromMenu(page, renamed);
  });

  test('Keyboard-activated Edit and menu Delete keep the user on the list', async ({ page }) => {
    const name = uniqueBankName('Keyboard');
    await createBank(page, name);

    await cardFor(page, name).hover();
    const trigger = cardMenuTrigger(page, name);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const editMenuItem = page.getByRole('menuitem', { name: editItem });
    await expect(editMenuItem).toBeVisible();
    // Activate Edit itself: the menu now opens on „Wybierz banki”, not on Edit.
    await editMenuItem.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: editBankTitle })).toBeVisible();
    await expect(page).toHaveURL(/\/edu\/questions\/?$/);
    await dialog.getByRole('button', { name: cancelButton }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/edu\/questions\/?$/);

    await deleteBankFromMenu(page, name);
  });

  test('Manage from the card menu opens the bank detail, not bulk selection', async ({ page }) => {
    const name = uniqueBankName('Manage');
    await createBank(page, name);
    const bankId = await bankIdByName(page, name);

    await openCardMenu(page, name);
    await page.getByRole('menuitem', { name: manageItem }).click();

    // Regression #1127: „Zarządzaj” used to enter selection mode and stay on the list.
    // Pin the clicked card — a uuid-shaped URL alone would pass for any other bank.
    await expect(page).toHaveURL(new RegExp(`/edu/questions/${bankId}$`));
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
    await page.goBack();
    await expect(visibleBankName(page, name)).toBeVisible({ timeout: 10_000 });

    await deleteBankFromMenu(page, name);
  });

  test('Manage from the mobile card menu opens the bank detail', async ({ page }) => {
    const name = uniqueBankName('ManageMobile');
    await createBank(page, name);
    const bankId = await bankIdByName(page, name);

    // The toolbar is hidden below `sm`, so create on desktop and switch to the mobile card row.
    await page.setViewportSize({ width: 480, height: 900 });

    // The mobile row has no hover state, so the trigger is always visible.
    await cardMenuTrigger(page, name).click();
    await page.getByRole('menuitem', { name: manageItem }).click();

    await expect(page).toHaveURL(new RegExp(`/edu/questions/${bankId}$`));
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
    await page.goBack();
    await expect(visibleBankName(page, name)).toBeVisible({ timeout: 10_000 });

    await page.setViewportSize({ width: 1280, height: 900 });
    await deleteBankFromMenu(page, name);
  });

  test('Select from the card menu still enters bulk selection', async ({ page }) => {
    const name = uniqueBankName('Select');
    await createBank(page, name);

    await openCardMenu(page, name);
    await page.getByRole('menuitem', { name: selectItem }).click();

    await expect(page).toHaveURL(/\/edu\/questions\/?$/);
    await expect(cardFor(page, name).getByRole('checkbox')).toBeChecked();

    // Escape leaves selection mode so the card menu is reachable for cleanup.
    await page.keyboard.press('Escape');
    await expect(cardMenuTrigger(page, name)).toBeVisible();

    await deleteBankFromMenu(page, name);
  });
});
