import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * ONB-05 — Student bez organizacji (S3).
 *
 * Prerequisite: a signed-in student who belongs to **no** organization, i.e. the
 * standalone (B2C) account from the legacy seed (`student3@dev.local`). The suite
 * version seeds exactly that shape with the `bare` profile and the student role
 * (`bun scripts/qa-tenant.ts ONB-05 --profile bare --role student --fresh`): one
 * student, no organization, no group, no content. The spec reads the account from
 * `qa/.tenants/ONB-05.json` and never creates accounts itself.
 *
 * The case's two acceptance points:
 * 1. the student can use `/app` with no organization — nothing forces onboarding;
 * 2. the sidebar org switcher shows „StudiQ / Student” and, expanded,
 *    „Nie należysz do żadnej organizacji” plus the „Dołącz do klasy” option.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the login helper
 * pins `NEXT_LOCALE=pl`, so a locale cookie left by an earlier case cannot change
 * the strings under test. The tenant owns no org, group, deck or bank row, and
 * every assertion is a read, so no other case can observe or invalidate it.
 */

const CASE = 'ONB-05';

const UI = {
  standalone: 'StudiQ',
  noOrg: 'Nie należysz do żadnej organizacji',
  join: 'Dołącz do klasy',
} as const;

// The switcher is the top entry of the sidebar: a Radix dropdown trigger whose
// accessible name is the product name plus the role. Naming it by content (not by
// position) keeps the locator off the user menu at the bottom, which is the only
// other `data-size="lg"` dropdown trigger in the shell and also matches the
// structural selector while the org list is still loading.
const switcherTrigger = (page: Page) => page.getByRole('button', { name: /StudiQ\s*Student/ });

async function signIn(page: Page): Promise<void> {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the bare (no-org) tenant profile`).toBe('bare');
  expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
  expect(tenant.org, 'the bare student must not own an organization').toBeNull();
  await loginAs(page, tenant, 'student', { locale: 'pl' });
}

/**
 * The on-screen precondition: the account really belongs to zero organizations.
 * Asserting it keeps the switcher assertions from passing for the wrong reason —
 * the standalone trigger also renders when `/api/v1/me/orgs` fails.
 */
async function expectNoOrganizations(page: Page): Promise<void> {
  const response = await page.request.get('/api/v1/me/orgs');
  expect(response.status(), 'GET /api/v1/me/orgs').toBe(200);
  const body = (await response.json()) as { success: boolean; data: unknown[] };
  expect(body.success).toBe(true);
  expect(body.data, 'the fixture student must belong to no organization').toEqual([]);
}

test.describe('ONB-05 — student without an organization', () => {
  test('uses /app without onboarding and sees the „StudiQ / Student” switcher', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await signIn(page);

    // Step 0 (case prerequisite): no forced onboarding — the student dashboard,
    // not the educator `/setup` chooser.
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cześć');
    await expectNoOrganizations(page);

    // A cold load re-runs the onboarding guard on a settled empty org list; the
    // student must stay in the panel instead of being pushed to `/setup`.
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cześć');

    // Step 1: the top of the sidebar is the org switcher, in its standalone
    // state: product name „StudiQ” with the student role underneath — no org.
    const trigger = switcherTrigger(page);
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText(/^StudiQ\s*Student$/);

    // Step 2: expanding it explains the standalone state and offers joining a class.
    await trigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText(UI.noOrg)).toBeVisible();
    const joinItem = menu.getByRole('menuitem', { name: UI.join });
    await expect(joinItem).toBeVisible();

    expect(pageErrors, 'no uncaught page error while rendering the standalone panel').toEqual([]);
  });

  test('the „Dołącz do klasy” option opens the invitation-code screen', async ({ page }) => {
    await signIn(page);
    await expectNoOrganizations(page);

    await switcherTrigger(page).click();
    await page.getByRole('menu').getByRole('menuitem', { name: UI.join }).click();

    // The option must lead somewhere usable — the join screen a B2C student uses
    // to redeem a class invitation.
    await expect(page).toHaveURL(/\/app\/join$/);
    await expect(page.getByRole('textbox', { name: 'Kod zaproszenia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dołącz', exact: true })).toBeVisible();
    await expect(switcherTrigger(page)).toContainText(UI.standalone);
  });
});
