import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-SET-05 — branding is withdrawn when the organization loses the plan.
 *
 * Prerequisite (verbatim): „Organizacja z wgranym logo na planie Hub."
 * Step 1: „W panelu admina zmień plan organizacji / wyłącz funkcję branding".
 * Step 2: „Odśwież /manage."
 * Expected:
 *  - the logo disappears from the org switcher even though the file stays in the
 *    database (`organizations.logo_url` is untouched, the storage object is
 *    still readable);
 *  - `/manage/settings` shows the branding lock card instead of the upload and
 *    colour controls.
 *
 * Tenant (deterministic, one per independent run):
 *
 *   bun scripts/qa-tenant.ts MGR-SET-05 --fresh
 *
 * `qa/tests/profiles.json` declares `{ profile: "content", plan: "hub" }`, so the
 * fresh tenant's *own* organization starts on Hub (`apply_org_plan` in the
 * seeder), which is the case's prerequisite. Nothing global is written: no
 * admin setting, feature flag, plan catalogue row or singleton.
 *
 * The plan change itself goes through the app's mock checkout webhook
 * (`POST /api/v1/stripe/webhook` → `MockStripeService.handleWebhook` →
 * `apply_org_plan`), which is the entitlement path a real plan change takes.
 * This build's admin panel has no per-organization plan editor, and the ADM-OVR
 * / ADM-PLN switches are user/global rows a suite test must not mutate; the
 * per-tenant webhook is the equivalent change scoped to this tenant. `launch`
 * is the free manager plan and does not include `branding`, so it reproduces
 * the downgrade; re-buying `hub` at the end proves the gate — not data loss — is
 * what hid the logo.
 */

const CASE = 'MGR-SET-05';

/** Polish copy from `ManageSettingsPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  title: 'Ustawienia',
  logoLabel: 'Logo',
  uploadLogo: 'Wgraj logo',
  logoUpdated: 'Logo zaktualizowane',
  brandColor: 'Kolor marki',
  lockedTitle: 'Własny branding',
  lockedDesc: 'Ulepsz plan, aby uzyskać dostęp do własnego brandingu',
  lockedCta: 'Zobacz plany',
  launchPlan: 'StudiQ Launch',
} as const;

/** A real 1×1 PNG — `storageService` sniffs the bytes, not the file name. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface OrganizationDetail {
  id: string;
  name: string;
  plan: string;
  logo_url: string | null;
  brand_color: string | null;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success`).toBe(true);
  return body.data;
}

async function features(page: Page): Promise<string[]> {
  return (await getJson<{ features: string[] }>(page, '/api/v1/features/me')).features;
}

async function organization(page: Page, orgId: string): Promise<OrganizationDetail> {
  return getJson<OrganizationDetail>(page, `/api/v1/organization/${orgId}`);
}

/**
 * Move this tenant's organization onto `plan` through the app's mock checkout
 * webhook — the same `apply_org_plan` RPC the billing path uses. The endpoint
 * authenticates the caller and only acts on the caller's own account, so this
 * never touches another tenant or a global row.
 */
async function changeOrgPlan(page: Page, tenant: QaTenant, plan: string): Promise<void> {
  const orgId = tenant.org?.id;
  const managerId = tenant.users.manager?.id;
  expect(orgId, `${CASE} needs the seeded organization`).toBeTruthy();
  expect(managerId, `${CASE} needs the seeded manager`).toBeTruthy();

  const res = await page.request.post('/api/v1/stripe/webhook', {
    data: {
      type: 'checkout.session.completed',
      // Unique per call: `payments.session_id` is a unique key.
      session_id: randomUUID(),
      plan_id: plan,
      org_id: orgId,
      user_id: managerId,
    },
  });
  expect(res.status(), `POST stripe/webhook (${plan}) → ${await res.text()}`).toBe(200);
}

/** The sidebar header trigger: the org switcher itself. */
function orgSwitcher(page: Page) {
  return page.locator('[data-slot="sidebar-header"] button[data-sidebar="menu-button"]').first();
}

/**
 * The page body (the dashboard shell also renders a second `<main>`), so a logo
 * preview is never confused with the 32 px switcher image above it.
 */
function mainContent(page: Page) {
  return page.locator('main[data-slot="sidebar-inset"]').first();
}

test('withdraws the logo and shows the branding lock card after a plan downgrade', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const tenant = loadTenant(CASE);
  expect(tenant.org, `${CASE} needs the seeded organization`).toBeTruthy();
  // The case prerequisite is a plan that includes branding; the tenant seeder
  // applies it to this org only, so no global plan row is touched.
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');

  const orgId = tenant.org!.id;
  const orgName = tenant.org!.name;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

  // --- Precondition: Hub is live and branding is entitled -------------------
  expect(await features(page), 'the org plan unlocks branding').toContain('branding');
  expect((await organization(page, orgId)).plan, 'the tenant org starts on Hub').toBe('hub');

  // --- Prerequisite: upload a logo, so there is something to withdraw -------
  await page.goto('/manage/settings');
  await expect(page.getByRole('heading', { name: COPY.title, level: 2 })).toBeVisible();
  await expect(page.getByText(COPY.logoLabel, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.lockedTitle, { exact: true })).toHaveCount(0);

  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);
  await fileInput.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: COPY.logoUpdated }),
  ).toBeVisible({ timeout: 20_000 });

  const orgOnHub = await organization(page, orgId);
  const logoUrl = orgOnHub.logo_url;
  expect(logoUrl, 'the uploaded PNG is stored as the org logo').toBeTruthy();

  // The 48×48 settings preview and the switcher show the logo on Hub.
  const content = mainContent(page);
  const preview = content.locator(`img[src="${logoUrl}"]`);
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute('width', '48');
  await expect(preview).toHaveAttribute('height', '48');
  await expect(orgSwitcher(page).locator(`img[src="${logoUrl}"]`)).toBeVisible();

  // The stored file is publicly readable before the downgrade.
  expect((await page.request.get(logoUrl!)).ok(), 'the logo object is readable').toBe(true);

  // --- Step 1: the organization loses the plan that includes branding -------
  await changeOrgPlan(page, tenant, 'launch');
  expect((await organization(page, orgId)).plan, 'the downgrade is persisted').toBe('launch');
  expect(await features(page), 'Launch does not include branding').not.toContain('branding');

  // --- Step 2: refresh /manage — the logo is no longer displayed -----------
  await page.goto('/manage');
  await expect(orgSwitcher(page)).toBeVisible();

  const switcher = orgSwitcher(page);
  await expect(switcher.locator(`img[src="${logoUrl}"]`)).toHaveCount(0);
  // The plan-gated logo falls back to the generated org avatar.
  await expect(switcher.locator('img')).toHaveCount(1);
  await expect(switcher.locator('img')).toHaveAttribute('alt', orgName);
  await expect(switcher.locator(`img[src$="/avatar/org/${orgId}"]`)).toBeVisible();
  // Nothing else on /manage paints the old logo either.
  await expect(page.locator(`img[src="${logoUrl}"]`)).toHaveCount(0);

  // The dropdown lists the active org with the same gated avatar.
  await switcher.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator(`img[src="${logoUrl}"]`)).toHaveCount(0);
  await expect(menu.locator(`img[src$="/avatar/org/${orgId}"]`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // The file is still in the database and storage — only the display is gated.
  const orgOnLaunch = await organization(page, orgId);
  expect(orgOnLaunch.logo_url, 'the logo row is kept after the downgrade').toBe(logoUrl);
  expect(
    (await page.request.get(logoUrl!)).ok(),
    'the logo object is still stored after the downgrade',
  ).toBe(true);

  // --- Expected: /manage/settings shows the branding lock card -------------
  await page.goto('/manage/settings');
  await expect(page.getByRole('heading', { name: COPY.title, level: 2 })).toBeVisible();
  const settings = mainContent(page);

  await expect(settings.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.lockedDesc, { exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: COPY.lockedCta })).toBeVisible();

  // Upload and colour controls are withheld, and the stored logo is not painted.
  await expect(settings.locator('input[type="file"]')).toHaveCount(0);
  await expect(settings.locator('input[type="color"]')).toHaveCount(0);
  await expect(settings.getByText(COPY.uploadLogo, { exact: true })).toHaveCount(0);
  await expect(settings.getByText(COPY.brandColor, { exact: true })).toHaveCount(0);
  await expect(page.locator(`img[src="${logoUrl}"]`)).toHaveCount(0);

  // The subscription card reflects the plan the org now runs on.
  await expect(settings.getByText(COPY.launchPlan, { exact: true })).toBeVisible();

  // --- Adjacent regression: re-entitling restores the same stored logo -----
  await changeOrgPlan(page, tenant, 'hub');
  expect(await features(page), 'Hub restores branding').toContain('branding');

  await page.goto('/manage/settings');
  const contentAfterUpgrade = mainContent(page);
  await expect(contentAfterUpgrade.locator(`img[src="${logoUrl}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(contentAfterUpgrade.locator('input[type="file"]')).toHaveCount(1);
  await expect(contentAfterUpgrade.getByText(COPY.lockedTitle, { exact: true })).toHaveCount(0);
  await expect(orgSwitcher(page).locator(`img[src="${logoUrl}"]`)).toBeVisible();
  expect((await organization(page, orgId)).logo_url).toBe(logoUrl);

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
