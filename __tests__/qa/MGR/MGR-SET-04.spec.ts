import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-SET-04 — brand colour on /manage/settings: pick a colour, save it, see the
 * hex label next to the field and keep the value after a refresh (the page state
 * stays in sync with the organization row, not just with local draft state).
 *
 * Tenant (deterministic, one per independent run):
 *
 *   bun scripts/qa-tenant.ts MGR-SET-04 --fresh
 *
 * `__tests__/qa/profiles/<CASE>.json` declares `{ profile: "content", plan: "hub" }`. The
 * `content` profile supplies the org's manager, and `--plan hub` puts *this
 * tenant's own* organization on Hub through `apply_org_plan` (the same RPC the
 * billing webhook calls), which is the case's "Plan z brandingiem" prerequisite.
 * Nothing global is written — no admin setting, feature flag, plan catalogue row
 * or singleton.
 *
 * The spec clears its own org's `brand_color` first so every run starts from the
 * untouched state (the picker falls back to the product's default `#000000`),
 * and only ever reads/writes the tenant's own organization row.
 */

const CASE = 'MGR-SET-04';

/** Polish copy from `ManageSettingsPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  brandColorLabel: 'Kolor marki',
  save: 'Zapisz',
  colorUpdated: 'Kolor zaktualizowany',
  lockedTitle: 'Własny branding',
} as const;

/** The colour the case picks, then a second one for the state-sync regression. */
const PICKED_COLOR = '#1f6feb';
const SECOND_COLOR = '#c026d3';

/** Default the picker shows when the org has never saved a brand colour. */
const DEFAULT_COLOR = '#000000';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface OrganizationDetail {
  id: string;
  name: string;
  brand_color: string | null;
}

/**
 * The colour picker and the hex label the case expects "next to the field".
 * The label is the sibling `<span>{displayColor}</span>`; the save button follows
 * it inside the same row, so every locator is scoped to that row.
 */
function colorRow(page: Page) {
  return page.locator('#brand-color + span').locator('..');
}

function colorInput(page: Page) {
  return page.locator('#brand-color');
}

function colorLabel(page: Page) {
  return page.locator('#brand-color + span');
}

function saveButton(page: Page) {
  return colorRow(page).getByRole('button', { name: COPY.save, exact: true });
}

function toasts(page: Page) {
  return page.locator('[data-sonner-toast]');
}

async function getOrg(page: Page, orgId: string): Promise<OrganizationDetail> {
  const response = await page.request.get(`/api/v1/organization/${orgId}`);
  expect(response.status(), 'GET /api/v1/organization/:id').toBe(200);
  const body = (await response.json()) as ApiEnvelope<OrganizationDetail>;
  expect(body.success, 'organization response').toBe(true);
  return body.data;
}

/**
 * Start every run from the case's untouched state. Scoped to the tenant's own
 * organization id from the deterministic fixture.
 */
async function clearBrandColor(tenant: QaTenant): Promise<void> {
  const orgId = tenant.org?.id;
  if (!orgId) throw new Error(`${CASE} needs the content tenant profile (org + manager)`);
  const db = createQaSupabase();
  const { error } = await db.from('organizations').update({ brand_color: null }).eq('id', orgId);
  expect(error, 'reset the tenant brand colour').toBeNull();
}

/** Sign in as the tenant manager with this case's organization active. */
async function signInAsManager(page: Page, tenant: QaTenant): Promise<void> {
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
}

test('saves the brand colour, shows its hex and keeps it after a refresh', async ({ page }) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  expect(tenant.plan, `${CASE} needs the Hub plan (branding prerequisite)`).toBe('hub');
  const orgId = tenant.org!.id;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await clearBrandColor(tenant);
  await signInAsManager(page, tenant);

  // --- Setup: /manage/settings with branding entitled ---------------------
  await page.goto('/manage/settings');
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // Entitled org: the picker is rendered, never the locked branding card.
  await expect(page.getByText(COPY.brandColorLabel, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.lockedTitle, { exact: true })).toHaveCount(0);
  await expect(colorInput(page)).toBeVisible();
  await expect(colorInput(page)).toHaveValue(DEFAULT_COLOR);
  await expect(colorLabel(page)).toHaveText(DEFAULT_COLOR);

  const before = await getOrg(page, orgId);
  expect(before.brand_color, 'the tenant starts without a saved brand colour').toBeNull();

  // --- Step 1: pick a colour and click „Zapisz” ---------------------------
  await colorInput(page).fill(PICKED_COLOR);
  await expect(colorLabel(page), 'the hex of the picked colour shows next to the field').toHaveText(
    PICKED_COLOR,
  );

  const [update] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/api/v1/organization/${orgId}`,
    ),
    saveButton(page).click(),
  ]);
  expect(update.status(), 'PUT /api/v1/organization/:id').toBe(200);

  // Expected result: toast „Kolor zaktualizowany”.
  await expect(
    toasts(page).filter({ hasText: COPY.colorUpdated }),
    'the save shows the „Kolor zaktualizowany” toast',
  ).toBeVisible({ timeout: 10_000 });

  // Expected result: the hex stays next to the field once the draft is saved.
  await expect(colorInput(page)).toHaveValue(PICKED_COLOR);
  await expect(colorLabel(page)).toHaveText(PICKED_COLOR);

  // Expected result: state is synchronised with the organization data.
  await expect
    .poll(async () => (await getOrg(page, orgId)).brand_color, {
      message: 'the organization stores the picked brand colour',
      timeout: 15_000,
    })
    .toBe(PICKED_COLOR);

  // Let the 4 s toast expire so the next save can only show its own toast.
  await expect(toasts(page)).toHaveCount(0, { timeout: 15_000 });

  // --- Step 2: refresh keeps the colour ----------------------------------
  await page.reload();
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });
  await expect(colorInput(page)).toHaveValue(PICKED_COLOR);
  await expect(colorLabel(page)).toHaveText(PICKED_COLOR);
  await expect(page.getByText(COPY.brandColorLabel, { exact: true })).toBeVisible();
  expect(
    (await getOrg(page, orgId)).brand_color,
    'the organization row still carries the colour after the reload',
  ).toBe(PICKED_COLOR);

  // --- Adjacent regression: a second change saves and shows (issue #272) --
  // Picking a new colour must not keep showing/ submitting the previously saved
  // one, and the picker must follow the freshly saved server value.
  await colorInput(page).fill(SECOND_COLOR);
  await expect(colorLabel(page)).toHaveText(SECOND_COLOR);

  const [secondUpdate] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/api/v1/organization/${orgId}`,
    ),
    saveButton(page).click(),
  ]);
  expect(secondUpdate.status(), 'second PUT /api/v1/organization/:id').toBe(200);

  await expect(
    toasts(page).filter({ hasText: COPY.colorUpdated }),
    'the second save shows the „Kolor zaktualizowany” toast',
  ).toBeVisible({ timeout: 10_000 });
  await expect(colorInput(page)).toHaveValue(SECOND_COLOR);
  await expect(colorLabel(page)).toHaveText(SECOND_COLOR);
  await expect
    .poll(async () => (await getOrg(page, orgId)).brand_color, {
      message: 'the second save is stored on the organization',
      timeout: 15_000,
    })
    .toBe(SECOND_COLOR);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
