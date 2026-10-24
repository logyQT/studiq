import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const email = 'teacher1@dev.local';
const password = 'pass';

const newBankButton = t('QuestionBankManagement.new_bank');
const editBankTitle = t('QuestionBankManagement.edit_bank');
const deleteBankTitle = t('QuestionBankManagement.delete_title');
const bankUpdated = t('QuestionBankManagement.bank_updated');
const bankDeleted = t('QuestionBankManagement.bank_deleted');
const editItem = t('Common.common_edit');
const deleteItem = t('Common.common_delete');
const createButton = t('Common.common_create');
const updateButton = t('Common.common_update');
const cancelButton = t('Common.common_cancel');

function uniqueBankName(prefix: string) {
  return `QA371 ${prefix} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(password);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/edu/);
  // Login ends with router.refresh(); wait for that transition to finish so the
  // dashboard is interactive and cannot remount the screen under our clicks.
  await page.waitForLoadState('networkidle');
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

// Client-side navigation from the already-hydrated dashboard (as other edu specs do):
// a full page load right after login can still remount the screen and drop dialog state.
async function openBanksPage(page: Page) {
  await page.getByRole('link', { name: t('DashboardLayout.edu_questions') }).click();
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

async function deleteBankFromMenu(page: Page, name: string) {
  await cardFor(page, name).hover();
  await cardMenuTrigger(page, name).click();
  await page.getByRole('menuitem', { name: deleteItem }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: deleteBankTitle })).toBeVisible();
  await dialog.getByRole('button', { name: deleteItem }).click();

  await expect(page.getByText(bankDeleted).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
}

test.describe('Question bank card menu', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await openBanksPage(page);
  });

  test('Edit from the card menu updates the bank without leaving the list', async ({ page }) => {
    const name = uniqueBankName('Edit');
    const renamed = `${name} renamed`;
    await createBank(page, name);

    await cardFor(page, name).hover();
    await cardMenuTrigger(page, name).click();
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
    await expect(page.getByRole('menuitem', { name: editItem })).toBeVisible();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: editBankTitle })).toBeVisible();
    await expect(page).toHaveURL(/\/edu\/questions\/?$/);
    await dialog.getByRole('button', { name: cancelButton }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/edu\/questions\/?$/);

    await deleteBankFromMenu(page, name);
  });
});
