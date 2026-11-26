import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '#test/helpers/db-admin';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * MGR-SET-05 — a plan change cannot withdraw branding no plan grants.
 *
 * The case lowered an organization from Hub to Launch and expected the branding
 * controls to disappear. Since #1493 no organization plan carries `branding`, so
 * the lock is present before and after every move; what survives is the stored
 * logo and colour (untouched in the row) and what does not is their display.
 * The plan change still runs through the mock checkout webhook, the real
 * `change_org_plan` path, to prove the tier move itself is healthy.
 *
 *   bun scripts/qa-tenant.ts MGR-SET-05 --fresh
 *
 * `__tests__/qa/profiles/MGR-SET-05.json` declares `{ profile: "content", plan:
 * "hub" }`.
 */

const CASE = 'MGR-SET-05';
const SETTINGS_PATH = '/manage/settings';
const ORG_API = (orgId: string) => `/api/v1/organization/${orgId}`;

const COPY = {
  pageTitle: 'Ustawienia',
  logoLabel: 'Logo',
  uploadLogo: 'Wgraj logo',
  brandColor: 'Kolor marki',
  lockedTitle: 'Własny branding',
  lockedDesc: 'Własny branding nie jest częścią obecnych planów.',
  lockedCta: 'Zobacz plany',
  hubPlan: 'StudiQ Hub',
  launchPlan: 'StudiQ Launch',
} as const;

const STORED_COLOR = '#123456';
const STORED_LOGO = (orgId: string) => `https://example.test/org-logos/${orgId}/seeded-logo.png`;

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

/** Move this tenant's organization through the mock checkout webhook. */
async function changeOrgPlan(page: Page, tenant: QaTenant, plan: string): Promise<void> {
  const orgId = tenant.org?.id;
  const managerId = tenant.users.manager?.id;
  if (!orgId || !managerId) throw new Error(`${CASE} needs the seeded org and manager`);

  const response = await page.request.post('/api/v1/stripe/webhook', {
    data: {
      type: 'checkout.session.completed',
      session_id: randomUUID(),
      plan_id: plan,
      org_id: orgId,
      user_id: managerId,
    },
  });
  expect(response.status(), `POST stripe/webhook (${plan}) → ${await response.text()}`).toBe(200);
}

test('keeps branding locked across Hub → Launch → Hub because no plan grants it', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');
  const org = tenant.org;
  if (!org) throw new Error(`${CASE} needs the seeded organization`);
  const orgId = org.id;
  const storedLogo = STORED_LOGO(orgId);

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // The stored values a branding plan would have left. This one row is the
  // spec's lone write; provenance and catalogue are untouched.
  const db = createQaSupabase();
  const seeded = await db
    .from('organizations')
    .update({ logo_url: storedLogo, brand_color: STORED_COLOR })
    .eq('id', orgId);
  expect(seeded.error, 'seed the stored branding values').toBeNull();

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

  // --- Before: Hub, and still locked ---------------------------------------
  expect((await getData<OrganizationDetail>(page, ORG_API(orgId))).plan).toBe('hub');
  await page.goto(SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();

  async function expectLocked(label: string): Promise<void> {
    const settings = mainContent(page);
    await expect(settings.getByText(COPY.lockedTitle, { exact: true }), label).toBeVisible();
    await expect(settings.getByText(COPY.lockedDesc, { exact: true }), label).toBeVisible();
    await expect(
      settings.getByRole('button', { name: COPY.lockedCta, exact: true }),
      label,
    ).toBeVisible();
    await expect(settings.locator('input[type="file"]'), label).toHaveCount(0);
    await expect(settings.locator('input[type="color"]'), label).toHaveCount(0);
    await expect(settings.getByText(COPY.uploadLogo, { exact: true }), label).toHaveCount(0);
    await expect(settings.getByText(COPY.brandColor, { exact: true }), label).toHaveCount(0);
    await expect(page.locator(`img[src="${storedLogo}"]`), label).toHaveCount(0);
    await expect(orgSwitcher(page).locator(`img[src="${storedLogo}"]`), label).toHaveCount(0);
  }

  await expectLocked('Hub leaves branding locked');
  await expect(mainContent(page).locator('[data-plan-union]')).toContainText(COPY.hubPlan);

  // --- Step 1: lower the plan through the real webhook path ----------------
  await changeOrgPlan(page, tenant, 'launch');
  const afterDowngrade = await getData<OrganizationDetail>(page, ORG_API(orgId));
  expect(afterDowngrade.plan, 'the downgrade is persisted').toBe('launch');
  expect(afterDowngrade.logo_url, 'the stored logo is untouched').toBe(storedLogo);
  expect(afterDowngrade.brand_color, 'the stored colour is untouched').toBe(STORED_COLOR);

  await page.goto(SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();
  await expectLocked('Launch leaves branding locked');
  await expect(mainContent(page).locator('[data-plan-union]')).toContainText(COPY.launchPlan);

  // --- Step 2: re-buy Hub; the lock is the contract, not data loss ---------
  await changeOrgPlan(page, tenant, 'hub');
  await page.goto(SETTINGS_PATH);
  await expect(
    page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
  ).toBeVisible();
  await expectLocked('Hub does not restore branding');
  await expect(mainContent(page).locator('[data-plan-union]')).toContainText(COPY.hubPlan);

  expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
