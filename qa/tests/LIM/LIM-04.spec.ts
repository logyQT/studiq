import { expect, type Page } from '@playwright/test';
import { loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * LIM-04 — the Launch organization's two hard boundaries: 3 groups and 5 members,
 * counting every role (admin, teachers, members) in the member counter.
 *
 * The case is a combined pass over EDU-GRP-04 (group limit) and ONB-10 (member
 * limit at invitation acceptance). Both limits belong to the organization's own
 * plan, so the tenant must be a Launch organization with room left in both
 * counters:
 *
 *   bun scripts/qa-tenant.ts LIM-04 --fresh
 *
 * `qa/tests/profiles/LIM-04.json` declares `{"profile":"org-limit","plan":"launch"}`:
 * an organization with four members (admin, two teachers, one member), one seeded
 * group `G1`, and two invitee accounts that are not org members. That is exactly
 * the case prerequisite: 4 of 5 seats and 1 of 3 groups used.
 *
 * The legacy manual seed (`manager@dev.local`, `teacher1@dev.local`, `pass`) is
 * never used. Every id comes from `loadTenant('LIM-04')`, i.e.
 * `tenantKey('qa/cases/LIM-04.md', 'LIM-04#<run>', 'qa-shared')` + `tenantId`.
 * Nothing global is read or written: no admin setting, feature flag, plan row,
 * platform stat or singleton — only this tenant's own org, groups, members and
 * invitations.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. With one group in a Launch org (`max_groups = 3`), the teacher creates the
 *    second and third groups (`POST /organization/groups` → 201, toast
 *    „Grupa utworzona”). The fourth attempt → 429
 *    `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}`, the toast
 *    „Nie udało się utworzyć grupy”, the dialog keeps the typed name, and the
 *    org still holds exactly three groups.
 * 2. With four members (`max_students = 5`), the manager sends two invitations
 *    (member role, displayed as „Student”). The first invitee accepts through
 *    `/app/join` (`POST /organization/invites/accept` → 200) and the org is at
 *    5 of 5 — the counter includes the admin and both teachers. The second
 *    invitee is refused with 429 `USAGE_LIMIT_EXCEEDED` and the inline
 *    „Ta organizacja osiągnęła limit członków…” message; the code is not
 *    consumed and the invitee is not added to `org_members`.
 *
 * Re-run safety: CI seeds one tenant per spec and retries against it, so the
 * spec normalises only its own artefacts at the start of every run — removes the
 * two invitees if an earlier attempt let one join, and deletes the groups it
 * names. A successful run leaves the org at 5/5 and 3/3, so the next run (and a
 * `--repeat-each` repeat) starts from the same 4/5 and 1/3 baseline.
 */

const CASE = 'LIM-04';

/** The groups this spec creates; the fourth name is deliberately never stored. */
const GROUPS = {
  second: 'LIM-04 Grupa 2',
  third: 'LIM-04 Grupa 3',
  refused: 'LIM-04 Grupa 4',
} as const;

const GROUPS_URL = '/api/v1/organization/groups';
const MEMBERS_URL = '/api/v1/organization/members';

/** Polish copy from the manager/educator pages (pl.json) and the join screen. */
const COPY = {
  groupsTitle: 'Grupy',
  newGroup: 'Nowa grupa',
  createTitle: 'Utwórz grupę',
  create: 'Utwórz',
  created: 'Grupa utworzona',
  createFailed: 'Nie udało się utworzyć grupy',
  addAnother: 'Dodaj kolejną',
  sendInvites: 'Wyślij zaproszenia',
  joinButton: 'Dołącz',
  memberLimit: /osiągnęła limit członków/i,
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  teacherCount: number;
  canManage: boolean;
}

interface OrgMember {
  id: string;
  email: string;
  orgRoleName: string;
}

interface MyOrg {
  id: string;
  orgRoleName: string;
}

/** GET a `/api/v1` endpoint as the signed-in user and unwrap `{ success, data }`. */
async function getJson<T>(page: Page, url: string): Promise<ApiEnvelope<T>> {
  const res = await page.request.get(url);
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(res.ok(), `GET ${url} → ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  expect(body.success, `GET ${url} success`).toBe(true);
  return body;
}

/** The rows the groups page renders, read through the same API the page calls. */
async function listGroups(page: Page): Promise<GroupSummary[]> {
  return (await getJson<GroupSummary[]>(page, GROUPS_URL)).data;
}

async function listMembers(page: Page): Promise<OrgMember[]> {
  return (await getJson<OrgMember[]>(page, MEMBERS_URL)).data;
}

/** The table row for an exact group name (descriptions and sr-labels excluded). */
function groupRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

/**
 * Re-run safety for the member counter: an earlier attempt may have let the
 * first invitee take the last seat. Removing a member frees the seat again.
 */
async function removeInviteesIfJoined(page: Page, tenant: QaTenant): Promise<void> {
  const members = await listMembers(page);
  for (const role of ['invitee1', 'invitee2'] as const) {
    const invitee = tenant.users[role];
    expect(invitee, `${CASE} needs the seeded ${role} account`).toBeTruthy();
    if (!members.some((member) => member.id === invitee!.id)) continue;
    const res = await page.request.delete(`${MEMBERS_URL}?userId=${invitee!.id}`);
    expect(res.status(), `cleanup DELETE ${role}`).toBe(200);
  }
}

/** Re-run safety for the group counter: remove only the groups this spec named. */
async function removeOwnGroups(page: Page): Promise<void> {
  const names = Object.values(GROUPS);
  for (const group of (await listGroups(page)).filter((candidate) =>
    names.includes(candidate.name as (typeof GROUPS)[keyof typeof GROUPS]),
  )) {
    const res = await page.request.delete(`${GROUPS_URL}/${group.id}`);
    expect(res.status(), `cleanup DELETE ${group.name}`).toBe(200);
  }
}

/** Open `/edu/groups` the way a teacher does: dashboard first, then the sidebar. */
async function openGroups(page: Page, tenant: QaTenant): Promise<void> {
  await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu$/ });

  // The dashboard settles the active organization before the groups page loads;
  // a bare deep link right after an API login can answer 403 until it does.
  await expect(
    page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]'),
  ).toContainText(tenant.org!.name);
  await page.locator('a[href="/edu/groups"]').first().click();
  await expect(page).toHaveURL(/\/edu\/groups$/);
  await expect(page.getByRole('heading', { name: COPY.groupsTitle, exact: true })).toBeVisible();
}

/** Fill the „Utwórz grupę” dialog and submit; returns the POST response. */
async function createGroup(page: Page, name: string) {
  await page.getByRole('button', { name: COPY.newGroup }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(COPY.createTitle, { exact: true })).toBeVisible();

  const nameInput = dialog.getByRole('textbox').nth(0);
  await expect(nameInput).toHaveValue('');
  await nameInput.fill(name);

  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith(GROUPS_URL) && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: COPY.create, exact: true }).click();

  return { dialog, response: await responsePromise };
}

/** One invitation row on `/manage/invites`: e-mail field + role combobox. */
async function fillInviteRow(
  page: Page,
  index: number,
  email: string,
  roleLabel: string,
): Promise<void> {
  await page.locator(`#email-${index}`).fill(email);
  await page.locator(`#role-${index}`).click();
  await page.getByRole('option', { name: roleLabel, exact: true }).click();
  await expect(page.locator(`#role-${index}`)).toHaveText(roleLabel);
}

/** The 32-hex invite code the manager page shows for each result row. */
function inviteCodeFor(rows: string[], email: string): string {
  const row = rows.find((text) => text.includes(email));
  expect(row, `no invitation result row for ${email}`).toBeTruthy();
  const code = row?.match(/[0-9a-f]{32}/)?.[0];
  expect(code, `no invite code in the result row "${row}"`).toMatch(/^[0-9a-f]{32}$/);
  return code as string;
}

/** Accept an invitation through `/app/join` and return the accept response. */
async function acceptInvite(page: Page, token: string) {
  await page.goto('/app/join');
  await expect(page).toHaveURL(/\/app\/join$/);
  await page.locator('#token').fill(token);
  const response = page.waitForResponse(
    (res) =>
      res.url().includes('/api/v1/organization/invites/accept') &&
      res.request().method() === 'POST',
  );
  await page.getByRole('button', { name: COPY.joinButton, exact: true }).click();
  return response;
}

test.describe('LIM-04 — Launch organization limits: 3 groups, 5 members', () => {
  test('holds both boundaries and refuses the element past each one', async ({ page, context }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');
    expect(tenant.plan, `${CASE} needs the Launch plan (3 groups / 5 members)`).toBe('launch');
    if (!tenant.org || !tenant.group) {
      throw new Error(
        `${CASE} fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
      );
    }
    const org = tenant.org;
    const invitee1 = tenant.users.invitee1;
    const invitee2 = tenant.users.invitee2;
    if (!invitee1 || !invitee2) {
      throw new Error(
        `${CASE} fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
      );
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Prerequisite: the organization's own Launch plan and counters ------
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

    const plan = await getJson<{ key: string; limits: Record<string, number> }>(
      page,
      '/api/v1/me/plan',
    );
    expect(plan.data.key, 'the organization plan is Launch').toBe('launch');
    const groupLimit = plan.data.limits.max_groups;
    const memberLimit = plan.data.limits.max_students;
    expect({ groupLimit, memberLimit }, 'the Launch boundaries').toEqual({
      groupLimit: 3,
      memberLimit: 5,
    });

    // Re-run safety: a previous attempt may have consumed a seat and/or a group.
    await removeInviteesIfJoined(page, tenant);
    await removeOwnGroups(page);

    const baselineMembers = await listMembers(page);
    expect(
      baselineMembers,
      'the org starts one seat below capacity (admin + two teachers + one member)',
    ).toHaveLength(memberLimit - 1);
    expect(
      new Set(baselineMembers.map((member) => member.orgRoleName)),
      'the member counter includes every role already',
    ).toEqual(new Set(['admin', 'teacher', 'member']));

    const baselineGroups = await listGroups(page);
    expect(
      baselineGroups.map((group) => group.name),
      'the org starts with its one seeded group',
    ).toEqual([tenant.group.name]);

    // --- Part 1 (EDU-GRP-04): the third group is created, the fourth is not -
    await context.clearCookies();
    await openGroups(page, tenant);

    // Creating from the organization's plan capacity is allowed: 1 → 2 → 3.
    const second = await createGroup(page, GROUPS.second);
    expect(second.response.status(), await second.response.text()).toBe(201);
    await expect(second.dialog).toBeHidden();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: COPY.created }).first(),
    ).toBeVisible();
    await expect(groupRow(page, GROUPS.second)).toBeVisible();

    const third = await createGroup(page, GROUPS.third);
    expect(third.response.status(), await third.response.text()).toBe(201);
    await expect(third.dialog).toBeHidden();
    await expect(groupRow(page, GROUPS.third)).toBeVisible();

    const atCapacity = await listGroups(page);
    expect(
      atCapacity.map((group) => group.name),
      'the organization now holds exactly three groups',
    ).toEqual([tenant.group.name, GROUPS.second, GROUPS.third]);

    // The fourth group is refused by the Launch plan limit.
    const refused = await createGroup(page, GROUPS.refused);
    expect(refused.response.status(), 'the fourth group must be refused by the plan').toBe(429);
    const refusedBody = (await refused.response.json()) as ApiEnvelope<unknown>;
    expect(refusedBody.success).toBe(false);
    expect(refusedBody.error).toBe('USAGE_LIMIT_EXCEEDED');

    // Readable feedback, and the dialog keeps the attempt so nothing is lost.
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: COPY.createFailed }).first(),
    ).toBeVisible();
    await expect(refused.dialog).toBeVisible();
    await expect(refused.dialog.getByRole('textbox').nth(0)).toHaveValue(GROUPS.refused);
    await expect(groupRow(page, GROUPS.refused)).toHaveCount(0);

    // The refusal did not create anything: the organization still has 3 groups.
    const afterGroupRefusal = await listGroups(page);
    expect(
      afterGroupRefusal.map((group) => group.name),
      'the refused group is not stored',
    ).toEqual([tenant.group.name, GROUPS.second, GROUPS.third]);

    // --- Part 2 (ONB-10): 4 → 5 seats, then the next acceptance is refused -
    await context.clearCookies();
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

    const roles = await getJson<Array<{ id: string; name: string; displayName?: string }>>(
      page,
      '/api/v1/organization/roles',
    );
    const memberRole = roles.data.find((role) => role.name === 'member');
    expect(memberRole, 'the org has no "member" role').toBeTruthy();
    const memberRoleLabel = memberRole?.displayName ?? memberRole?.name ?? '';
    // In the UI the org's `member` role is labelled „Student”.
    expect(memberRoleLabel, 'the member role label used by the invite form').toBe('Student');

    const rolesLoaded = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/organization/roles') && res.status() === 200,
    );
    await page.goto('/manage/invites');
    await rolesLoaded;
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    await fillInviteRow(page, 0, invitee1.email, memberRoleLabel);
    await page.getByRole('button', { name: COPY.addAnother }).click();
    await fillInviteRow(page, 1, invitee2.email, memberRoleLabel);

    const bulkResponse = page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/v1/organization/invites/bulk') &&
        res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: COPY.sendInvites, exact: true }).click();
    const bulk = await bulkResponse;
    expect(bulk.status(), `bulk invite failed: ${await bulk.text()}`).toBeLessThan(300);

    await expect(page.getByTestId('invite-result-row')).toHaveCount(2);
    const resultRows = await page.getByTestId('invite-result-row').allInnerTexts();
    const token1 = inviteCodeFor(resultRows, invitee1.email);
    const token2 = inviteCodeFor(resultRows, invitee2.email);

    // The first invitee fills the last free seat: 5 of 5.
    await context.clearCookies();
    await loginAs(page, tenant, 'invitee1', { locale: 'pl', activeOrgId: null });
    const accept1 = await acceptInvite(page, token1);
    expect(accept1.status(), 'the first acceptance must succeed').toBe(200);
    const accept1Body = (await accept1.json()) as ApiEnvelope<{ id: string }>;
    expect(accept1Body.success, JSON.stringify(accept1Body)).toBe(true);
    expect(accept1Body.data.id).toBe(org.id);

    await expect(page.locator('#token')).toHaveValue('');
    const orgs1 = await getJson<MyOrg[]>(page, '/api/v1/me/orgs');
    expect(orgs1.data, 'the first invitee is now a member of the tenant org').toHaveLength(1);
    expect(orgs1.data[0].id).toBe(org.id);
    expect(orgs1.data[0].orgRoleName).toBe('member');

    // The second invitee is refused by the same limit.
    await context.clearCookies();
    await loginAs(page, tenant, 'invitee2', { locale: 'pl', activeOrgId: null });
    const orgs2Before = await getJson<unknown[]>(page, '/api/v1/me/orgs');
    expect(orgs2Before.data, 'the second invitee starts outside the org').toHaveLength(0);

    const accept2 = await acceptInvite(page, token2);
    expect(accept2.status(), 'the second acceptance must be refused by the plan limit').toBe(429);
    const accept2Body = (await accept2.json()) as ApiEnvelope<unknown>;
    expect(accept2Body.success).toBe(false);
    expect(accept2Body.error).toBe('USAGE_LIMIT_EXCEEDED');

    // The refusal is explained next to the field and the code is not consumed.
    const limitMessage = page.locator('#token-error');
    await expect(limitMessage).toBeVisible();
    await expect(limitMessage).toHaveText(COPY.memberLimit);
    await expect(page.locator('#token')).toHaveValue(token2);
    await expect(page.locator('#token')).toHaveAttribute('aria-invalid', 'true');
    const orgs2After = await getJson<unknown[]>(page, '/api/v1/me/orgs');
    expect(orgs2After.data, 'the refused invitee must not be added to org_members').toHaveLength(0);

    // --- Boundaries from the manager's view ---------------------------------
    await context.clearCookies();
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

    const finalMembers = await listMembers(page);
    expect(
      finalMembers,
      `the org is now at capacity (${memberLimit} of ${memberLimit})`,
    ).toHaveLength(memberLimit);
    const emailsAfter = finalMembers.map((member) => member.email);
    expect(emailsAfter, 'the first invitee joined').toContain(invitee1.email);
    expect(emailsAfter, 'the refused invitee did not join').not.toContain(invitee2.email);
    expect(
      new Set(finalMembers.map((member) => member.orgRoleName)),
      'the five seats span admin, teachers and members',
    ).toEqual(new Set(['admin', 'teacher', 'member']));

    const finalGroups = await listGroups(page);
    expect(
      finalGroups.map((group) => group.name),
      'the group boundary stays at three',
    ).toEqual([tenant.group.name, GROUPS.second, GROUPS.third]);

    expect(pageErrors, 'uncaught page errors during the limit checks').toEqual([]);
  });
});
