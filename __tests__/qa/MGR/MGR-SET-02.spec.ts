import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * MGR-SET-02 — uploading a logo requires the `branding` feature.
 *
 * The case's prerequisite was „Organizacja na planie Hub/Campus”. Since #1493 no
 * organization plan carries `branding`: the ladder is capacity only and the
 * feature has no plan path left. The case therefore checks the disabled state
 * the product ships: `/manage/settings` shows the lock card in place of the
 * uploader, and the logo route refuses a valid PNG with 403, so no file reaches
 * validation or storage.
 *
 *   bun scripts/qa-tenant.ts MGR-SET-02 --fresh
 *
 * `__tests__/qa/profiles/MGR-SET-02.json` is absent, so the default `content`
 * profile seeds the org on the trigger's `launch` plan. Nothing global is
 * written; the catalogue is only read.
 */

const CASE = 'MGR-SET-02';
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
} as const;

const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface OrganizationDetail {
  id: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = await json<{ success: boolean; data: T }>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

function mainContent(page: Page) {
  return page.locator('main[data-slot="sidebar-inset"]').first();
}

test('offers no logo upload without the branding feature and refuses the file', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  const org = tenant.org;
  if (!org) throw new Error(`${CASE} needs the seeded organization`);
  const orgId = org.id;
  const orgName = org.name;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

  // --- Prerequisite: the organization's plan carries no branding -----------
  const entitlements = await getData<{ entitlements: string[] }>(page, '/api/v1/me/entitlements');
  expect(entitlements.entitlements, 'launch grants no branding').not.toContain('branding');

  // --- Expected: the settings page shows the lock card, not the uploader ----
  await page.goto(SETTINGS_PATH);
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();

  const settings = mainContent(page);
  await expect(settings.getByText(COPY.profileCard, { exact: true })).toBeVisible();
  await expect(settings.getByText(orgName, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.logoLabel, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.lockedDescription, { exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: COPY.lockedCta, exact: true })).toBeVisible();
  await expect(settings.locator('svg.lucide-lock')).toHaveCount(1);

  // No uploader and no colour field: the feature is not there to configure.
  await expect(settings.locator('input[type="file"]')).toHaveCount(0);
  await expect(settings.locator('input[type="color"]')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: COPY.uploadLogo, exact: true })).toHaveCount(0);
  await expect(settings.getByText(COPY.brandColorLabel, { exact: true })).toHaveCount(0);

  // --- The API refuses a valid PNG before it can reach the bucket -----------
  const upload = await page.request.post(LOGO_API(orgId), {
    multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: LOGO_PNG } },
  });
  expect(upload.status(), `POST ${LOGO_API(orgId)} with a valid PNG`).toBe(403);
  expect(await upload.json()).toEqual({ success: false, error: 'FORBIDDEN' });

  const after = await getData<OrganizationDetail>(page, ORG_API(orgId));
  expect(after.logo_url, 'the refused upload stores nothing').toBeNull();
  expect(after.brand_color, 'no colour is stored either').toBeNull();

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
