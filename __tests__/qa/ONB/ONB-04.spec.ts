import { expect, test } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * ONB-04 — Manager bez organizacji → /setup/org.
 *
 * Prerequisite: a signed-in manager who belongs to **no organization**. That is
 * the `bare` tenant profile with the manager account:
 *
 *   bun scripts/qa-tenant.ts ONB-04 --profile bare --role manager --fresh
 *
 * Each independent run seeds a fresh run suffix, because the run itself creates
 * the organization: reusing the account would skip the first-run gate. All ids
 * still come from `tenantKey`/`tenantId`, and the created organ is the only row
 * the spec touches, so nothing shared with another worker is read or mutated.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture
 * pins `NEXT_LOCALE=pl` so a locale cookie from an earlier case cannot change
 * the strings under test.
 */

const CASE = 'ONB-04';
const ORG_NAME = 'Test Uczelnia';

const COPY = {
  title: 'Skonfiguruj swoją organizację',
  nameLabel: 'Nazwa organizacji',
  create: 'Utwórz organizację',
  admin: 'Admin',
} as const;

test('a manager without an organization creates it from /setup/org and lands on /manage', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the bare (no-org) tenant profile`).toBe('bare');
  expect(tenant.role, `${CASE} needs a bare manager`).toBe('manager');
  const manager = tenant.users.manager;
  if (!manager) throw new Error(`tenant ${CASE} has no seeded manager`);

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // --- Prerequisite: a manager with zero organizations, signed in -----------
  // `/login` forwards the manager to `/manage`; the dashboard gate then replaces
  // the URL with `/setup/org` (step 1: "po zalogowaniu obserwuj adres").
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/setup\/org/ });

  await expect(page).toHaveURL(/\/setup\/org$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  const beforeResponse = await page.request.get('/api/v1/me/orgs');
  expect(beforeResponse.status(), 'GET /api/v1/me/orgs').toBe(200);
  const before = (await beforeResponse.json()) as { data: unknown[] };
  expect(before.data, 'the fixture manager must belong to no organization').toEqual([]);

  // Adjacent regression: the dashboard itself is gated, not just `/login`.
  await page.goto('/manage');
  await expect(page).toHaveURL(/\/setup\/org$/, { timeout: 20_000 });
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.title);

  // --- Step 2a: the create button is inactive for an empty name -------------
  const nameInput = page.getByLabel(COPY.nameLabel);
  const createButton = page.getByRole('button', { name: COPY.create, exact: true });

  await expect(nameInput).toHaveValue('');
  await expect(createButton).toBeDisabled();

  // The disabled state follows the field, in both directions.
  await nameInput.fill(ORG_NAME);
  await expect(createButton).toBeEnabled();
  await nameInput.fill('');
  await expect(createButton).toBeDisabled();

  // --- Step 2b: name the organization and create it ------------------------
  await nameInput.fill(ORG_NAME);
  await expect(createButton).toBeEnabled();

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/organization',
  );
  await createButton.click();

  const created = await createResponse;
  expect(created.status(), 'POST /api/v1/organization').toBe(201);
  const createdBody = (await created.json()) as { data?: { id?: string; name?: string } };
  expect(createdBody.data?.name).toBe(ORG_NAME);
  const orgId = createdBody.data?.id;
  expect(orgId, 'created organization id').toBeTruthy();

  // Expected: the setup screen leaves for the manager dashboard.
  await expect(page).toHaveURL(/\/manage(\/|$)/, { timeout: 20_000 });

  // The org switcher shows the new organization with the creator's Admin role.
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar.getByText(ORG_NAME, { exact: true })).toBeVisible();

  const switcher = sidebar
    .locator('[data-slot="dropdown-menu-trigger"]')
    .filter({ hasText: ORG_NAME });
  await expect(switcher).toHaveCount(1);
  await expect(switcher).toContainText(COPY.admin);

  await switcher.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const orgItem = menu.getByRole('menuitem').filter({ hasText: ORG_NAME });
  await expect(orgItem).toHaveCount(1);
  await expect(orgItem).toContainText(COPY.admin);
  await page.keyboard.press('Escape');

  // Server state from the same session: exactly one organization, active, and
  // owned through the `admin` role.
  const afterResponse = await page.request.get('/api/v1/me/orgs');
  expect(afterResponse.status(), 'GET /api/v1/me/orgs').toBe(200);
  const after = (await afterResponse.json()) as {
    data: Array<{ id: string; name: string; orgRoleName: string; isActive: boolean }>;
  };
  expect(after.data).toHaveLength(1);
  expect(after.data[0]).toMatchObject({
    id: orgId,
    name: ORG_NAME,
    orgRoleName: 'admin',
    isActive: true,
  });

  // Expected: the organization owns the three system roles `member`, `teacher`
  // and `admin`. `/organization/roles` reads `org_roles` for the active org, so
  // this asserts the rows the trigger created, not just UI copy.
  const rolesResponse = await page.request.get('/api/v1/organization/roles');
  expect(rolesResponse.status(), 'GET /api/v1/organization/roles').toBe(200);
  const rolesBody = (await rolesResponse.json()) as {
    data: Array<{ name: string; isSystem: boolean; memberCount: number }>;
  };
  expect(rolesBody.data.map((role) => role.name).sort()).toEqual(['admin', 'member', 'teacher']);
  expect(rolesBody.data.every((role) => role.isSystem)).toBe(true);
  expect(rolesBody.data.find((role) => role.name === 'admin')?.memberCount).toBe(1);

  // Adjacent regression (#305/#306): a reload of the dashboard must keep the
  // freshly created organization active instead of bouncing back to setup.
  await page.reload();
  await expect(page).toHaveURL(/\/manage(\/|$)/, { timeout: 20_000 });
  await expect(sidebar.getByText(ORG_NAME, { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="card-title"]', { hasText: COPY.title })).toHaveCount(0);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
