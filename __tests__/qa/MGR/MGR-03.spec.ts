import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant } from '@qa/fixtures/qa-tenant';
import type { SeedAccount } from '#test/helpers/tenant-seed';

/**
 * MGR-03 — organization data must not mix when the manager switches the active
 * organization from the sidebar switcher.
 *
 * Prerequisite (reconciled with the tenant seeder): a manager who administers **two**
 * organizations. The legacy manual seed (`manager@dev.local`, password `pass`,
 * WSB Merito / UE Wrocław) is never used. The case's own tenant provides, per org, a
 * distinct student, two groups and one pending invitation:
 *
 * - org A — S1 + teacher T1, groups `O1G1` / `O1G2`, pending invite for
 *   `mgr03-invite-a-<run>`
 * - org B — S2 only, groups `O2G1` / `O2G2`, pending invite for `mgr03-invite-b-<run>`
 *
 * The two orgs deliberately have different member counts (3 vs 2, teachers 1 vs 0), so
 * a counter that leaked from the other organization cannot coincide with the expected
 * one.
 *
 * Tenant: `scripts/qa-tenant.ts MGR-03` seeds both organizations up front (the
 * `two-org` profile) with one manager who is admin in each; the spec only reads
 * `qa/.tenants/MGR-03.json`. Every account/org/group/invitation id is
 * `tenantId(key, entity)` with a run suffix, so each independent run gets its own
 * pair of organizations. The spec seeds nothing itself.
 *
 * Acceptance points:
 * 1. Switching at the top of the sidebar lands back on `/manage` and the overview
 *    (member counts + „Ostatni członkowie”) describes the newly active org.
 * 2. `/manage/members`, `/manage/groups` and `/manage/invites` show only the active
 *    org's rows — the other org's student, groups and invitation never appear.
 * 3. The switch persists across a reload, and switching back restores the first org's
 *    data on the same three pages.
 */

const CASE = 'MGR-03';

/**
 * The case's two-organization tenant, seeded once by `scripts/qa-tenant.ts`
 * (`two-org` profile) before the suite starts:
 *
 *   bun scripts/qa-tenant.ts MGR-03 --fresh
 */
function twoOrgTenant(): TwoOrgTenant {
  const tenant = loadTenant(CASE) as unknown as TwoOrgTenant & { runSuffix: string | null };
  expect(
    tenant.runSuffix,
    'seed with --fresh: every independent run owns a new tenant',
  ).toBeTruthy();
  return tenant;
}

/**
 * Real login through the API, then boot the app with the locale the case's copy is
 * written in and the case's first organization active. Logs any previous user out
 * first, so the run never inherits a session from another worker.
 */
async function signInAs(
  page: Page,
  baseURL: string,
  account: SeedAccount,
  orgId: string,
): Promise<void> {
  await page.request.post('/api/v1/auth/logout');

  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: orgId, domain: hostname, path: '/', httpOnly: true },
  ]);

  await page.goto('/manage');
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
}

/** The sidebar's organization switcher, addressed by the organization it shows. */
function orgSwitcher(page: Page, orgName: string): Locator {
  return page.getByRole('button', { name: orgName });
}

/** Step 1 of the case: pick the other organization from the switcher at the top. */
async function switchToOrg(page: Page, fromOrgName: string, toOrgName: string): Promise<void> {
  await orgSwitcher(page, fromOrgName).click();
  await page.getByRole('menuitem', { name: toOrgName }).click();
  await expect(orgSwitcher(page, toOrgName)).toBeVisible();
}

/** Value rendered by a dashboard `StatCard` (title paragraph → value paragraph). */
function statValue(page: Page, title: string): Locator {
  return page.getByText(title, { exact: true }).locator('..').locator('p').nth(1);
}

/** The active org's overview: totals and „Ostatni członkowie”. */
async function expectOverviewShows(page: Page, org: QaOrg, other: QaOrg): Promise<void> {
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
  await expect(orgSwitcher(page, org.name)).toBeVisible();

  // Counters describe this org only; the two orgs have different counts, so a leaked
  // figure from the other organization cannot match by coincidence.
  await expect(statValue(page, 'Łączna liczba członków')).toHaveText(String(org.counts.total));
  await expect(statValue(page, 'Wykładowcy')).toHaveText(String(org.counts.teachers));
  await expect(statValue(page, 'Studenci')).toHaveText(String(org.counts.students));

  await expect(page.getByText('Ostatni członkowie')).toBeVisible();
  await expect(page.getByText(org.student.name!, { exact: true })).toBeVisible();
  await expect(page.getByText(other.student.name!, { exact: true })).toHaveCount(0);
}

/** Step 2 of the case: the three admin lists only carry the active org's rows. */
async function expectOrgListsShow(page: Page, org: QaOrg, other: QaOrg): Promise<void> {
  // Members: the count, the student of this org and their group badges.
  await page.goto('/manage/members');
  await expect(page.getByRole('heading', { name: 'Członkowie' })).toBeVisible();
  await expect(page.getByText(`${org.counts.total} łącznie`)).toBeVisible();

  const membersTable = page.getByRole('table');
  await expect(membersTable.getByText(org.student.email)).toBeVisible();
  await expect(membersTable.getByText(org.student.name!, { exact: true })).toBeVisible();
  for (const group of org.groups) {
    await expect(
      membersTable.getByText(group, { exact: true }).first(),
      `member list group ${group}`,
    ).toBeVisible();
  }
  await expect(page.getByText(other.student.email)).toHaveCount(0);
  await expect(page.getByText(other.student.name!, { exact: true })).toHaveCount(0);

  // Groups: exactly this org's two groups, none of the other org's.
  await page.goto('/manage/groups');
  await expect(page.getByRole('heading', { name: 'Grupy' })).toBeVisible();

  const groupsTable = page.getByRole('table');
  for (const group of org.groups) {
    await expect(groupsTable.getByText(group, { exact: true }), `group row ${group}`).toHaveCount(
      1,
    );
  }
  for (const group of other.groups) {
    await expect(
      page.getByText(group, { exact: true }),
      `foreign group ${group} must not be listed`,
    ).toHaveCount(0);
  }

  // Invitations: only this org's pending invite.
  await page.goto('/manage/invites');
  await expect(page.getByRole('heading', { name: 'Zaproszenia' })).toBeVisible();

  const invitesTable = page.getByRole('table');
  await expect(invitesTable.getByText(org.inviteEmail)).toBeVisible();
  await expect(invitesTable.getByText('Oczekujące')).toBeVisible();
  await expect(page.getByText(other.inviteEmail)).toHaveCount(0);
}

test.describe('@case:MGR-03 @area:MGR @prio:P2 organization data isolation', () => {
  test.setTimeout(180_000);

  let tenant: TwoOrgTenant;

  test.beforeAll(async () => {
    tenant = twoOrgTenant();
    console.log(
      `MGR-03 tenant key: ${tenant.key} (manager ${tenant.manager.email}, ` +
        `org A ${tenant.orgA.id} / ${tenant.orgA.name}, org B ${tenant.orgB.id} / ` +
        `${tenant.orgB.name})`,
    );
  });

  test('switching the active organization swaps members, groups and invitations', async ({
    page,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';
    const { orgA, orgB } = tenant;

    // Start as the two-org manager with org A active.
    await signInAs(page, origin, tenant.manager, orgA.id);
    await expectOverviewShows(page, orgA, orgB);
    await expectOrgListsShow(page, orgA, orgB);

    // Step 1: switch from the top of the sidebar while on the overview. The route does
    // not change, so the data has to follow the active org instead of the mount.
    await page.goto('/manage');
    await expect(page).toHaveURL(/\/manage$/);
    await switchToOrg(page, orgA.name, orgB.name);

    // Step 2 (after the switch): still on /manage, and the overview describes org B.
    expect(new URL(page.url()).pathname).toBe('/manage');
    await expectOverviewShows(page, orgB, orgA);
    await expectOrgListsShow(page, orgB, orgA);

    // The switch is server state (the `active_org_id` cookie), so a reload keeps it.
    await page.goto('/manage/members');
    await expect(page.getByText(orgB.student.email)).toBeVisible();
    await page.reload();
    await expect(page.getByText(orgB.student.email)).toBeVisible();
    await expect(page.getByText(orgA.student.email)).toHaveCount(0);

    // Switching back from a subpage returns to /manage and restores org A's data.
    await switchToOrg(page, orgB.name, orgA.name);
    await expectOverviewShows(page, orgA, orgB);
    await expectOrgListsShow(page, orgA, orgB);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
