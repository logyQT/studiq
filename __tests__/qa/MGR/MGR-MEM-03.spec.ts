import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-MEM-03 — the last admin cannot demote themselves or leave the organization.
 *
 * Prerequisite (reconciled with the tenant seeder): a manager who is the **only**
 * `admin` of one organization, plus one teacher and one member so the page has
 * other rows to contrast against. The legacy manual seed (`manager@dev.local`,
 * password `pass`) is never used.
 *
 * Tenant: the `content` profile of this case (`__tests__/qa/profiles/MGR-MEM-03.json`),
 * seeded **once, before Playwright starts**, by
 *
 *   bun scripts/qa-tenant.ts MGR-MEM-03 --fresh
 *
 * It is exactly the case's shape — one organization with its `admin` manager, a
 * teacher (org role `teacher`) and a student (org role `member`), plus the default
 * group `G1`. Every org/user/role id derives from
 * `tenantKey('qa/cases/MGR-MEM-03.md', …)` + `tenantId(key, entity)`, so an
 * independent run gets a brand-new organization, admin and members, and nothing
 * leaks between runs. The spec seeds nothing itself.
 *
 * The case's own state changes go through the product's API, like the rest of the
 * suite: the adjacent regression demotes the teacher and removes the student, so
 * `prepareTenant` puts the tenant back to its starting roster (role change through
 * `PUT /api/v1/organization/members`, a removed member re-added through the
 * product's invite → accept flow) before every run. That keeps a CI retry
 * (`--retries`) or a repeated run (`--repeat-each`) on the same seeded tenant at
 * the same starting state instead of a half-mutated organization.
 *
 * Acceptance points:
 * 1. On `/manage/members` the admin's own row renders no role select and no
 *    "remove member" control (only the „(ty)” self marker), so the UI blocks
 *    step 1 and step 2 before any request is made.
 * 2. The same two actions issued directly against the API the page calls —
 *    `PUT /api/v1/organization/members` for the own role,
 *    `DELETE /api/v1/organization/members?userId=<self>` — are rejected with
 *    `403 FORBIDDEN`.
 * 3. The organization is left intact: the caller is still its `admin`, the org
 *    still has exactly one admin, and no membership disappeared.
 * 4. Adjacent regression: the guard is self-scoped, not a blanket denial — the
 *    same admin can still change another member's role and remove another
 *    member through those endpoints.
 */

const CASE = 'MGR-MEM-03';
const TENANT: QaTenant = loadTenant(CASE);

const MEMBERS_API = '/api/v1/organization/members';
const ROLES_API = '/api/v1/organization/roles';
const INVITES_API = '/api/v1/organization/invites';

interface CaseAccount {
  id: string;
  email: string;
  password: string;
}

interface OrgRole {
  id: string;
  name: string;
}

interface OrgMember {
  id: string;
  email: string;
  orgRoleId: string;
  orgRoleName: string;
}

interface CaseTenant {
  roles: { admin: string; teacher: string; member: string };
  manager: CaseAccount;
  teacher: CaseAccount;
  student: CaseAccount;
}

function account(role: QaRole): CaseAccount {
  const user = TENANT.users[role];
  if (!user) throw new Error(`tenant ${CASE} has no seeded ${role} user`);
  return user;
}

async function apiData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data;
}

function roleId(roles: OrgRole[], name: string): string {
  const role = roles.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`tenant ${CASE} has no org role "${name}"`);
  return role.id;
}

/** The members page's own role change (`PUT /api/v1/organization/members`). */
async function changeRole(
  page: Page,
  userId: string,
  newOrgRoleId: string,
  label: string,
): Promise<void> {
  const response = await page.request.put(MEMBERS_API, {
    data: { targetUserId: userId, newOrgRoleId },
  });
  expect(response.status(), `${label} → ${response.status()} ${await response.text()}`).toBe(200);
}

/**
 * Re-add a member the previous run removed (acceptance point 4). The product has
 * no "add member" endpoint — membership starts with an invitation, so the manager
 * invites the seeded account's address and that account accepts, exactly like
 * `/manage/invites` → `/app/join`.
 */
async function rejoinAsStudent(
  page: Page,
  student: CaseAccount,
  memberRoleId: string,
): Promise<void> {
  const invite = await page.request.post(INVITES_API, {
    data: { email: student.email, targetOrgRoleId: memberRoleId },
  });
  expect(
    invite.status(),
    `POST ${INVITES_API} (${student.email}) → ${invite.status()} ${await invite.text()}`,
  ).toBe(201);
  const { data } = (await invite.json()) as { data: { inviteCode: string } };
  const { inviteCode } = data;

  await loginAs(page, TENANT, 'student', { locale: 'pl', waitFor: /\/app$/ });
  const accepted = await page.request.post(`${INVITES_API}/accept`, {
    data: { token: inviteCode },
  });
  expect(
    accepted.status(),
    `POST ${INVITES_API}/accept → ${accepted.status()} ${await accepted.text()}`,
  ).toBe(200);
}

/**
 * Put the seeded tenant back to the case's starting roster and return the ids the
 * assertions need. Role ids come from `GET /api/v1/organization/roles` — the same
 * endpoint the members page uses — instead of hard-coding a per-run uuid.
 */
async function prepareTenant(page: Page): Promise<CaseTenant> {
  const manager = account('manager');
  const teacher = account('teacher');
  const student = account('student');

  await loginAs(page, TENANT, 'manager', {
    locale: 'pl',
    waitFor: /\/manage$/,
  });

  const roles = await apiData<OrgRole[]>(page, ROLES_API);
  const ids = {
    admin: roleId(roles, 'admin'),
    teacher: roleId(roles, 'teacher'),
    member: roleId(roles, 'member'),
  };

  const members = await apiData<OrgMember[]>(page, MEMBERS_API);
  const teacherRow = members.find((member) => member.email === teacher.email);
  if (!teacherRow) {
    throw new Error(`the seeded teacher ${teacher.email} is not in the tenant's organization`);
  }
  if (teacherRow.orgRoleId !== ids.teacher) {
    await changeRole(page, teacher.id, ids.teacher, 'restore the teacher role');
  }

  const studentRow = members.find((member) => member.email === student.email);
  if (!studentRow) {
    await rejoinAsStudent(page, student, ids.member);
    await loginAs(page, TENANT, 'manager', {
      locale: 'pl',
      waitFor: /\/manage$/,
    });
  } else if (studentRow.orgRoleId !== ids.member) {
    await changeRole(page, student.id, ids.member, 'restore the student role');
  }

  const restored = await apiData<OrgMember[]>(page, MEMBERS_API);
  expect(
    restored.map((member) => member.email).sort(),
    'the case starts with exactly its three seeded members',
  ).toEqual([manager.email, teacher.email, student.email].sort());

  return { roles: ids, manager, teacher, student };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('@case:MGR-MEM-03 @area:MGR @prio:P1 self role change and self removal', () => {
  test('the only admin cannot demote or remove themselves', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant = await prepareTenant(page);

    // Enter the page the way a manager does: dashboard → „Członkowie” in the sidebar.
    await page.locator('a[href="/manage/members"]').first().click();
    await expect(page).toHaveURL(/\/manage\/members$/);
    await expect(page.getByRole('heading', { name: 'Członkowie', exact: true })).toBeVisible();

    const ownRow = page.getByRole('row', {
      name: new RegExp(escapeRegExp(tenant.manager.email)),
    });
    const teacherRow = page.getByRole('row', {
      name: new RegExp(escapeRegExp(tenant.teacher.email)),
    });
    const studentRow = page.getByRole('row', {
      name: new RegExp(escapeRegExp(tenant.student.email)),
    });

    // Prerequisite: the caller is the only admin; the other two rows are not admins.
    await expect(page.locator('table tbody tr')).toHaveCount(3);
    await expect(ownRow.getByTestId('member-role')).toHaveText('Admin');
    await expect(teacherRow.getByTestId('member-role')).toHaveText('Teacher');
    await expect(studentRow.getByTestId('member-role')).toHaveText('Student');

    // Other members render the role select and the remove control, so their absence
    // on the own row below is specific to self — not a missing control set.
    await expect(teacherRow.getByRole('combobox')).toHaveCount(1);
    await expect(teacherRow.getByRole('button', { name: /Usuń członka/ })).toHaveCount(1);

    // 1 + 2 in the UI: the own row exposes no way to change the role and no way to
    // leave the organization; it carries the self marker instead.
    await expect(ownRow).toContainText('(ty)');
    await expect(ownRow.getByRole('combobox')).toHaveCount(0);
    await expect(ownRow.getByRole('button', { name: /Usuń członka/ })).toHaveCount(0);
    await expect(ownRow.getByRole('button', { name: /Zarządzaj grupami/ })).toHaveCount(0);

    // 1. The request behind a self-demotion is rejected, not silently applied.
    const demote = await page.request.put(MEMBERS_API, {
      data: {
        targetUserId: tenant.manager.id,
        newOrgRoleId: tenant.roles.member,
      },
    });
    expect(demote.status(), 'PUT /api/v1/organization/members (self → member)').toBe(403);
    expect(await demote.json()).toMatchObject({
      success: false,
      error: 'FORBIDDEN',
    });

    // 2. Same for removing oneself from the organization.
    const removeSelf = await page.request.delete(MEMBERS_API, {
      params: { userId: tenant.manager.id },
    });
    expect(removeSelf.status(), 'DELETE /api/v1/organization/members?userId=<self>').toBe(403);
    expect(await removeSelf.json()).toMatchObject({
      success: false,
      error: 'FORBIDDEN',
    });

    // 3. The organization still has its admin and all of its members.
    const afterAttempts = await page.request.get(MEMBERS_API);
    expect(afterAttempts.status(), `GET ${MEMBERS_API}`).toBe(200);
    const afterBody = (await afterAttempts.json()) as {
      success: boolean;
      data: OrgMember[];
    };
    expect(afterBody.success).toBe(true);
    expect(afterBody.data).toHaveLength(3);
    const selfAfter = afterBody.data.find((member) => member.id === tenant.manager.id);
    expect(selfAfter, 'the caller is still an organization member').toBeDefined();
    expect(selfAfter?.orgRoleName).toBe('admin');
    expect(selfAfter?.orgRoleId).toBe(tenant.roles.admin);
    expect(
      afterBody.data.filter((member) => member.orgRoleName === 'admin').length,
      'the organization still has exactly one admin',
    ).toBe(1);

    // The page reflects the unchanged state after a reload (nothing was applied
    // optimistically and then reverted).
    await page.reload();
    const ownRowAfterReload = page.getByRole('row', {
      name: new RegExp(escapeRegExp(tenant.manager.email)),
    });
    await expect(ownRowAfterReload.getByTestId('member-role')).toHaveText('Admin');
    await expect(ownRowAfterReload).toContainText('(ty)');

    // 4. Adjacent regression: the self-guard does not block managing others.
    const changeOther = await page.request.put(MEMBERS_API, {
      data: {
        targetUserId: tenant.teacher.id,
        newOrgRoleId: tenant.roles.member,
      },
    });
    expect(changeOther.status(), 'PUT /api/v1/organization/members (other → member)').toBe(200);
    expect(await changeOther.json()).toMatchObject({ success: true });

    const removeOther = await page.request.delete(MEMBERS_API, {
      params: { userId: tenant.student.id },
    });
    expect(removeOther.status(), 'DELETE /api/v1/organization/members?userId=<other>').toBe(200);
    expect(await removeOther.json()).toMatchObject({ success: true });

    const finalList = await page.request.get(MEMBERS_API);
    expect(finalList.status()).toBe(200);
    const finalBody = (await finalList.json()) as {
      success: boolean;
      data: Array<{ id: string; orgRoleName: string }>;
    };
    expect(finalBody.success).toBe(true);
    expect(finalBody.data.map((member) => member.id).sort()).toEqual(
      [tenant.manager.id, tenant.teacher.id].sort(),
    );
    expect(finalBody.data.find((member) => member.id === tenant.teacher.id)?.orgRoleName).toBe(
      'member',
    );
    expect(finalBody.data.find((member) => member.id === tenant.manager.id)?.orgRoleName).toBe(
      'admin',
    );

    expect(pageErrors, 'uncaught page errors on the members page').toEqual([]);
  });
});
