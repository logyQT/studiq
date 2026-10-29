import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * LIM-05 — branding requires the `branding` feature (UI gate + API 403).
 *
 * Prerequisite (reconciled with the tenant seeder): a manager whose own
 * organization starts on a plan that includes branding. The legacy manual seed
 * (`manager@dev.local`, password `pass`) is never used.
 *
 *   bun scripts/qa-tenant.ts LIM-05 --fresh
 *
 * `qa/tests/profiles/LIM-05.json` declares `{ profile: "content", plan: "hub" }`,
 * so the fresh tenant's organization starts on Hub (`apply_org_plan` in the
 * seeder) and its `admin` role has `branding`. Nothing global is written: no
 * feature flag, plan catalogue row, admin setting or singleton.
 *
 * Step 1 of the case is the MGR-SET-01 → MGR-SET-02 → MGR-SET-05 chain, replayed
 * inside this one tenant: use branding on Hub (upload a logo, set the brand
 * colour), then drop the plan to `launch` through the app's mock checkout webhook
 * (`POST /api/v1/stripe/webhook` → `MockStripeService.handleWebhook` →
 * `apply_org_plan`) — the entitlement path a real plan change takes, and the
 * equivalent of MGR-SET-05's admin-panel downgrade (this build's admin panel has
 * no per-org plan editor, and the ADM-OVR / ADM-PLN switches are shared rows a
 * suite test must not mutate).
 *
 * Step 2 is the case's own check: as that now-featureless manager, `PUT
 * /api/v1/organization/:id` with `brandColor` and `POST /api/v1/organization/:id/logo`
 * must both be rejected with 403 and change nothing.
 *
 * Asserted behaviour (the case's expected result):
 * - without the feature the settings page shows the branding lock card and no
 *   upload / brand-colour control, and the stored logo is not painted;
 * - the API refuses both branding writes with 403 FORBIDDEN, while the values
 *   stored while branding was entitled (`brand_color`, `logo_url`, the storage
 *   object) stay exactly as they were;
 * - adjacent: the gate is branding-specific — a plain organization rename still
 *   succeeds without the feature.
 *
 * The spec restores Hub at the end, so a retry against the same tenant (CI seeds
 * once and retries) starts from the case's prerequisite again. The logo and the
 * colour are re-derived on every run (the logo path is unique per upload, the
 * colour is chosen to differ from the stored one), so repeated runs against one
 * tenant stay green without a reseed.
 */

const CASE = 'LIM-05';
const SETTINGS_PATH = '/manage/settings';
const ORG_API = (orgId: string) => `/api/v1/organization/${orgId}`;
const LOGO_API = (orgId: string) => `/api/v1/organization/${orgId}/logo`;

/** Polish copy from `ManageSettingsPage` and the plan catalogue. */
const COPY = {
  pageTitle: 'Ustawienia',
  profileCard: 'Profil uczelni',
  logoLabel: 'Logo',
  uploadLogo: 'Wgraj logo',
  logoUpdated: 'Logo zaktualizowane',
  brandColorLabel: 'Kolor marki',
  lockedTitle: 'Własny branding',
  lockedDescription: 'Ulepsz plan, aby uzyskać dostęp do własnego brandingu',
  lockedCta: 'Zobacz plany',
  hubPlan: 'StudiQ Hub',
  launchPlan: 'StudiQ Launch',
} as const;

/** A real 1×1 PNG — the upload route sniffs the bytes, not the file name. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The colour a rejected write tries to force; it must never be the stored one. */
const REJECTED_COLOR = '#ff0000';

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

interface FeatureSet {
  features: string[];
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

async function features(page: Page): Promise<string[]> {
  return (await getData<FeatureSet>(page, '/api/v1/features/me')).features;
}

async function organization(page: Page, orgId: string): Promise<OrganizationDetail> {
  return getData<OrganizationDetail>(page, ORG_API(orgId));
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

  const response = await page.request.post('/api/v1/stripe/webhook', {
    data: {
      type: 'checkout.session.completed',
      // Unique per call: `payments.session_id` is a unique key.
      session_id: randomUUID(),
      plan_id: plan,
      org_id: orgId,
      user_id: managerId,
    },
  });
  expect(response.status(), `POST stripe/webhook (${plan}) → ${await response.text()}`).toBe(200);
}

/** The page body (the dashboard shell also renders a second `<main>`). */
function mainContent(page: Page) {
  return page.locator('main[data-slot="sidebar-inset"]').first();
}

/** The sidebar header trigger: the org switcher itself. */
function orgSwitcher(page: Page) {
  return page.locator('[data-slot="sidebar-header"] button[data-sidebar="menu-button"]').first();
}

test('rejects branding writes and keeps the stored values once the feature is gone', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  // The case prerequisite is a plan that includes branding; the seeder applies it
  // to this tenant's own org only, so no global plan row is touched.
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');

  const org = tenant.org;
  expect(org, `${CASE} needs the seeded organization`).toBeTruthy();
  const orgId = org!.id;
  const orgName = org!.name;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // --- Prerequisite: the tenant's manager, signed in, Polish UI -------------
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  expect(await features(page), 'Hub entitles the org admin to branding').toContain('branding');
  expect((await organization(page, orgId)).plan, 'the tenant org starts on Hub').toBe('hub');

  // --- Step 1 / MGR-SET-02: branding works while it is entitled -------------
  await page.goto(SETTINGS_PATH);
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.uploadLogo, exact: true })).toBeVisible();
  await expect(page.getByText(COPY.brandColorLabel, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.lockedTitle, { exact: true })).toHaveCount(0);

  const before = await organization(page, orgId);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: COPY.uploadLogo, exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: LOGO_PNG });
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: COPY.logoUpdated }),
  ).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(async () => (await organization(page, orgId)).logo_url, {
      message: 'the organization stores the uploaded logo',
      timeout: 15_000,
    })
    .not.toBeNull();
  const logoUrl = (await organization(page, orgId)).logo_url!;
  expect(logoUrl, 'every run uploads its own logo object').not.toBe(before.logo_url);

  const settingsOnHub = mainContent(page);
  const preview = settingsOnHub.locator(`img[src="${logoUrl}"]`);
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute('width', '48');
  await expect(preview).toHaveAttribute('height', '48');
  expect((await page.request.get(logoUrl)).ok(), 'the uploaded logo is readable').toBe(true);

  // The brand colour is the same `PUT` the settings page sends; pick a value
  // that differs from whatever an earlier run of this tenant left behind.
  const brandColor = before.brand_color?.toLowerCase() === '#00aa00' ? '#00bb00' : '#00aa00';
  expect(brandColor.toLowerCase()).not.toBe(REJECTED_COLOR);
  const colorUpdate = await page.request.put(ORG_API(orgId), { data: { brandColor } });
  expect(colorUpdate.status(), `PUT ${ORG_API(orgId)} on Hub`).toBe(200);
  await page.reload();
  await expect(mainContent(page).locator('input[type="color"]')).toHaveValue(brandColor);
  await expect(mainContent(page).getByText(brandColor, { exact: true })).toBeVisible();

  // --- Step 1 / MGR-SET-05: the org loses the plan that includes branding ----
  await changeOrgPlan(page, tenant, 'launch');
  expect((await organization(page, orgId)).plan, 'the downgrade is persisted').toBe('launch');
  expect(await features(page), 'Launch does not include branding').not.toContain('branding');

  // --- Expected: the UI blocks branding on the refreshed settings page ------
  await page.goto(SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();

  const settings = mainContent(page);
  await expect(settings.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.lockedDescription, { exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: COPY.lockedCta, exact: true })).toBeVisible();
  await expect(settings.locator('svg.lucide-lock')).toHaveCount(1);

  // No upload and no colour control, and the stored logo is not painted.
  await expect(settings.locator('input[type="file"]')).toHaveCount(0);
  await expect(settings.locator('input[type="color"]')).toHaveCount(0);
  await expect(settings.getByText(COPY.uploadLogo, { exact: true })).toHaveCount(0);
  await expect(settings.getByText(COPY.brandColorLabel, { exact: true })).toHaveCount(0);
  await expect(page.locator(`img[src="${logoUrl}"]`)).toHaveCount(0);
  await expect(orgSwitcher(page).locator(`img[src="${logoUrl}"]`)).toHaveCount(0);

  // The rest of the page is not blanked: the profile and the current plan show.
  await expect(settings.getByText(orgName, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.launchPlan, { exact: true })).toBeVisible();

  // --- Step 2: the API rejects both branding writes with 403 -----------------
  const colorAttempt = await page.request.put(ORG_API(orgId), {
    data: { brandColor: REJECTED_COLOR },
  });
  expect(colorAttempt.status(), `PUT ${ORG_API(orgId)} with brandColor`).toBe(403);
  expect(await colorAttempt.json()).toEqual({ success: false, error: 'FORBIDDEN' });

  const logoAttempt = await page.request.post(LOGO_API(orgId), {
    multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: LOGO_PNG } },
  });
  expect(logoAttempt.status(), `POST ${LOGO_API(orgId)}`).toBe(403);
  expect(await logoAttempt.json()).toEqual({ success: false, error: 'FORBIDDEN' });

  // Expected result: neither the colour nor the logo changed.
  const afterRejections = await organization(page, orgId);
  expect(afterRejections.brand_color, 'the rejected colour must not be stored').toBe(brandColor);
  expect(afterRejections.logo_url, 'the rejected logo must not replace the stored one').toBe(
    logoUrl,
  );
  expect(
    (await page.request.get(logoUrl)).ok(),
    'the stored logo object is untouched by the rejected upload',
  ).toBe(true);

  // Adjacent: the gate is branding-specific — the same manager can still edit
  // the organization, so the 403s above are not a blanket denial of the route.
  const rename = await page.request.put(ORG_API(orgId), { data: { name: orgName } });
  expect(rename.status(), `PUT ${ORG_API(orgId)} with name only`).toBe(200);
  expect((await organization(page, orgId)).name).toBe(orgName);

  // The rejected writes left the gated page exactly as locked as before.
  await page.reload();
  await expect(mainContent(page).getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
  await expect(page.locator(`img[src="${logoUrl}"]`)).toHaveCount(0);

  // --- Cleanup: restore Hub so a retry on this tenant starts entitled --------
  await changeOrgPlan(page, tenant, 'hub');
  expect(await features(page), 'Hub restores branding').toContain('branding');

  const restored = await organization(page, orgId);
  expect(restored.brand_color, 'branding survived the gated round trip').toBe(brandColor);
  expect(restored.logo_url, 'the logo survived the gated round trip').toBe(logoUrl);

  await page.goto(SETTINGS_PATH);
  const entitledAgain = mainContent(page);
  await expect(entitledAgain.locator(`img[src="${logoUrl}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(entitledAgain.locator('input[type="color"]')).toHaveValue(brandColor);
  await expect(entitledAgain.getByText(COPY.hubPlan, { exact: true })).toBeVisible();
  await expect(entitledAgain.getByText(COPY.lockedTitle, { exact: true })).toHaveCount(0);
  await expect(entitledAgain.getByText(COPY.logoLabel, { exact: true })).toBeVisible();
  await expect(entitledAgain.getByText(COPY.profileCard, { exact: true })).toBeVisible();

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
