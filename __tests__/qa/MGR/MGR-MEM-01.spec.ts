import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-MEM-01 — the members list: search, role filter, counters and the
 * per-row affordances.
 *
 * Prerequisite (reconciled with the tenant seeder): a signed-in organization
 * manager; the legacy `manager@dev.local` / `student1@dev.local` accounts and
 * the password `pass` are never used.
 *
 * Tenant: the case's profile (`__tests__/qa/profiles/MGR-MEM-01.json`), seeded once
 * before Playwright starts by `bun scripts/qa-tenant.ts --all --run <suffix>`.
 * It declares one organization and the case's exact roster, so no two
 * independent runs share an organization or a row:
 *
 * - the manager (org `admin`) and the default group `G1`;
 * - the teacher (org `teacher`) — the tenant counterpart of `T1`, so the
 *   "Nauczyciel"/"Teacher" filter has a row to keep;
 * - a student (org `member`) — the counterpart of `S1`, searched by e-mail;
 * - a second `member` with an **empty full name**, so the list has a real row
 *   for the "Bez imienia" fallback. The product's registration form requires a
 *   name, so the profile declares `"name": ""` and the seeder writes it as-is.
 *
 * The spec never seeds: it reads the tenant with `loadTenant('MGR-MEM-01')`.
 * Nothing global is written (no admin setting, feature flag, plan, platform
 * stat or singleton row) and no other case's tenant is touched.
 *
 * Two deliberate deviations from the manual document, recorded in
 * `qa/cases/MGR-MEM-01.md` under "Observed during the suite walk":
 *
 * 1. The document enumerates the columns as Członek, Rola, Dołączył, Grupy,
 *    Akcje; the page has rendered Grupy before Dołączył since the groups column
 *    landed. All five columns exist with the right content, so the test pins the
 *    set of headers, not the stale order.
 * 2. The document quotes the role filter as „Nauczyciel”/„Członek”; the filter
 *    renders the system roles' display names (Admin/Teacher/Student), as every
 *    other role picker in the app does. That is a P3 wording drift (the manual
 *    doc lists text mismatches as language notes, not functional errors); the
 *    filtering behaviour is what the test asserts.
 */

const CASE = 'MGR-MEM-01';
const TENANT: QaTenant = loadTenant(CASE);

/** Polish copy from `ManageMembersPage` and the organization role defaults. */
const COPY = {
  title: 'Członkowie',
  searchPlaceholder: 'Szukaj członków',
  roleFilter: 'Filtruj po roli',
  allRoles: 'Wszystkie role',
  self: '(ty)',
  unnamed: 'Bez imienia',
  manageGroups: 'Zarządzaj grupami',
} as const;

/** The system roles' `display_name` (seeded by the migration; not translated). */
const ROLE_LABEL = { admin: 'Admin', teacher: 'Teacher', member: 'Student' } as const;
type OrgRoleName = keyof typeof ROLE_LABEL;

const HEADERS = ['Członek', 'Rola', 'Grupy', 'Dołączył', 'Akcje'] as const;

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: OrgRoleName;
  orgRoleId: string;
  created_at: string;
  groups: Array<{ id: string; name: string; role: string }>;
}

interface OrgRole {
  id: string;
  name: string;
  displayName: string;
  isSystem: boolean;
}

async function getData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data;
}

function listMembers(page: Page): Promise<Member[]> {
  return getData<Member[]>(page, '/api/v1/organization/members');
}

function listRoles(page: Page): Promise<OrgRole[]> {
  return getData<OrgRole[]>(page, '/api/v1/organization/roles');
}

/**
 * The page's own rows. The "nothing matches" placeholder is also a `<tr>`, so a
 * bare `tbody tr` count would be off by one on an empty result.
 */
function memberRows(page: Page) {
  return page
    .locator('table tbody tr')
    .filter({ has: page.locator('[data-testid="member-role"]') });
}

function rowFor(page: Page, email: string) {
  return memberRows(page).filter({ hasText: email });
}

/** A member's row label is their name, or their e-mail when the profile has none. */
function displayName(member: Member): string {
  return member.full_name || member.email;
}

test.describe('@case:MGR-MEM-01 @area:MGR @prio:P1 members search and role filter', () => {
  test('lists every member, searches by name and e-mail, and narrows by role', async ({ page }) => {
    test.setTimeout(120_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const manager = TENANT.users.manager;
    const teacher = TENANT.users.teacher;
    const student = TENANT.users.student;
    const unnamed = TENANT.users.unnamed;
    if (!manager || !teacher || !student || !unnamed) {
      throw new Error(`tenant ${CASE} needs the members profile (manager/teacher/student/unnamed)`);
    }

    // Real login through the API; `loginAs` pins Polish copy and the tenant's
    // `active_org_id`, the cookie the app writes when an organization is created
    // or switched.
    await loginAs(page, TENANT, 'manager', { locale: 'pl', waitFor: /\/manage$/ });

    // The server state every assertion below is derived from: four members, one
    // per role that the filter offers, plus the nameless one.
    const members = await listMembers(page);
    expect(members, 'the seeded organization has four members').toHaveLength(4);
    expect(
      members.filter((member) => member.orgRoleName === 'admin').map((member) => member.email),
      'exactly one admin (the signed-in manager)',
    ).toEqual([manager.email]);
    expect(
      members.filter((member) => member.orgRoleName === 'teacher').map((member) => member.email),
      'exactly one teacher',
    ).toEqual([teacher.email]);
    expect(
      members.filter((member) => member.orgRoleName === 'member').map((member) => member.email),
      'two members',
    ).toHaveLength(2);

    const roles = await listRoles(page);
    expect(
      roles.filter((role) => role.isSystem).map((role) => role.displayName),
      'the organization offers the three system roles',
    ).toEqual(expect.arrayContaining([ROLE_LABEL.admin, ROLE_LABEL.teacher, ROLE_LABEL.member]));

    // --- Step 1: /manage/members ------------------------------------------
    await page.goto('/manage/members');
    await expect(page).toHaveURL(/\/manage\/members$/, { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.getByRole('heading', { level: 2, name: COPY.title, exact: true }),
    ).toBeVisible();

    // --- Expected result: the counter and the five columns -----------------
    const counter = page.getByText(`${members.length} łącznie`, { exact: true });
    await expect(
      counter,
      'the counter is the whole organization, not the filtered rows',
    ).toBeVisible();

    const headers = await page
      .locator('table thead th')
      .evaluateAll((cells) => cells.map((cell) => (cell.textContent ?? '').trim()));
    expect(new Set(headers), 'the table has exactly the five documented columns').toEqual(
      new Set(HEADERS),
    );
    expect(headers, 'no duplicated column').toHaveLength(HEADERS.length);

    // --- Expected result: one row per member, with role, groups and actions --
    await expect(memberRows(page)).toHaveCount(members.length);

    for (const member of members) {
      const row = rowFor(page, member.email);
      await expect(row, `${member.email} has one row`).toHaveCount(1);
      await expect(row.getByText(displayName(member), { exact: true })).toBeVisible();
      await expect(row.getByText(member.email, { exact: true })).toBeVisible();
      await expect(row.getByTestId('member-role')).toHaveText(ROLE_LABEL[member.orgRoleName]);
      for (const group of member.groups) {
        await expect(row.getByText(group.name, { exact: true })).toBeVisible();
      }
      // `formatDate(..., 'pl')` → dd.MM.yyyy, never an empty cell.
      await expect(row).toContainText(/\d{1,2}\.\d{1,2}\.\d{4}/);

      if (member.id === manager.id) {
        // --- Expected result: the own account is marked and not actionable --
        await expect(row.getByText(COPY.self, { exact: true })).toBeVisible();
        await expect(row.getByRole('button'), 'own row offers no action').toHaveCount(0);
        await expect(row.getByRole('combobox'), 'own row offers no role select').toHaveCount(0);
      } else {
        await expect(row.getByText(COPY.self, { exact: true })).toHaveCount(0);
        await expect(
          row.getByRole('button', { name: COPY.manageGroups, exact: true }),
        ).toBeVisible();
        await expect(row.getByRole('combobox'), 'the role is editable in place').toHaveCount(1);
        await expect(
          row.getByRole('button', { name: `Usuń członka ${displayName(member)}`, exact: true }),
        ).toBeVisible();
      }
    }

    // The member with an empty full name gets the documented fallback, and still
    // carries its e-mail so the manager can tell the rows apart.
    const unnamedRow = rowFor(page, unnamed.email);
    await expect(unnamedRow.locator('p').first()).toHaveText(COPY.unnamed);
    await expect(unnamedRow.locator('p').nth(1)).toHaveText(unnamed.email);

    // --- Step 2: search by name, then by e-mail, case-insensitively --------
    const search = page.getByPlaceholder(COPY.searchPlaceholder);

    await search.fill('TEACHER'); // upper-case query, lower-case name in the profile
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowFor(page, teacher.email)).toHaveCount(1);
    await expect(rowFor(page, teacher.email).getByTestId('member-role')).toHaveText(
      ROLE_LABEL.teacher,
    );
    await expect(counter, 'search does not change the organization counter').toBeVisible();

    await search.fill(student.email.toUpperCase());
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowFor(page, student.email)).toHaveCount(1);
    await expect(counter).toBeVisible();

    await search.fill('');
    await expect(memberRows(page)).toHaveCount(members.length);

    // --- Step 3: "Filtruj po roli" ----------------------------------------
    const filter = page.getByRole('combobox', { name: COPY.roleFilter, exact: true });
    await expect(filter).toHaveText(COPY.allRoles);

    await filter.click();
    await expect(page.getByRole('option'), 'every role plus "all"').toHaveCount(roles.length + 1);
    for (const label of [COPY.allRoles, ...Object.values(ROLE_LABEL)]) {
      await expect(page.getByRole('option', { name: label, exact: true })).toHaveCount(1);
    }

    // Teacher: only the teacher's row survives.
    await page.getByRole('option', { name: ROLE_LABEL.teacher, exact: true }).click();
    await expect(filter).toHaveText(ROLE_LABEL.teacher);
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowFor(page, teacher.email)).toHaveCount(1);
    await expect(counter, 'the role filter does not change the counter').toBeVisible();

    // Member (displayed "Student"): the named student and the nameless member.
    await filter.click();
    await page.getByRole('option', { name: ROLE_LABEL.member, exact: true }).click();
    await expect(memberRows(page)).toHaveCount(2);
    await expect(rowFor(page, student.email)).toHaveCount(1);
    await expect(rowFor(page, unnamed.email)).toHaveCount(1);

    // All roles: back to the full list.
    await filter.click();
    await page.getByRole('option', { name: COPY.allRoles, exact: true }).click();
    await expect(memberRows(page)).toHaveCount(members.length);

    // --- Adjacent regression: search and filter combine with AND ----------
    // The role stays "Student" while the search names the teacher: no row matches.
    await filter.click();
    await page.getByRole('option', { name: ROLE_LABEL.member, exact: true }).click();
    await search.fill(teacher.email);
    await expect(memberRows(page), 'a teacher cannot match the Student filter').toHaveCount(0);

    // Clearing the search restores the filtered list (the filter did not reset).
    await search.fill('');
    await expect(memberRows(page)).toHaveCount(2);
    await expect(rowFor(page, student.email)).toHaveCount(1);

    await filter.click();
    await page.getByRole('option', { name: COPY.allRoles, exact: true }).click();
    await expect(memberRows(page)).toHaveCount(members.length);

    expect(pageErrors, 'uncaught page errors on the members page').toEqual([]);
  });
});
