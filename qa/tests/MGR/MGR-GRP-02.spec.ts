import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * MGR-GRP-02 — member assignment in the manager's group table (`/manage/groups`).
 *
 * Case step: "Kliknij „Zarządzaj członkami”, wybierz S1 i T2, zapisz."
 * Expected: the toast „Skład grupy zaktualizowany” and a table row whose member
 * and teacher counters match the group's new roster.
 *
 * Tenant (deterministic, one per run):
 *
 *   bun scripts/qa-tenant.ts MGR-GRP-02 --profile org-limit --fresh
 *
 * The legacy case names its people M1/S1/T2; in the tenant model they are
 * `users.manager`, `users.student` and `users.teacher2`. The `org-limit` profile
 * is the one seeded shape that has a *second* teacher with the real org `teacher`
 * role, so "T2" maps 1:1 and the org has two teachers while the new group gets
 * exactly one. The spec creates the case's „Grupa C” through the group API and
 * starts it with no members; every other org/group/user id comes from the tenant
 * fixture. Nothing global (admin settings, feature flags, plans, platform stats,
 * singleton rows) is read or written.
 */

const CASE = 'MGR-GRP-02';

/** Polish copy from `ManageGroupsPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  membersColumn: 'Członkowie',
  teachersColumn: 'Nauczyciele',
  manageMembers: 'Zarządzaj członkami',
  memberRoles: 'Role w grupie',
  roleTeacher: 'Nauczyciel',
  roleMember: 'Członek',
  save: 'Zapisz',
  membersUpdated: 'Skład grupy zaktualizowany',
} as const;

const GROUP_NAME = 'Grupa C';
const GROUP_DESCRIPTION = 'Grupa testowa QA';
const GROUPS_URL = '/api/v1/organization/groups';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  memberCount: number;
  teacherCount: number;
  canManage: boolean;
}

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
}

/** Row shape of `GET /api/v1/organization/groups/:id/addable-members`. */
interface AddableMember {
  id: string;
  email: string;
  fullName: string | null;
  orgRoleName: string;
}

/** Row shape of `GET /api/v1/organization/groups/:id/members`. */
interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success`).toBe(true);
  return body.data;
}

/** The table row whose name cell is exactly `name` (description may follow it). */
function groupRow(page: Page, name: string): Locator {
  return page.locator('table tbody tr').filter({ has: page.getByText(name, { exact: true }) });
}

/**
 * The case's prerequisite is an existing „Grupa C”. Reuse it when present and
 * normalise it to an empty roster, so the run starts from the state step 1
 * expects instead of depending on a previous run of the spec.
 */
async function ensureEmptyGroup(page: Page, name: string): Promise<GroupSummary> {
  const groups = await getJson<GroupSummary[]>(page, GROUPS_URL);
  let group = groups.find((candidate) => candidate.name === name);

  if (!group) {
    const res = await page.request.post(GROUPS_URL, {
      data: { name, description: GROUP_DESCRIPTION },
    });
    expect(res.status(), `POST ${GROUPS_URL}`).toBe(201);
    const body = (await res.json()) as ApiEnvelope<
      Omit<GroupSummary, 'memberCount' | 'teacherCount' | 'canManage'>
    >;
    expect(body.success, `POST ${GROUPS_URL} success`).toBe(true);
    group = { ...body.data, memberCount: 0, teacherCount: 0, canManage: true };
  }

  const roster = await getJson<GroupMemberRow[]>(page, `${GROUPS_URL}/${group.id}/members`);
  if (roster.length > 0) {
    const reset = await page.request.put(`${GROUPS_URL}/${group.id}/members`, {
      data: { members: [] },
    });
    expect(reset.ok(), `PUT ${GROUPS_URL}/${group.id}/members (reset)`).toBe(true);
  }

  return group;
}

/** The label the `MultiSelect` shows for an addable member (`toGroupMemberOptions`). */
function optionLabel(member: AddableMember): string {
  return member.fullName ? `${member.fullName} (${member.email})` : member.email;
}

test('assigns a student and a teacher to Grupa C and shows the group’s own counts', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');

  const teacher = tenant.users.teacher2;
  const student = tenant.users.student;
  const defaultGroup = tenant.group;
  expect(teacher, `${CASE} needs the seeded T2 account`).toBeTruthy();
  expect(student, `${CASE} needs the seeded S1 account`).toBeTruthy();
  expect(defaultGroup, `${CASE} needs the seeded org and its default group`).toBeTruthy();

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

  // --- Premise: the org has a second teacher and a member to assign --------
  // The group-role default is derived from the org role, so S1 must be a
  // member and T2 a teacher — otherwise the teacher counter cannot move.
  const orgMembers = await getJson<OrgMember[]>(page, '/api/v1/organization/members');
  const t2 = orgMembers.find((member) => member.email === teacher!.email);
  const s1 = orgMembers.find((member) => member.email === student!.email);
  expect(t2?.orgRoleName, 'T2 holds the org teacher role').toBe('teacher');
  expect(s1?.orgRoleName, 'S1 holds the org member role').toBe('member');

  // --- Prerequisite: „Grupa C” exists and starts empty ---------------------
  const group = await ensureEmptyGroup(page, GROUP_NAME);
  const before = await getJson<GroupSummary[]>(page, GROUPS_URL);
  const groupBefore = before.find((candidate) => candidate.id === group.id);
  expect(groupBefore?.memberCount, 'Grupa C starts with no members').toBe(0);
  expect(groupBefore?.teacherCount, 'Grupa C starts with no teachers').toBe(0);

  // The default group the tenant was seeded with is the isolation control:
  // saving Grupa C must not touch any other group's roster.
  const otherGroupBefore = before.find((candidate) => candidate.id === defaultGroup!.id);
  expect(otherGroupBefore, `${defaultGroup!.name} is listed`).toBeTruthy();

  // Both people are offered by the same endpoint the dialog uses.
  const addable = await getJson<AddableMember[]>(page, `${GROUPS_URL}/${group.id}/addable-members`);
  const teacherOption = addable.find((member) => member.id === teacher!.id);
  const studentOption = addable.find((member) => member.id === student!.id);
  expect(teacherOption?.orgRoleName, 'T2 is offered as an org teacher').toBe('teacher');
  expect(studentOption?.orgRoleName, 'S1 is offered as an org member').toBe('member');

  // The case selects one student and one teacher: 2 members, 1 of them teacher.
  const roster = [
    { member: teacherOption!, groupRole: 'teacher' as const },
    { member: studentOption!, groupRole: 'member' as const },
  ];
  const expectedCounts = {
    members: roster.length,
    teachers: roster.filter((entry) => entry.groupRole === 'teacher').length,
  };
  expect(expectedCounts, 'the case expects two members, one of them a teacher').toEqual({
    members: 2,
    teachers: 1,
  });

  // --- Step 0: /manage/groups lists the case's group empty -----------------
  await page.goto('/manage/groups');
  await expect(page).toHaveURL(/\/manage\/groups$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  await expect(page.getByRole('columnheader', { name: COPY.membersColumn })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: COPY.teachersColumn })).toBeVisible();

  const row = groupRow(page, GROUP_NAME);
  await expect(row, 'Grupa C is in the table').toHaveCount(1);
  await expect(row.locator('td').nth(1), 'Grupa C member count before the save').toHaveText('0');
  await expect(row.locator('td').nth(2), 'Grupa C teacher count before the save').toHaveText('0');

  const otherRow = groupRow(page, defaultGroup!.name);
  await expect(otherRow.locator('td').nth(1), 'untouched group member count').toHaveText(
    String(otherGroupBefore!.memberCount),
  );
  await expect(otherRow.locator('td').nth(2), 'untouched group teacher count').toHaveText(
    String(otherGroupBefore!.teacherCount),
  );

  // --- Step 1: „Zarządzaj członkami”, pick S1 and T2, save -----------------
  await row.getByRole('button', { name: COPY.manageMembers, exact: true }).click();

  const dialog = page.getByRole('dialog', { name: COPY.manageMembers });
  await expect(dialog).toBeVisible();

  const combobox = dialog.getByRole('combobox').first();
  await expect(combobox).toBeVisible();
  await combobox.click();

  for (const entry of roster) {
    const label = optionLabel(entry.member);
    await page.getByRole('option', { name: label, exact: true }).click();
  }

  // The default group role follows the org role (T2 → Nauczyciel, S1 → Członek);
  // this is what makes the teacher counter 1 after the save.
  for (const entry of roster) {
    const label = optionLabel(entry.member);
    const roleSelect = dialog.getByRole('combobox', { name: `${label}: ${COPY.memberRoles}` });
    await expect(roleSelect, `group role for ${label}`).toHaveText(
      entry.groupRole === 'teacher' ? COPY.roleTeacher : COPY.roleMember,
    );
  }

  // The multi-select stays open after picking; close it so the click lands on
  // the dialog's own Save button.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option')).toHaveCount(0);

  await dialog.getByRole('button', { name: COPY.save, exact: true }).click();

  // --- Expected result: toast + counters match the new roster --------------
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: COPY.membersUpdated }),
    'success toast',
  ).toBeVisible();
  await expect(dialog, 'the dialog closes after saving').toHaveCount(0);

  const updatedRow = groupRow(page, GROUP_NAME);
  await expect(updatedRow.locator('td').nth(1), 'Grupa C member count').toHaveText(
    String(expectedCounts.members),
  );
  await expect(updatedRow.locator('td').nth(2), 'Grupa C teacher count').toHaveText(
    String(expectedCounts.teachers),
  );

  // Regression: replacing one group's roster leaves the other group untouched.
  await expect(otherRow.locator('td').nth(1), 'untouched group member count').toHaveText(
    String(otherGroupBefore!.memberCount),
  );
  await expect(otherRow.locator('td').nth(2), 'untouched group teacher count').toHaveText(
    String(otherGroupBefore!.teacherCount),
  );

  // The counters come from persisted state, not from a stale optimistic list.
  await page.reload();
  await expect(page).toHaveURL(/\/manage\/groups$/, { timeout: 20_000 });
  const reloadedRow = groupRow(page, GROUP_NAME);
  await expect(reloadedRow.locator('td').nth(1), 'persisted member count').toHaveText(
    String(expectedCounts.members),
  );
  await expect(reloadedRow.locator('td').nth(2), 'persisted teacher count').toHaveText(
    String(expectedCounts.teachers),
  );

  // --- API cross-check: exactly the two selected people, with their roles --
  const after = await getJson<GroupSummary[]>(page, GROUPS_URL);
  const groupAfter = after.find((candidate) => candidate.id === group.id);
  expect(groupAfter?.memberCount, 'API member count').toBe(expectedCounts.members);
  expect(groupAfter?.teacherCount, 'API teacher count').toBe(expectedCounts.teachers);

  const rosterAfter = await getJson<GroupMemberRow[]>(page, `${GROUPS_URL}/${group.id}/members`);
  expect(rosterAfter, 'the saved roster').toHaveLength(2);
  expect(rosterAfter).toEqual(
    expect.arrayContaining([
      { userId: teacher!.id, role: 'teacher' },
      { userId: student!.id, role: 'member' },
    ]),
  );

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
