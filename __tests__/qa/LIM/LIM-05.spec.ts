import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '#test/helpers/db-admin';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * LIM-05 — branding requires the `branding` feature (UI gate + API 403).
 *
 * Since #1493 no organization plan carries `branding` (the ladder is capacity
 * only), so the gate has no positive plan path left. The case keeps its subject:
 * without the entitlement the settings page is locked and both branding writes
 * are refused. The stored values are seeded directly on this tenant's row — the
 * state a plan that once carried branding would have left — to prove the gate,
 * not a missing value, is what hides them.
 *
 *   bun scripts/qa-tenant.ts LIM-05 --fresh
 *
 * `__tests__/qa/profiles/LIM-05.json` declares `{ profile: "content", plan: "hub" }`:
 * the tenant org sits on the top self-serve tier, so the lock is not a free-tier
 * artefact. Nothing global is written; no plan catalogue row or flag is changed.
 */

const CASE = 'LIM-05';
const SETTINGS_PATH = '/manage/settings';
const ORG_API = (orgId: string) => `/api/v1/organization/${orgId}`;
const LOGO_API = (orgId: string) => `/api/v1/organization/${orgId}/logo`;

const COPY = {
  pageTitle: 'Ustawienia',
  profileCard: 'Profil uczelni',
  logoLabel: 'Logo',
  uploadLogo: 'Wgraj logo',
  brandColorLabel: 'Kolor marki',
  lockedTitle: 'Własny branding',
  lockedDescription: 'Własny branding nie jest częścią obecnych planów.',
  lockedCta: 'Zobacz plany',
  hubPlan: 'StudiQ Hub',
} as const;

/** The stored values the gate must hide; a colour differs from any UI default. */
const STORED_COLOR = '#123456';
const STORED_LOGO = (orgId: string) => `https://example.test/org-logos/${orgId}/seeded-logo.png`;
const REJECTED_COLOR = '#ff0000';

const LOGO_PNG = Buffer.from(
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

interface PlanInfo {
  key: string;
  features: string[];
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = await json<ApiEnvelope<T>>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

function mainContent(page: Page) {
  return page.locator('main[data-slot="sidebar-inset"]').first();
}

function orgSwitcher(page: Page) {
  return page.locator('[data-slot="sidebar-header"] button[data-sidebar="menu-button"]').first();
}

test('holds the branding gate without a plan that grants it, and keeps stored values hidden', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const tenant: QaTenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');
  const org = tenant.org;
  if (!org) throw new Error(`${CASE} needs the seeded organization`);
  const orgId = org.id;
  const orgName = org.name;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

  // --- Prerequisite: no org plan sells branding, and the row has values ----
  const catalogue = await getData<PlanInfo[]>(
    page,
    '/api/v1/subscription-plans?scope=organization',
  );
  expect(
    catalogue.filter((plan) => plan.features.includes('branding')),
    'no organization plan carries branding since #1493',
  ).toEqual([]);

  const entitlements = await getData<{ entitlements: string[] }>(page, '/api/v1/me/entitlements');
  expect(entitlements.entitlements, 'Hub does not grant branding').not.toContain('branding');

  // The stored values a branding plan would have left behind. The spec writes
  // this tenant's row only (a fixture, not a product path).
  const db = createQaSupabase();
  const storedLogo = STORED_LOGO(orgId);
  const seeded = await db
    .from('organizations')
    .update({ logo_url: storedLogo, brand_color: STORED_COLOR })
    .eq('id', orgId);
  expect(seeded.error, 'seed the stored branding values').toBeNull();

  // --- Expected: the settings page is locked and the values are not painted -
  await page.goto(SETTINGS_PATH);
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();

  const settings = mainContent(page);
  await expect(settings.getByText(COPY.profileCard, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.lockedDescription, { exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: COPY.lockedCta, exact: true })).toBeVisible();
  await expect(settings.locator('svg.lucide-lock')).toHaveCount(1);
  await expect(settings.locator('input[type="file"]')).toHaveCount(0);
  await expect(settings.locator('input[type="color"]')).toHaveCount(0);
  await expect(settings.getByText(COPY.uploadLogo, { exact: true })).toHaveCount(0);
  await expect(settings.getByText(COPY.brandColorLabel, { exact: true })).toHaveCount(0);
  await expect(settings.getByText(STORED_COLOR, { exact: true })).toHaveCount(0);
  await expect(page.locator(`img[src="${storedLogo}"]`)).toHaveCount(0);
  await expect(orgSwitcher(page).locator(`img[src="${storedLogo}"]`)).toHaveCount(0);

  // The rest of the page is not blanked: the profile and the current plan show.
  await expect(settings.getByText(orgName, { exact: true })).toBeVisible();
  await expect(settings.locator('[data-plan-union]')).toContainText(COPY.hubPlan);

  // --- Step 2: the API rejects both branding writes with 403 ----------------
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

  const afterRejections = await getData<OrganizationDetail>(page, ORG_API(orgId));
  expect(afterRejections.brand_color, 'the rejected colour changed nothing').toBe(STORED_COLOR);
  expect(afterRejections.logo_url, 'the rejected logo changed nothing').toBe(storedLogo);

  // Adjacent: the gate is branding-specific — the same manager can still write
  // the organization itself, so the 403s are not a blanket denial of the route.
  const rename = await page.request.put(ORG_API(orgId), { data: { name: orgName } });
  expect(rename.status(), `PUT ${ORG_API(orgId)} with name only`).toBe(200);
  expect((await getData<OrganizationDetail>(page, ORG_API(orgId))).name).toBe(orgName);

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
