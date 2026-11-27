import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * MGR-SET-03 — logo file validation is unreachable without the branding feature.
 *
 * The case used to try a `.txt`, an `.svg` and an oversized image through the
 * settings uploader. Since #1493 no organization plan carries `branding`, so the
 * uploader is not rendered and the API's entitlement gate answers **before** the
 * type/size validation: every file, valid or not, is 403 and nothing is stored.
 * The case keeps its subject — an invalid logo file cannot enter the
 * organization — and moves it to the shipped disabled state.
 *
 *   bun scripts/qa-tenant.ts MGR-SET-03 --fresh
 *
 * `__tests__/qa/profiles/MGR-SET-03.json` declares `{ profile: "content", plan:
 * "hub" }`, so the lock is not a free-tier artefact.
 */

const CASE = 'MGR-SET-03';
const SETTINGS_PATH = '/manage/settings';
const ORG_API = (orgId: string) => `/api/v1/organization/${orgId}`;
const LOGO_API = (orgId: string) => `/api/v1/organization/${orgId}/logo`;

const COPY = {
  pageTitle: 'Ustawienia',
  uploadLogo: 'Wgraj logo',
  lockedTitle: 'Własny branding',
  lockedDescription: 'Własny branding jest dostępny w planie Campus.',
} as const;

const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The files the case rejected, plus one valid PNG as the control. */
const FILES = [
  { label: '.txt', name: 'logo.txt', mimeType: 'text/plain', buffer: Buffer.from('not a logo') },
  {
    label: '.svg',
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  },
  {
    label: 'oversized PNG',
    name: 'huge.png',
    mimeType: 'image/png',
    // Over the org-logos bucket's 5 MB cap; the entitlement must reject first.
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0),
  },
  { label: 'valid PNG', name: 'logo.png', mimeType: 'image/png', buffer: LOGO_PNG },
] as const;

interface OrganizationDetail {
  id: string;
  logo_url: string | null;
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

test('rejects every logo file at the entitlement gate before type or size validation', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');
  const org = tenant.org;
  if (!org) throw new Error(`${CASE} needs the seeded organization`);
  const orgId = org.id;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  await page.goto(SETTINGS_PATH);
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();

  // --- Expected: no uploader, so no file-type selector to try --------------
  const settings = mainContent(page);
  await expect(settings.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.lockedDescription, { exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: COPY.uploadLogo, exact: true })).toHaveCount(0);
  await expect(settings.locator('input[type="file"]')).toHaveCount(0);
  await expect(settings.locator('input[accept]')).toHaveCount(0);

  // --- Step 1: every file is refused before validation ---------------------
  for (const file of FILES) {
    const response = await page.request.post(LOGO_API(orgId), {
      multipart: { file: { name: file.name, mimeType: file.mimeType, buffer: file.buffer } },
    });
    // 403, never 413/422: the entitlement gate is the first statement, so a
    // well-formed or malformed file both stop there.
    expect(response.status(), `POST logo with ${file.label}`).toBe(403);
    expect(await response.json(), `POST logo with ${file.label}`).toEqual({
      success: false,
      error: 'FORBIDDEN',
    });
  }

  const after = await getData<OrganizationDetail>(page, ORG_API(orgId));
  expect(after.logo_url, 'no rejected or valid file was stored').toBeNull();

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
