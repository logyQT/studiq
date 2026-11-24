import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, tenantUser } from '#test/qa/fixtures/tenant';

/**
 * AUT-20 — a bookmarked `/manage/...` in an organization where the caller is a
 * plain Member (ADR-0015 §7.1 / §14.1).
 *
 * Case: log in as the tenant's student (an org Member with no `org.*` key), open
 * the remembered URL `/manage/members`, and assert the page **loads and keeps its
 * URL** — not a redirect, not a 404 — with the org-scoped no-access card, the
 * switch/fallback action, a `/manage` nav without the administration entries and
 * an empty roster deny shape. Control: the manager sees the member list and no
 * card.
 *
 * Tenant: the default `content` profile (one org, manager/teacher/student), no
 * profile file:
 *   `bun run env:run -- bun scripts/qa-tenant.ts AUT-20 --fresh`.
 *
 * Walk: **API half walked, UI half not run in the implementer's worktree.**
 * 2026-11-24, this worktree on base `999c45ab` + the uncommitted change, against
 * the served app on :3000 (the build predates this branch, so the new gate is not
 * on screen). Seeded with `bun run env:run -- bun scripts/qa-tenant.ts AUT-20
 * --fresh` and driven with a headless session per account:
 *   - the tenant has one org; the student's `/me/permissions` carries 26 keys and
 *     **no `org.*`**, while the manager carries all nine and the teacher none, so
 *     "a Member holds no management key" is measured, not assumed;
 *   - `GET /api/v1/organization/members` as the student → `200 {success:true,
 *     data:[]}` (D25 deny shape), as the manager → 3 rows, and
 *     `PUT /organization/members` → `403 FORBIDDEN` for all three;
 *   - `/manage/members` answered `200` with no `Location` for the student.
 * The page-level half below (card title, fallback link, hidden nav) is read from
 * the code — `AreaGate` renders inside `[data-slot="area-gate"]`, its title is
 * the literal below, the single-org action is the `/app` link, and the nav gates
 * leave the student without the administration entries. **The coordinator runs
 * the UI walk on this branch's build** and should replace this paragraph with
 * the dated record.
 *
 * Mutation (proves this spec can fail; **not run here** — the built app is the
 * base commit's): force `hasAreaAccess` to `true` in
 * `apps/web/src/components/layout/area-gate.tsx`, so the gate always renders its
 * children → the assertions that die are the card's (`[data-slot="area-gate"]`
 * count and its title) and the absent member table; the manager control stays
 * green, because it never renders the card either way. (Deleting the children
 * branch instead is killed by the manager control test, which needs the table.)
 * Restore and re-run green. The coordinator owns that run.
 */

const CASE = 'AUT-20';

/** Polish copy of the `AreaGate` namespace (asserted literally, never resolved). */
const NO_ACCESS_TITLE = 'Brak dostępu w tej organizacji';
const OWN_SPACE_LINK = 'Przejdź do swojej przestrzeni';

/** The `/manage` entries a Member must not be offered. */
const HIDDEN_NAV = [
  '/manage/members',
  '/manage/invites',
  '/manage/roles',
  '/manage/seats',
  '/manage/settings',
];

function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]');
}

test('a member keeps the URL on /manage/members and sees the org-scoped no-access card', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const tenant = loadTenant(CASE);
  const student = tenantUser(tenant, 'student');
  const manager = tenantUser(tenant, 'manager');
  const orgName = tenant.org?.name;
  if (!orgName) throw new Error(`${CASE} needs the content tenant profile (an organization)`);

  await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app$/ });

  // --- Step 2: the bookmarked URL loads and keeps its address ---------------
  await page.goto('/manage/members');
  expect(new URL(page.url()).pathname, 'the bookmarked URL keeps its path').toBe('/manage/members');

  // --- Step 3: the no-access card, naming the active org -------------------
  const card = page.locator('[data-slot="area-gate"]');
  await expect(card, 'the org-scoped no-access card renders').toHaveCount(1);
  await expect(card.getByRole('heading', { name: NO_ACCESS_TITLE })).toBeVisible();
  await expect(card, 'the card names the active organization').toContainText(orgName);

  // The URL is re-checked now that the gate has decided, not only after the
  // navigation: a delayed client redirect would otherwise slip past the first
  // assertion, which ran before anything had resolved.
  expect(
    new URL(page.url()).pathname,
    'the bookmarked URL still keeps its path after the gate resolved',
  ).toBe('/manage/members');

  // One membership in the `content` tenant, so the action is the own-space link.
  const ownSpace = card.getByRole('link', { name: OWN_SPACE_LINK, exact: true });
  await expect(ownSpace, 'the single-org fallback action').toHaveAttribute('href', '/app');

  // The page's own content is not rendered: no member table, no other people's
  // e-mail on the screen the member was refused.
  await expect(page.locator('table'), 'the member table is not rendered').toHaveCount(0);
  // This one pins the D25 deny shape (the API answers zero rows, so no e-mail
  // could be on screen even behind the gate), not the gate itself.
  await expect(page.getByText(manager.email)).toHaveCount(0);

  // --- Step 4: the /manage nav offers no administration entry -------------
  const nav = sidebar(page);
  for (const href of HIDDEN_NAV) {
    await expect(nav.locator(`a[href="${href}"]`), `${href} is hidden`).toHaveCount(0);
  }
  // Membership alone still offers the overview, and `group.read` the class
  // lists — `/manage/groups` in this area, `/edu/groups` in the other.
  await expect(nav.locator('a[href="/manage"]')).toHaveCount(1);

  // --- Step 5: the API is the boundary ------------------------------------
  const roster = await page.request.get('/api/v1/organization/members');
  expect(roster.status(), 'GET /api/v1/organization/members as a member').toBe(200);
  expect(await json<unknown>(roster), 'the D25 deny shape carries no rows').toEqual({
    success: true,
    data: [],
  });

  // A write is refused outright: the member holds no `org.member.manage`.
  const write = await page.request.put('/api/v1/organization/members', {
    data: {
      targetUserId: student.id,
      newOrgRoleId: '00000000-0000-4000-8000-0000000000ff',
    },
  });
  expect(write.status(), 'PUT /api/v1/organization/members as a member').toBe(403);
  expect(await write.json()).toMatchObject({ success: false, error: 'FORBIDDEN' });
});

test('control: the manager sees the member list on the same URL and no card', async ({ page }) => {
  test.setTimeout(90_000);

  const tenant = loadTenant(CASE);
  const student = tenantUser(tenant, 'student');

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage($|\/)/ });

  await page.goto('/manage/members');
  expect(new URL(page.url()).pathname).toBe('/manage/members');
  await expect(page.locator('[data-slot="area-gate"]'), 'no gate for the manager').toHaveCount(0);
  await expect(page.locator('table')).toHaveCount(1);
  // The same member the student could not see is listed for the manager.
  await expect(page.getByText(student.email).first()).toBeVisible();
});
