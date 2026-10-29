import type { Page } from '@playwright/test';
import { expect, loadTenant, loginAs, test } from '@qa/fixtures/qa-tenant';

/**
 * ONB-01 — Nauczyciel bez organizacji → /setup.
 *
 * The prerequisite is a signed-in educator with **no organization**, which is the
 * `bare` tenant profile (`qa/cases/ONB-01.md::ONB-01::qa-shared`):
 *
 *   bun scripts/qa-tenant.ts ONB-01 --profile bare
 *
 * The spec never creates accounts or orgs; it only signs the fixture educator in
 * and observes where the app sends them. Nothing global is written and the tenant
 * owns no org, group, deck or other row that another case could touch, so the
 * three acceptance points are independent of shared mutable state.
 *
 * Polish copy is asserted because the case quotes the Polish UI, and Polish is the
 * suite default; the fixture pins `NEXT_LOCALE=pl` explicitly so a leftover locale
 * cookie from an earlier case cannot change the strings under test.
 */

const TENANT = loadTenant('ONB-01');

const CHOOSER = {
  title: 'Witaj w StudiQ',
  description: 'Skonfiguruj swoją klasę, aby rozpocząć.',
  join: 'Dołącz do istniejącej organizacji',
  create: 'Utwórz własną klasę',
  back: 'Wróć',
} as const;

/**
 * The on-screen precondition: the account really has zero organizations.
 * Asserting it here keeps the redirect tests from passing for the wrong reason
 * (`/setup` also renders on an empty list caused by a failed `/me/orgs` call).
 */
async function expectNoOrganizations(page: Page): Promise<void> {
  const response = await page.request.get('/api/v1/me/orgs');
  expect(response.status(), 'GET /api/v1/me/orgs').toBe(200);
  const body = (await response.json()) as { success: boolean; data: unknown[] };
  expect(body.success).toBe(true);
  expect(body.data, 'the fixture educator must belong to no organization').toEqual([]);
}

function chooserHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: CHOOSER.title });
}

test('an educator without an organization lands on the /setup chooser right after login', async ({
  page,
}) => {
  await loginAs(page, TENANT, 'teacher', { locale: 'pl', waitFor: /\/setup$/ });
  await expectNoOrganizations(page);

  // `/login` is where an authenticated user is sent next; the proxy forwards the
  // educator to `/edu`, whose onboarding guard replaces the URL with `/setup`.
  await page.goto('/login');

  await expect(page).toHaveURL(/\/setup$/, { timeout: 20_000 });
  await expect(chooserHeading(page)).toBeVisible();
  await expect(page.getByText(CHOOSER.description)).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(CHOOSER.join) })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(CHOOSER.create) })).toBeVisible();
});

test('/edu redirects an educator without an organization back to /setup', async ({ page }) => {
  await loginAs(page, TENANT, 'teacher', { locale: 'pl', waitFor: /\/setup$/ });
  await expectNoOrganizations(page);

  await page.goto('/edu');

  await expect(page).toHaveURL(/\/setup$/, { timeout: 20_000 });
  await expect(chooserHeading(page)).toBeVisible();
  // The bounce must leave the chooser usable, not just rewrite the URL.
  await expect(page.getByRole('button', { name: new RegExp(CHOOSER.join) })).toBeVisible();
});

test('both chooser options open their setup page and the header returns to the chooser', async ({
  page,
}) => {
  await loginAs(page, TENANT, 'teacher', { locale: 'pl', waitFor: /\/setup$/ });
  await expectNoOrganizations(page);
  await page.goto('/setup');
  await expect(chooserHeading(page)).toBeVisible();

  await page.getByRole('button', { name: new RegExp(CHOOSER.join) }).click();
  await expect(page).toHaveURL(/\/setup\/join$/);

  await page.getByRole('link', { name: CHOOSER.back }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(chooserHeading(page)).toBeVisible();

  await page.getByRole('button', { name: new RegExp(CHOOSER.create) }).click();
  await expect(page).toHaveURL(/\/setup\/classroom$/);

  await page.getByRole('link', { name: CHOOSER.back }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(chooserHeading(page)).toBeVisible();
});
