import { expect, test, type Browser, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-MEM-05 — managing a member's group membership from the members table.
 *
 * Tenant: the `content` profile of this case (`__tests__/qa/profiles/MGR-MEM-05.json`),
 * seeded before the suite starts by `bun scripts/qa-tenant.ts MGR-MEM-05 --fresh`.
 * It gives one organization with its `admin` manager, a teacher, a student and the
 * default group `G1`, all derived from `tenantKey('qa/cases/MGR-MEM-05.md', …)` +
 * `tenantId(key, entity)`, so an independent run gets a brand-new organization and
 * nothing leaks between runs. The legacy manual seed (`manager@dev.local`, `pass`)
 * is never used.
 *
 * The case's group shape is built inside that tenant through the product's own API
 * in `beforeAll`, never by a runtime seeder:
 *
 * 1. the seeded default group is renamed to the case's `O1G1`;
 * 2. the manager creates the second group `O1G2`;
 * 3. the rosters are set to the case's starting state — `O1G1` holds the manager
 *    (teacher), the teacher and the student (members); `O1G2` starts with the
 *    manager as its teacher only (sharing group content requires teaching it);
 * 4. the manager creates one group-visible deck per group (`O1G1 deck`,
 *    `O1G2 deck`), so the student's membership has an observable effect on the
 *    content they see.
 *
 * Every step is idempotent (the group is renamed/adopted and the decks are reused
 * by name), so a CI retry against the same seeded tenant starts from the same
 * state instead of growing the org.
 *
 * The case's acceptance points, confirmed on the shared app during the walk:
 * 1. „Zarządzaj grupami” opens the dialog „Zarządzaj grupami: <member>” with one
 *    checkbox per organization group; checking a group reveals its role select
 *    („Nauczyciel” / „Członek”).
 * 2. Saving the move (`O1G1` unchecked, `O1G2` checked as „Nauczyciel”) shows the
 *    toast „Przynależność do grup zaktualizowana” and the row's „Grupy” column
 *    lists only the new group.
 * 3. The change is real and scoped: the API reports the student as a `teacher` of
 *    `O1G2` and no longer in `O1G1`, the group counters move accordingly, other
 *    members keep their groups, and the student's deck list switches from the
 *    `O1G1` deck to the `O1G2` deck.
 *
 * Nothing global is written: no admin setting, feature flag, plan, platform stat
 * or singleton row.
 */

const CASE = 'MGR-MEM-05';
const TENANT: QaTenant = loadTenant(CASE);

const GROUP1 = 'O1G1';
const GROUP2 = 'O1G2';
const DECK1_NAME = 'O1G1 deck';
const DECK2_NAME = 'O1G2 deck';

interface CaseAccount {
  id: string;
  email: string;
  password: string;
}

interface MemberGroup {
  id: string;
  name: string;
  role: 'teacher' | 'member';
}

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  groups: MemberGroup[];
}

interface OrgGroup {
  id: string;
  name: string;
  memberCount: number;
  teacherCount: number;
}

interface NamedRow {
  id: string;
  name: string;
}

interface CaseTenant {
  org: { id: string; name: string };
  manager: CaseAccount;
  teacher: CaseAccount;
  student: CaseAccount;
  group1: NamedRow;
  group2: NamedRow;
  deck1: NamedRow;
  deck2: NamedRow;
}

function account(tenant: QaTenant, role: QaRole): CaseAccount {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user;
}

/**
 * A signed-in API session for one seeded account, pinned to the tenant's org. The
 * app only writes `active_org_id` when an org is created or switched, so a seeded
 * membership needs the cookie set here — otherwise `withAuth` scopes the request
 * to no org and the setup rows land outside the tenant.
 */
async function apiSession(
  browser: Browser,
  baseURL: string,
  role: QaRole,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const orgId = TENANT.org?.id;
  if (!orgId) throw new Error(`tenant ${CASE} needs the content profile (org + manager)`);
  const user = account(TENANT, role);
  const { hostname } = new URL(baseURL);
  const context = await browser.newContext({ baseURL });
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: orgId, domain: hostname, path: '/', httpOnly: true },
  ]);
  const page = await context.newPage();
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  expect(response.status(), `login ${role} (${user.email})`).toBe(200);
  return { page, close: () => context.close() };
}

async function apiData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data;
}

/** Rename an existing group (the groups page's own `PUT`). */
async function renameGroup(page: Page, groupId: string, name: string): Promise<void> {
  const response = await page.request.put(`/api/v1/organization/groups/${groupId}`, {
    data: { name },
  });
  expect(
    response.status(),
    `PUT /api/v1/organization/groups/${groupId} → ${response.status()} ${await response.text()}`,
  ).toBe(200);
}

/**
 * The case's second group. It is created once per tenant and reused by name, so a
 * retry (CI seeds one tenant and retries against it) never grows the org past its
 * plan's group limit. `/api/v1/organization/groups` only lists teacher-led groups,
 * which both groups are after `prepareCaseTenant` sets their rosters.
 */
async function ensureGroup(page: Page, name: string): Promise<NamedRow> {
  const groups = await apiData<NamedRow[]>(page, '/api/v1/organization/groups');
  const existing = groups.find((group) => group.name === name);
  if (existing) return existing;

  const created = await page.request.post('/api/v1/organization/groups', { data: { name } });
  expect(
    created.status(),
    `POST /api/v1/organization/groups (${name}) → ${created.status()} ${await created.text()}`,
  ).toBe(201);
  const body = (await created.json()) as { success: boolean; data: NamedRow };
  return body.data;
}

/** Replace a group's roster (the group page's own `PUT`, `role: teacher | member`). */
async function setGroupMembers(
  page: Page,
  groupId: string,
  members: Array<{ userId: string; role: 'teacher' | 'member' }>,
): Promise<void> {
  const response = await page.request.put(`/api/v1/organization/groups/${groupId}/members`, {
    data: { members },
  });
  expect(
    response.status(),
    `PUT /api/v1/organization/groups/${groupId}/members → ${response.status()} ${await response.text()}`,
  ).toBe(200);
}

/** A group-visible deck of this tenant, created once and reused by later runs. */
async function ensureDeck(page: Page, name: string, groupId: string): Promise<NamedRow> {
  const list = await apiData<{ items: NamedRow[] }>(page, '/api/v1/flashcards/decks?limit=100');
  const existing = list.items.find((deck) => deck.name === name);
  if (existing) return existing;

  const created = await page.request.post('/api/v1/flashcards/decks', {
    data: { name, visibility: 'group', groupIds: [groupId] },
  });
  expect(
    created.status(),
    `POST /api/v1/flashcards/decks (${name}) → ${created.status()} ${await created.text()}`,
  ).toBe(201);
  const body = (await created.json()) as { success: boolean; data: NamedRow };
  return body.data;
}

/**
 * Build the case's tenant shape inside the seeded organization: `O1G1` (the
 * renamed default group) with the manager as its teacher, the teacher and the
 * student as members; `O1G2` with the manager as its teacher only; one
 * group-visible deck per group. The rosters are set on every run, so a retry
 * starts from the case's starting state even after a previous run moved the
 * student.
 */
async function prepareCaseTenant(browser: Browser, baseURL: string): Promise<CaseTenant> {
  const org = TENANT.org;
  const defaultGroupId = TENANT.group?.id;
  if (!org || !defaultGroupId) {
    throw new Error(`tenant ${CASE} needs the content profile (org + default group)`);
  }
  const manager = account(TENANT, 'manager');
  const teacher = account(TENANT, 'teacher');
  const student = account(TENANT, 'student');

  const session = await apiSession(browser, baseURL, 'manager');
  try {
    const { page } = session;
    // 1–2. The case's two groups: the default `G1` becomes `O1G1`, `O1G2` is added.
    await renameGroup(page, defaultGroupId, GROUP1);
    const group2 = await ensureGroup(page, GROUP2);
    const group1: NamedRow = { id: defaultGroupId, name: GROUP1 };

    // 3. The case's starting rosters: the student in `O1G1` as a member, `O1G2`
    //    with the manager as its only (teacher) member, who may share content to it.
    await setGroupMembers(page, group1.id, [
      { userId: manager.id, role: 'teacher' },
      { userId: teacher.id, role: 'member' },
      { userId: student.id, role: 'member' },
    ]);
    await setGroupMembers(page, group2.id, [{ userId: manager.id, role: 'teacher' }]);

    // 4. One group-visible deck per group, so the move changes what the student sees.
    const deck1 = await ensureDeck(page, DECK1_NAME, group1.id);
    const deck2 = await ensureDeck(page, DECK2_NAME, group2.id);

    return {
      org,
      manager,
      teacher,
      student,
      group1,
      group2: { id: group2.id, name: group2.name },
      deck1,
      deck2,
    };
  } finally {
    await session.close();
  }
}

/** A separate student session, so the manager's cookies are never replaced. */
async function loginAsStudent(browser: Browser, baseURL: string): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await loginAs(page, TENANT, 'student', { locale: 'pl', waitFor: /\/app$/ });
  return page;
}

function listMembers(page: Page): Promise<OrgMember[]> {
  return apiData<OrgMember[]>(page, '/api/v1/organization/members');
}

function listGroups(page: Page): Promise<OrgGroup[]> {
  return apiData<OrgGroup[]>(page, '/api/v1/organization/groups');
}

async function groupMemberRoles(
  page: Page,
  groupId: string,
): Promise<Array<{ userId: string; role: string }>> {
  return apiData<Array<{ userId: string; role: string }>>(
    page,
    `/api/v1/organization/groups/${groupId}/members`,
  );
}

async function deckNames(page: Page): Promise<string[]> {
  const body = await apiData<{ items: Array<{ name: string }> }>(
    page,
    '/api/v1/flashcards/decks?limit=100',
  );
  return body.items.map((deck) => deck.name).sort();
}

/** The table row for one member, anchored on the unique seeded e-mail. */
function memberRow(page: Page, email: string) {
  return page.getByRole('row').filter({ has: page.getByText(email, { exact: true }) });
}

/** One group line inside the „Zarządzaj grupami” dialog: checkbox + label + role select. */
function dialogGroup(dialog: ReturnType<Page['getByRole']>, name: string) {
  return dialog.getByText(name, { exact: true }).locator('xpath=..');
}

/** A deck card heading; the card renders once per breakpoint, so only visible ones count. */
function deckHeading(page: Page, name: string) {
  return page.getByRole('heading', { name, exact: true }).filter({ visible: true });
}

test.describe('@case:MGR-MEM-05 @area:MGR @prio:P2 member group membership management', () => {
  let tenant: CaseTenant;

  test.beforeAll(async ({ browser, baseURL }) => {
    tenant = await prepareCaseTenant(browser, baseURL ?? 'http://localhost:3010');
    console.log(`MGR-MEM-05 tenant key: ${TENANT.key} (org ${tenant.org.id})`);
    console.log(`MGR-MEM-05 group ${GROUP1}: ${tenant.group1.id}`);
    console.log(`MGR-MEM-05 group ${GROUP2}: ${tenant.group2.id}`);
  });

  test('moves a student between groups and the student sees the new group content', async ({
    page,
    browser,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';

    // --- Before: the student belongs to O1G1 and sees only its deck ---------
    const studentPage = await loginAsStudent(browser, origin);
    try {
      await studentPage.goto('/app/flashcards');
      await expect(deckHeading(studentPage, tenant.deck1.name)).toBeVisible();
      await expect(deckHeading(studentPage, tenant.deck2.name)).toHaveCount(0);
      expect(await deckNames(studentPage), 'student deck list before the move').toEqual([
        tenant.deck1.name,
      ]);

      // --- Step 1: open „Zarządzaj grupami” for the student -----------------
      await loginAs(page, TENANT, 'manager', { locale: 'pl', waitFor: /\/manage$/ });
      // Enter the page the way a user does (dashboard → sidebar), so the active
      // organization settles before the org-scoped list requests.
      await page.goto('/manage');
      await expect(page).toHaveURL(/\/manage$/);
      await page.locator('a[href="/manage/members"]').first().click();
      await expect(page).toHaveURL(/\/manage\/members$/);
      await expect(page.getByRole('heading', { name: 'Członkowie', exact: true })).toBeVisible();

      const row = memberRow(page, tenant.student.email);
      await expect(row).toBeVisible();
      await expect(row.getByRole('cell').nth(2), 'groups before the move').toContainText(GROUP1);
      await expect(row.getByRole('cell').nth(2), 'groups before the move').not.toContainText(
        GROUP2,
      );

      await row.getByRole('button', { name: 'Zarządzaj grupami' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText('Zarządzaj grupami: QA student', { exact: true }),
      ).toBeVisible();

      const group1 = dialogGroup(dialog, GROUP1);
      const group2 = dialogGroup(dialog, GROUP2);
      await expect(group1.getByRole('checkbox'), `${GROUP1} is checked`).toBeChecked();
      await expect(group2.getByRole('checkbox'), `${GROUP2} is unchecked`).not.toBeChecked();
      await expect(group1.getByRole('combobox'), `${GROUP1} role`).toHaveText('Członek');

      // --- Step 2: check O1G2, pick the teacher role, uncheck O1G1, save ---
      await group2.getByRole('checkbox').click();
      await expect(group2.getByRole('checkbox')).toBeChecked();
      await group2.getByRole('combobox').click();
      await expect(page.getByRole('option')).toHaveCount(2);
      await expect(page.getByRole('option', { name: 'Członek' })).toBeVisible();
      await page.getByRole('option', { name: 'Nauczyciel' }).click();
      await expect(group2.getByRole('combobox'), `${GROUP2} role`).toHaveText('Nauczyciel');

      await group1.getByRole('checkbox').click();
      await expect(group1.getByRole('checkbox')).not.toBeChecked();
      await expect(group1.getByRole('combobox'), `${GROUP1} role select is gone`).toHaveCount(0);

      await dialog.getByRole('button', { name: 'Zapisz' }).click();
      await expect(
        page.getByText('Przynależność do grup zaktualizowana', { exact: true }),
      ).toBeVisible();
      await expect(dialog).toBeHidden();

      // The row now lists only the new group.
      await expect(row.getByRole('cell').nth(2), 'groups after the move').toContainText(GROUP2);
      await expect(row.getByRole('cell').nth(2), 'groups after the move').not.toContainText(GROUP1);

      // Reopening proves the saved state: O1G2 checked as „Nauczyciel”, O1G1 off.
      await row.getByRole('button', { name: 'Zarządzaj grupami' }).click();
      const reopened = page.getByRole('dialog');
      await expect(reopened).toBeVisible();
      await expect(dialogGroup(reopened, GROUP2).getByRole('checkbox')).toBeChecked();
      await expect(dialogGroup(reopened, GROUP2).getByRole('combobox')).toHaveText('Nauczyciel');
      await expect(dialogGroup(reopened, GROUP1).getByRole('checkbox')).not.toBeChecked();
      await reopened.getByRole('button', { name: 'Anuluj' }).click();
      await expect(reopened).toBeHidden();

      // --- The server state matches, and only the student moved -------------
      const members = await listMembers(page);
      const student = members.find((member) => member.email === tenant.student.email);
      if (!student) throw new Error('the seeded student is missing from /organization/members');
      expect(student.groups, 'student groups after the move').toEqual([
        { id: tenant.group2.id, name: GROUP2, role: 'teacher' },
      ]);

      const group1Roles = await groupMemberRoles(page, tenant.group1.id);
      expect(
        group1Roles.some((member) => member.userId === tenant.student.id),
        'student is out of O1G1',
      ).toBe(false);
      expect(
        group1Roles.find((member) => member.userId === tenant.manager.id)?.role,
        'the manager still teaches O1G1',
      ).toBe('teacher');
      expect(
        group1Roles.find((member) => member.userId === tenant.teacher.id)?.role,
        'the other member keeps the O1G1 membership',
      ).toBe('member');

      const group2Roles = await groupMemberRoles(page, tenant.group2.id);
      expect(
        group2Roles.find((member) => member.userId === tenant.student.id)?.role,
        'student is a teacher in O1G2',
      ).toBe('teacher');

      const groups = await listGroups(page);
      const group1Counts = groups.find((group) => group.id === tenant.group1.id);
      const group2Counts = groups.find((group) => group.id === tenant.group2.id);
      expect(group1Counts, 'O1G1 counts after the move').toMatchObject({
        memberCount: 2,
        teacherCount: 1,
      });
      expect(group2Counts, 'O1G2 counts after the move').toMatchObject({
        memberCount: 2,
        teacherCount: 2,
      });

      // The other members' „Grupy” cells did not change as a side effect.
      const managerCell = memberRow(page, tenant.manager.email).getByRole('cell').nth(2);
      await expect(managerCell).toContainText(GROUP1);
      await expect(managerCell).toContainText(GROUP2);
      const teacherCell = memberRow(page, tenant.teacher.email).getByRole('cell').nth(2);
      await expect(teacherCell).toContainText(GROUP1);
      await expect(teacherCell).not.toContainText(GROUP2);

      // --- Step 3: the student now sees the O1G2 content, not O1G1 ---------
      expect(await deckNames(studentPage), 'student deck list after the move').toEqual([
        tenant.deck2.name,
      ]);
      await studentPage.goto('/app/flashcards');
      await expect(deckHeading(studentPage, tenant.deck2.name)).toBeVisible();
      await expect(deckHeading(studentPage, tenant.deck1.name)).toHaveCount(0);
    } finally {
      await studentPage.context().close();
    }

    expect(pageErrors, 'uncaught page errors during the membership change').toEqual([]);
  });
});
