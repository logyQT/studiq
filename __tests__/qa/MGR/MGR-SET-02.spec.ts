import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-SET-02 — uploading an organization logo on /manage/settings: toast,
 * 48×48 preview, immediate logo in the org switcher (replacing the generated
 * avatar, no reload) and persistence after a refresh.
 *
 * Tenant (deterministic `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts MGR-SET-02 --fresh
 *
 * gives the organization `qa-mgr-set-02-<suffix>` with a manager, an educator and
 * a student (`tenantKey('qa/cases/MGR-SET-02.md', 'MGR-SET-02#<suffix>',
 * 'qa-shared')`).
 *
 * Branding precondition. The case asks for "an org on Hub/Campus **or with a
 * branding override**". The plan catalog and `feature_flags` are shared, mutable
 * rows, so this spec never reads or writes them. Instead it seeds the tenant's own
 * `org_role_features` rows — the per-org entitlement copy `handle_new_organization`
 * populates from the plan and FeatureResolver treats as authoritative — exactly
 * the "branding override" the case allows. Those rows belong to this tenant's
 * three org roles, so no other worker's org is touched and no global state is
 * mutated. The spec also clears the org's `logo_url` (and its own storage object)
 * so the run always starts from the case's "no logo → avatar" state, making the
 * spec repeatable without a reseed.
 *
 * Nothing global is assumed beyond the migration-seeded `branding` kill switch
 * being on, which is the product's default for this surface.
 */

const CASE = 'MGR-SET-02';
const STORAGE_PUBLIC_PATH = '/storage/v1/object/public/org-logos/';

/** Polish copy from `ManageSettingsPage` and the sidebar's `OrgSwitcher`. */
const COPY = {
  uploadLogo: 'Wgraj logo',
  noLogo: 'Brak logo',
  logoUpdated: 'Logo zaktualizowane',
  lockedTitle: 'Własny branding',
  brandColorLabel: 'Kolor marki',
} as const;

/**
 * A 1×1 PNG. Small, deterministic and accepted by the route's byte-signature
 * sniffing; the UI renders whatever size the slot asks for (48 px in settings,
 * 32 px in the switcher), so the pixel size does not matter here.
 */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface OrgDetail {
  id: string;
  name: string;
  logo_url: string | null;
}

interface OrgMembership {
  id: string;
  isActive: boolean;
  logo_url?: string | null;
}

function settingsPreview(page: Page, orgName: string) {
  // The 48×48 preview is the only image with the org name as alt text *and*
  // width 48; the switcher's 32 px avatar also uses the org name as its alt.
  return page.locator(`img[alt="${orgName}"][width="48"]`);
}

function switcherHeader(page: Page) {
  return page.locator('[data-sidebar="header"]');
}

function switcherImage(page: Page) {
  return switcherHeader(page).locator('img');
}

async function getOrg(page: Page, orgId: string): Promise<OrgDetail> {
  const response = await page.request.get(`/api/v1/organization/${orgId}`);
  expect(response.status(), 'GET /api/v1/organization/:id').toBe(200);
  const body = (await response.json()) as { success: boolean; data: OrgDetail };
  expect(body.success, 'organization response').toBe(true);
  return body.data;
}

/**
 * Grant the tenant org the `branding` entitlement on all of its roles and remove
 * any logo left by an earlier run of the same tenant. Both writes are scoped to
 * this tenant's rows (org id comes from the deterministic fixture) and are
 * idempotent.
 */
async function prepareBrandingTenant(tenant: QaTenant): Promise<void> {
  const orgId = tenant.org?.id;
  if (!orgId) throw new Error(`${CASE} needs the content tenant profile (org + manager)`);

  const db = createQaSupabase();

  const { data: roles, error: rolesError } = await db
    .from('org_roles')
    .select('id')
    .eq('organization_id', orgId);
  expect(rolesError, 'read the tenant org roles').toBeNull();
  const roleRows = (roles ?? []) as Array<{ id: string }>;
  expect(roleRows.length, 'the org has its three system roles').toBe(3);

  const { error: featureError } = await db.from('org_role_features').upsert(
    roleRows.map((role) => ({ org_role_id: role.id, feature_key: 'branding', is_enabled: true })),
    { onConflict: 'org_role_id,feature_key' },
  );
  expect(featureError, 'grant branding to the tenant org roles').toBeNull();

  const { data: current, error: readError } = await db
    .from('organizations')
    .select('logo_url')
    .eq('id', orgId)
    .maybeSingle();
  expect(readError, 'read the tenant logo').toBeNull();

  const previous = current?.logo_url as string | null | undefined;
  if (previous) {
    // Only a URL under this org's own storage prefix is removed; an arbitrary
    // persisted URL is left alone (the spec never deletes outside its tenant).
    const marker = `${STORAGE_PUBLIC_PATH}${orgId}/`;
    const index = previous.indexOf(marker);
    if (index >= 0) {
      const path = decodeURIComponent(previous.slice(index + STORAGE_PUBLIC_PATH.length));
      const { error: removeError } = await db.storage.from('org-logos').remove([path]);
      expect(removeError, 'remove the previous run’s logo object').toBeNull();
    }
  }

  const { error: resetError } = await db
    .from('organizations')
    .update({ logo_url: null })
    .eq('id', orgId);
  expect(resetError, 'reset the tenant logo').toBeNull();
}

/** Sign in as the tenant manager with this case's organization active. */
async function signInAsManager(page: Page, tenant: QaTenant): Promise<void> {
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
}

test('uploads a logo, shows it in the org switcher without a reload, and keeps it after a refresh', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  const orgId = tenant.org!.id;
  const orgName = tenant.org!.name;

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await prepareBrandingTenant(tenant);
  await signInAsManager(page, tenant);

  // --- Setup: /manage/settings with branding entitled ---------------------
  await page.goto('/manage/settings');
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // Entitled org: upload control + colour picker, never the lock card.
  await expect(page.getByRole('button', { name: COPY.uploadLogo, exact: true })).toBeVisible();
  await expect(page.getByText(COPY.brandColorLabel, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.lockedTitle, { exact: true })).toHaveCount(0);

  // The case's starting point: no logo in the org, so the switcher shows the
  // generated avatar and the settings page shows the placeholder.
  const before = await getOrg(page, orgId);
  expect(before.logo_url, 'the tenant starts without a logo').toBeNull();
  await expect(settingsPreview(page, orgName)).toHaveCount(0);
  await expect(page.getByText(COPY.noLogo, { exact: true })).toBeVisible();
  await expect(switcherImage(page)).toHaveAttribute(
    'src',
    `/api/v1/avatar/org/${encodeURIComponent(orgId)}`,
  );

  // Marker proving the switcher update below happened without a document load.
  await page.evaluate(() => {
    (window as Window & { __qaNoReload?: boolean }).__qaNoReload = true;
  });

  // --- Step 1: "Wgraj logo" → logo.png -----------------------------------
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: COPY.uploadLogo, exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: LOGO_PNG });

  await expect(page.getByText(COPY.logoUpdated, { exact: true })).toBeVisible();

  // --- Expected: 48×48 preview in settings -------------------------------
  await expect
    .poll(async () => (await getOrg(page, orgId)).logo_url, {
      message: 'the organization stores the uploaded logo',
      timeout: 15_000,
    })
    .not.toBeNull();
  const logoUrl = (await getOrg(page, orgId)).logo_url!;
  expect(logoUrl, 'logo stored in the public org-logos bucket').toContain(
    `${STORAGE_PUBLIC_PATH}${orgId}/`,
  );
  expect(logoUrl, 'logo keeps its sniffed PNG extension').toMatch(/\.png$/);

  const preview = settingsPreview(page, orgName);
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute('src', logoUrl);
  await expect(preview).toHaveAttribute('width', '48');
  await expect(preview).toHaveAttribute('height', '48');
  await expect(page.getByText(COPY.noLogo, { exact: true })).toHaveCount(0);

  // Stored bytes are actually the logo image, not just a string in the row.
  const object = await page.request.get(logoUrl);
  expect(object.status(), 'the uploaded logo is publicly readable').toBe(200);
  expect(object.headers()['content-type'], 'served content type').toContain('image/png');
  expect((await object.body()).length, 'served logo bytes').toBeGreaterThan(0);

  // --- Step 2: the sidebar org switcher, without a reload ----------------
  // The upload invalidates the `['orgs']` query; the switcher must swap the
  // generated avatar for the new logo in place.
  await expect(switcherImage(page)).toHaveAttribute('src', logoUrl, { timeout: 15_000 });
  await expect(switcherHeader(page).getByText(orgName, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { __qaNoReload?: boolean }).__qaNoReload ?? false,
    ),
    'the switcher updated without a document reload',
  ).toBe(true);
  await expect(page).toHaveURL(/\/manage\/settings$/);

  // Same data contract the switcher renders from.
  const orgsResponse = await page.request.get('/api/v1/me/orgs');
  expect(orgsResponse.status(), 'GET /api/v1/me/orgs').toBe(200);
  const orgsBody = (await orgsResponse.json()) as { success: boolean; data: OrgMembership[] };
  const activeOrg = orgsBody.data.find((org) => org.id === orgId);
  expect(activeOrg, 'the tenant org is one of the manager’s memberships').toBeTruthy();
  expect(activeOrg!.isActive, 'the tenant org is active').toBe(true);
  expect(activeOrg!.logo_url, 'the orgs endpoint carries the new logo').toBe(logoUrl);

  // --- Step 3: refresh keeps the logo ------------------------------------
  await page.reload();
  await expect(page).toHaveURL(/\/manage\/settings$/, { timeout: 20_000 });

  const afterReload = settingsPreview(page, orgName);
  await expect(afterReload).toHaveCount(1);
  await expect(afterReload).toHaveAttribute('src', logoUrl);
  await expect(afterReload).toHaveAttribute('width', '48');
  await expect(afterReload).toHaveAttribute('height', '48');
  await expect(switcherImage(page)).toHaveAttribute('src', logoUrl, { timeout: 15_000 });
  await expect(page.getByText(COPY.noLogo, { exact: true })).toHaveCount(0);
  await expect(page.getByText(COPY.logoUpdated, { exact: true })).toHaveCount(0);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
