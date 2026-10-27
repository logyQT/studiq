import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

/**
 * #360 (STU-31) — a search that matches nothing must not render the
 * “nothing here yet, create your first bank” copy for an account that does own
 * banks. It renders a no-results state naming the query plus a reset action.
 */
const email = 'student-classroom@dev.local';
const password = 'pass';

const searchPlaceholder = t('QuestionBankManagement.search_placeholder');
const newBank = t('QuestionBankManagement.new_bank');
const noBanks = t('QuestionBankManagement.no_banks');
const clearFilters = t('QuestionBankManagement.clear_filters');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(password);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/app/);
  await page.waitForLoadState('networkidle');
}

/** Creates a bank through the API so the collection is guaranteed non-empty. */
async function createBank(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/v1/questions/banks', { data: { name } });

  expect(response.status()).toBe(201);

  const body = await response.json();
  return body.data.id as string;
}

test('A search with no matches shows a no-results state, not the empty-collection copy', async ({
  page,
}) => {
  await login(page);

  const name = `QA360 Bank ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const bankId = await createBank(page, name);

  try {
    await page.goto('/app/questions');

    const bankCard = page.getByText(name, { exact: true }).filter({ visible: true }).first();
    await expect(bankCard).toBeVisible({ timeout: 10_000 });

    const search = page.getByPlaceholder(searchPlaceholder);
    await search.fill('zzzz');

    const empty = page.locator('[data-slot="empty"]');
    await expect(empty).toBeVisible({ timeout: 10_000 });

    const title = empty.locator('[data-slot="empty-title"]');
    await expect(title).toContainText('zzzz');
    await expect(title).not.toHaveText(noBanks);

    // The empty-collection CTA (which nudges existing owners into a duplicate) is gone…
    await expect(empty.getByRole('button', { name: newBank })).toHaveCount(0);
    // …while the toolbar create action stays available.
    await expect(page.getByRole('button', { name: newBank }).first()).toBeVisible();

    await empty.getByRole('button', { name: clearFilters }).click();

    await expect(search).toHaveValue('');
    await expect(bankCard).toBeVisible({ timeout: 10_000 });
    await expect(empty).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/v1/questions/banks/${bankId}`);
  }
});
