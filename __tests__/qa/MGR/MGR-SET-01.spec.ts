import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * MGR-SET-01 — branding is plan-gated on `/manage/settings` (Launch).
 *
 * Prerequisite (reconciled with the tenant seeder): the case's own organization
 * on the **Launch** plan — the org trigger creates every organization on
 * `launch`, so no global plan row is touched — with a manager who is its `admin`.
 * The legacy manual seed (`manager@dev.local`, password `pass`) is never used.
 *
 * Tenant (deterministic `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts MGR-SET-01 --fresh
 *
 * gives `qa-mgr-set-01-<suffix>` (`tenantKey('qa/cases/MGR-SET-01.md',
 * 'MGR-SET-01#<suffix>', 'qa-shared')` + `tenantId` for every org/user/group id)
 * with a manager as org admin. `content` is the profile default, so
 * `__tests__/qa/profiles/<CASE>.json` needs no entry. Nothing global is written (no
 * settings, flags, plans or platform rows) — the plan catalogue is only read.
 *
 * Walk observation (shared app, pl): `/manage/settings` matches the case exactly.
 * The „Logo” section renders the lock card „Własny branding — Ulepsz plan, aby
 * uzyskać dostęp do własnego brandingu” with a „Zobacz plany” button; the upload
 * control, the „Kolor marki” picker and the file input are not rendered at all.
 * „Zobacz plany” goes to the organization ladder of `/pricing`
 * (`/pricing?audience=organization`), where Hub/Campus list „Własny branding” in
 * the ladder's comparison and the current Launch row does not. The API enforces the
 * same `branding` gate: a `PUT /api/v1/organization/:id` carrying `brandColor` and
 * a logo upload both return 403 FORBIDDEN, and the org row keeps
 * `brand_color`/`logo_url` null.
 *
 * Asserted behaviour (the case's expected result):
 * - Instead of the upload control, the „Logo” section shows the branded lock
 *   card with the upgrade copy; there is no brand-colour field.
 * - „Zobacz plany” leads to the organization plans.
 * - Adjacent: the plan feature set (`branding` absent on Launch) and the API
 *   gate agree with the UI, and the upgrade catalogue actually offers branding.
 */

const CASE = 'MGR-SET-01';

const SETTINGS_PATH = '/manage/settings';
const ORG_API = (orgId: string) => `/api/v1/organization/${orgId}`;
const LOGO_API = (orgId: string) => `/api/v1/organization/${orgId}/logo`;
const PLANS_API = '/api/v1/subscription-plans?scope=organization';

const COPY = {
  pageTitle: 'Ustawienia',
  profileCard: 'Profil uczelni',
  logoLabel: 'Logo',
  lockedTitle: 'Własny branding',
  lockedDescription: 'Ulepsz plan, aby uzyskać dostęp do własnego brandingu',
  lockedCta: 'Zobacz plany',
  uploadLogo: 'Wgraj logo',
  noLogo: 'Brak logo',
  brandColorLabel: 'Kolor marki',
  currentPlan: 'Twój plan',
  pricingHeading: 'Wybierz swój plan',
  brandingFeature: 'Własny branding',
} as const;

interface EntitlementSet {
  entitlements: string[];
}

interface PlanInfo {
  key: string;
  name: string;
  features: string[];
}

interface OrganizationDetail {
  id: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url}`).toBe(200);
  const body = await json<{ success: boolean; data: T }>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** The „Profil uczelni” card, so the lock copy never matches the pricing page. */
function profileCard(page: Page) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(COPY.profileCard, { exact: true }) });
}

/** A plan row of the organization ladder, addressed by its `h3` handle. */
function planRow(page: Page, planKey: string) {
  return page.locator('#pricing-plans li').filter({ has: page.locator(`h3#${planKey}`) });
}

test.describe('@case:MGR-SET-01 @area:MGR @prio:P2 branding plan gate', () => {
  test('Launch withholds branding and „Zobacz plany” opens the plan catalogue', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const org = tenant.org;
    if (!org) {
      throw new Error(
        `MGR-SET-01 fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
      );
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: the tenant's manager, signed in, Polish UI ------------
    await loginAs(page, tenant, 'manager', { locale: 'pl' });
    await expect(page).toHaveURL(/\/manage$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // The case's section: Zarządzanie → Ustawienia.
    await page.locator('a[href="/manage/settings"]').first().click();
    await expect(page).toHaveURL(new RegExp(`${SETTINGS_PATH}$`), { timeout: 20_000 });
    await expect(
      page.getByRole('heading', { level: 2, name: COPY.pageTitle, exact: true }),
    ).toBeVisible();

    // --- Step 1: the Logo section carries the lock card ----------------------
    const profile = profileCard(page);
    await expect(profile).toHaveCount(1);
    // The card is still the real organization profile, not a blank locked page.
    await expect(profile.getByText(org.name, { exact: true })).toBeVisible();
    await expect(profile.getByText(COPY.logoLabel, { exact: true })).toBeVisible();

    // Expected result: „Własny branding — Ulepsz plan, aby uzyskać dostęp do
    // własnego brandingu” in place of the upload control, with the lock icon.
    await expect(profile.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
    await expect(profile.getByText(COPY.lockedDescription, { exact: true })).toBeVisible();
    await expect(profile.locator('svg.lucide-lock')).toHaveCount(1);

    // Expected result: no brand-colour field, and no upload affordance either.
    await expect(
      profile.getByRole('button', { name: COPY.uploadLogo, exact: true }),
      '„Wgraj logo” must not be rendered on Launch',
    ).toHaveCount(0);
    await expect(profile.getByText(COPY.noLogo, { exact: true })).toHaveCount(0);
    await expect(
      profile.getByText(COPY.brandColorLabel, { exact: true }),
      'the brand-colour field must not be rendered on Launch',
    ).toHaveCount(0);
    await expect(profile.locator('input[type="file"]')).toHaveCount(0);
    await expect(profile.locator('input[type="color"]')).toHaveCount(0);
    await expect(profile.getByRole('button', { name: 'Zapisz', exact: true })).toHaveCount(0);

    // The subscription card still shows the org's current plan.
    const plans = await getData<PlanInfo[]>(page, PLANS_API);
    const launchPlan = plans.find((candidate) => candidate.key === 'launch');
    if (!launchPlan) throw new Error('plan catalogue has no launch plan');
    // The badge names every layer of the union; this manager's personal `base`
    // layer follows the org plan, so the org layer is asserted as a substring.
    await expect(
      page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByText('Subskrypcja', { exact: true }) })
        .locator('[data-plan-union]'),
    ).toContainText(launchPlan.name);

    // The UI state comes from the same session's entitlement data, not a pin.
    const entitlements = await getData<EntitlementSet>(page, '/api/v1/me/entitlements');
    expect(entitlements.entitlements, 'branding must be absent on Launch').not.toContain(
      'branding',
    );
    const plan = await getData<PlanInfo>(page, '/api/v1/me/plan');
    expect(plan.key, 'the seeded organization plan').toBe('launch');
    expect(plan.features, 'Launch does not include branding').not.toContain('branding');

    // --- Adjacent: the API enforces the same gate ---------------------------
    const colorUpdate = await page.request.put(ORG_API(org.id), {
      data: { brandColor: '#123456' },
    });
    expect(colorUpdate.status(), `PUT ${ORG_API(org.id)} with brandColor`).toBe(403);
    expect(await colorUpdate.json()).toEqual({ success: false, error: 'FORBIDDEN' });

    const logoUpload = await page.request.post(LOGO_API(org.id), {
      multipart: {
        file: { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('png') },
      },
    });
    expect(logoUpload.status(), `POST ${LOGO_API(org.id)}`).toBe(403);
    expect(await logoUpload.json()).toEqual({ success: false, error: 'FORBIDDEN' });

    // Nothing was written: the org row is still unbranded.
    const afterWrites = await getData<OrganizationDetail>(page, ORG_API(org.id));
    expect(afterWrites.brand_color, 'the rejected colour must not be stored').toBeNull();
    expect(afterWrites.logo_url, 'the rejected logo must not be stored').toBeNull();

    // --- Step 2: „Zobacz plany” leads to the organization ladder -----------
    await profile.getByRole('button', { name: COPY.lockedCta, exact: true }).click();
    await expect(page).toHaveURL(/\/pricing\?audience=organization$/, { timeout: 20_000 });
    await expect(
      page.getByRole('heading', { level: 1, name: COPY.pricingHeading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Dla organizacji', exact: true }),
    ).toBeVisible();

    // The catalogue is the upgrade path the lock promises: the ladder lists the
    // plans and marks this org's current plan.
    const currentPlanRow = planRow(page, launchPlan.key);
    await expect(currentPlanRow).toHaveCount(1);
    await expect(currentPlanRow.getByText(COPY.currentPlan, { exact: true })).toBeVisible();

    // Its comparison table carries the feature the lock withholds, and it is a row
    // precisely because the plans differ on it.
    const brandingHeader = page.getByRole('rowheader', { name: COPY.brandingFeature, exact: true });
    await expect(brandingHeader, 'branding is a comparison row').toHaveCount(1);
    const brandingRow = brandingHeader.locator('xpath=..');

    const entitled = plans.filter((candidate) => candidate.features.includes('branding'));
    expect(entitled.length, 'the catalogue offers at least one plan with branding').toBeGreaterThan(
      0,
    );
    for (const candidate of entitled) {
      // Columns follow the ladder's catalogue order, so the index is the column.
      const column = plans.findIndex((cataloguePlan) => cataloguePlan.key === candidate.key);
      await expect(
        brandingRow.locator('td').nth(column).locator('svg.lucide-check'),
        `${candidate.name} lists branding`,
      ).toHaveCount(1);
    }
    // Launch really lacks the entitlement — the lock is not a UI-only label.
    const launchColumn = plans.findIndex((cataloguePlan) => cataloguePlan.key === launchPlan.key);
    await expect(
      brandingRow.locator('td').nth(launchColumn).locator('svg.lucide-check'),
      `${launchPlan.name} does not list branding`,
    ).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
