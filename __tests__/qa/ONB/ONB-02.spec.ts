import { expect, test } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * ONB-02 — a teacher creates a class without invitations.
 *
 * Prerequisite ONB-01: an educator who is not a member of any organization is
 * sent to `/setup` (the first-run chooser), and `/edu` redirects back there.
 * The spec then walks the case: create „Moja Klasa”, check the live preview, the
 * done screen, and the `/edu` landing with the org switcher showing the class.
 *
 * The tenant is a `bare` one (`bun scripts/qa-tenant.ts ONB-02 --profile bare
 * --fresh`): one seeded educator, no organization, no group. Each independent
 * run uses a fresh run suffix, so the account has never onboarded; the derived
 * ids still come from `tenantKey`/`tenantId`.
 *
 * The selected organization is the only org this teacher belongs to, so the
 * spec never reads or mutates another worker's tenant. No global admin setting,
 * feature flag, plan or singleton row is touched: the class is created through
 * the product's own UI and the assertions are scoped to this teacher.
 */

const CASE = 'ONB-02';
const ORG_NAME = 'Moja Klasa';

test.describe('ONB-02 — teacher creates a class without invitations', () => {
  test('first-run educator creates „Moja Klasa” and lands on /edu', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, 'ONB-02 needs the bare (no-org) tenant profile').toBe('bare');

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite ONB-01: an org-less educator lands on /setup ---------
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/setup/ });
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const chooserTitle = page.getByRole('heading', { level: 1, name: 'Witaj w StudiQ' });
    await expect(chooserTitle).toBeVisible();
    const joinOption = page.getByRole('button', { name: /Dołącz do istniejącej organizacji/ });
    const createOption = page.getByRole('button', { name: /Utwórz własną klasę/ });
    await expect(joinOption).toBeVisible();
    await expect(createOption).toBeVisible();

    // ONB-01: a direct /edu visit must bounce back to the first-run chooser.
    await page.goto('/edu');
    await expect(page).toHaveURL(/\/setup$/, { timeout: 15_000 });
    await expect(chooserTitle).toBeVisible();

    // --- Step 1: „Utwórz własną klasę” ------------------------------------
    await createOption.click();
    await expect(page).toHaveURL(/\/setup\/classroom$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Skonfiguruj swoją klasę' }),
    ).toBeVisible();

    // --- Step 2: name the class and check the live preview ----------------
    await page.getByLabel('Nazwa klasy').fill(ORG_NAME);

    const preview = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText('Podgląd klasy', { exact: true }) });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(ORG_NAME, { exact: true })).toBeVisible();
    await expect(preview.getByText('1 członków', { exact: true })).toBeVisible();
    await expect(preview.getByText('Ty', { exact: true })).toBeVisible();
    await expect(preview.getByText('(Admin)', { exact: true })).toBeVisible();

    // The case is explicitly "bez zaproszeń": no invite row is added.
    await expect(page.locator('input[type="email"]')).toHaveCount(0);

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/organization',
    );
    await page.getByRole('button', { name: 'Utwórz klasę', exact: true }).click();

    const created = await createResponse;
    expect(created.status(), 'POST /api/v1/organization').toBe(201);
    const createdBody = (await created.json()) as { data?: { id?: string; name?: string } };
    expect(createdBody.data?.name).toBe(ORG_NAME);
    const orgId = createdBody.data?.id;
    expect(orgId, 'created organization id').toBeTruthy();

    // The class exists before the next step: „Gotowe! Twoja klasa została
    // utworzona.” replaces the form.
    await expect(page.getByRole('heading', { name: 'Gotowe!' })).toBeVisible();
    await expect(page.getByText('Twoja klasa została utworzona.', { exact: true })).toBeVisible();

    // --- Step 3: „Przejdź do panelu” → /edu -------------------------------
    await page.getByRole('button', { name: 'Przejdź do panelu', exact: true }).click();
    await expect(page).toHaveURL(/\/edu(\/|$)/, { timeout: 15_000 });
    await expect(page.getByText('Panel Nauczyciela', { exact: true })).toBeVisible();

    // The sidebar org switcher shows the class the teacher just created.
    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar.getByText(ORG_NAME, { exact: true })).toBeVisible();
    await expect(
      sidebar.locator('[data-slot="dropdown-menu-trigger"]').filter({ hasText: ORG_NAME }),
    ).toContainText('Admin');

    // Server state from the same session: exactly one org, active, admin role.
    const orgsResponse = await page.request.get('/api/v1/me/orgs');
    expect(orgsResponse.ok(), 'GET /api/v1/me/orgs').toBe(true);
    const orgsBody = (await orgsResponse.json()) as {
      data?: Array<{ id: string; name: string; orgRoleName: string; isActive: boolean }>;
    };
    expect(orgsBody.data).toHaveLength(1);
    expect(orgsBody.data?.[0]).toMatchObject({
      id: orgId,
      name: ORG_NAME,
      orgRoleName: 'admin',
      isActive: true,
    });

    // Regression #305: the dashboard must not bounce back to /setup after the
    // org cache is refreshed.
    await expect(page).not.toHaveURL(/\/setup/);
    await expect(page.getByRole('heading', { name: 'Witaj w StudiQ' })).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
