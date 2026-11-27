import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '#test/helpers/db-admin';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * MGR-SET-04 — the brand colour requires the `branding` feature.
 *
 * The case set a colour in „Kolor marki” and checked it survived a refresh.
 * `branding` is the Campus tier, and this tenant's org sits on Hub without it,
 * so the field is not rendered and the API refuses the write. The case moves to
 * the locked state: a colour stored on the row (the state a Campus org would
 * have left) is not painted, and the write is 403.
 *
 *   bun scripts/qa-tenant.ts MGR-SET-04 --fresh
 *
 * `__tests__/qa/profiles/MGR-SET-04.json` declares `{ profile: "content", plan:
 * "hub" }`.
 */

const CASE = 'MGR-SET-04';
const SETTINGS_PATH = '/manage/settings';
const ORG_API = (orgId: string) => `/api/v1/organization/${orgId}`;

const COPY = {
  pageTitle: 'Ustawienia',
  brandColorLabel: 'Kolor marki',
  lockedTitle: 'Własny branding',
  lockedDescription: 'Własny branding jest dostępny w planie Campus.',
} as const;

/** The stored colour the gate must not paint; distinct from any UI default. */
const STORED_COLOR = '#123456';
/** The colour the case tries to save; it must never reach the row. */
const REJECTED_COLOR = '#00aa00';

interface OrganizationDetail {
  id: string;
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

test('hides the colour field and refuses a write when the plan does not grant branding', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');
  const org = tenant.org;
  if (!org) throw new Error(`${CASE} needs the seeded organization`);
  const orgId = org.id;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // A stored colour, as a Campus org would have left it.
  const db = createQaSupabase();
  const seeded = await db
    .from('organizations')
    .update({ brand_color: STORED_COLOR })
    .eq('id', orgId);
  expect(seeded.error, 'seed the stored brand colour').toBeNull();

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  await page.goto(SETTINGS_PATH);
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();

  // --- Expected: the lock card, no colour control, no stored colour --------
  const settings = mainContent(page);
  await expect(settings.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.lockedDescription, { exact: true })).toBeVisible();
  await expect(settings.getByText(COPY.brandColorLabel, { exact: true })).toHaveCount(0);
  await expect(settings.locator('input[type="color"]')).toHaveCount(0);
  await expect(settings.getByText(STORED_COLOR, { exact: true })).toHaveCount(0);

  // The accent is only injected when the entitlement is on, so the stored
  // colour must not reach the document's custom property.
  const accent = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--brand-accent').trim(),
  );
  expect(accent, 'the stored brand colour is not painted').toBe('');

  // --- The API refuses the write -------------------------------------------
  const attempt = await page.request.put(ORG_API(orgId), { data: { brandColor: REJECTED_COLOR } });
  expect(attempt.status(), `PUT ${ORG_API(orgId)} with brandColor`).toBe(403);
  expect(await attempt.json()).toEqual({ success: false, error: 'FORBIDDEN' });

  const after = await getData<OrganizationDetail>(page, ORG_API(orgId));
  expect(after.brand_color, 'the refused write changed nothing').toBe(STORED_COLOR);

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
