import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { json } from '#test/helpers/json';

/**
 * Regression spec for #1225 — `/edu/assignments/<missing-id>/edit` kept its
 * loading skeleton for the life of the page: the guard was `isLoading || !assignment`,
 * and a 404 settles the query with no data, so the pulse bar never went away.
 *
 * The spec drives the real 404 rather than stubbing it: the API answers
 * `NOT_FOUND` in milliseconds, which is exactly the state the issue reported.
 */

const PASSWORD = 'pass';
const TEACHER_EMAIL = 'teacher-classroom@dev.local';
const MISSING_ID = '00000000-0000-4000-8000-000000000099';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(TEACHER_EMAIL);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/edu/);

  // Login does not set the active-org cookie; the app pins it right after the
  // redirect (`useOrgs`), and the assignment request is org-scoped.
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/v1/me/orgs');
        if (!res.ok()) return false;
        const { data } = await json<{ data?: Array<{ isActive: boolean }> }>(res);
        return (data ?? []).some((org) => org.isActive);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.waitForURL(/\/edu/);
}

test.describe('assignment edit page for a missing id (#1225)', () => {
  test('renders the not-found state with a way back instead of an endless skeleton', async ({
    page,
  }) => {
    await login(page);

    const detail404 = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return (
        res.request().method() === 'GET' &&
        url.pathname === `/api/v1/teacher/assignments/${MISSING_ID}`
      );
    });
    await page.goto(`/edu/assignments/${MISSING_ID}/edit`);

    const notFoundResponse = await detail404;
    expect(notFoundResponse.status()).toBe(404);
    expect(notFoundResponse.headers()['x-error-code']).toBe('NOT_FOUND');
    // The trace id the PR cites: the page's failure is a server-side 404, not a client fault.
    test.info().annotations.push({
      type: 'trace-id',
      description: notFoundResponse.headers()['x-trace-id'] ?? 'missing',
    });

    const notFound = page.getByText(t('EduAssignmentDetailPage.not_found'));
    await expect(notFound).toBeVisible();
    await expect(page.locator('.animate-pulse')).toHaveCount(0);

    // Reload is the other half of the report: the skeleton came back every time.
    await page.reload();
    await expect(notFound).toBeVisible();
    await expect(page.locator('.animate-pulse')).toHaveCount(0);

    await page.getByRole('link', { name: t('EduAssignmentDetailPage.back') }).click();
    await page.waitForURL(/\/edu\/assignments$/);
  });

  test('the detail page keeps its not-found state for the same id', async ({ page }) => {
    await login(page);

    await page.goto(`/edu/assignments/${MISSING_ID}`);

    await expect(page.getByText(t('EduAssignmentDetailPage.not_found'))).toBeVisible();
  });
});
