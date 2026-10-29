import type { Page } from '@playwright/test';
import { expect, loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * ONB-07 — switching organizations (teacher in two orgs).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator who is a
 * **teacher in two organizations**, each with its own groups, question banks and
 * flashcard decks. The legacy manual account (`teacher1@dev.local`, password
 * `pass`) is never used.
 *
 * Tenant: the `two-org` profile (`qa/tests/profiles/ONB-07.json`), seeded once
 * before Playwright starts (`bun scripts/qa-tenant.ts --all --run <suffix>`) and
 * read through `loadTenant(CASE)` — the spec never creates accounts, orgs or
 * groups inside the worker:
 *   - org A: `teacherA` (educator, org role `teacher`) teaches the default group
 *     `O1G1-<run>`; `O1G2-<run>` is the org's second group;
 *   - org B: its own two groups `O2G1-<run>` / `O2G2-<run>`.
 *
 * The `two-org` seeder makes the **manager** the only member of both
 * organizations, so the second membership this case is about — `teacherA` as an
 * org `teacher` in org B — is a product-API write in `test.beforeAll`: the
 * invitation is minted by the org admin (`POST /api/v1/organization/invites`, the
 * same request `/manage/invites` makes) and accepted by the educator
 * (`POST /api/v1/organization/invites/accept`, the `/app/join` request). A
 * `members` roster cannot express it because it only shapes one organization.
 *
 * The third organization the teacher must never reach is also product state: the
 * tenant's manager creates it through `POST /api/v1/organization` (idempotently,
 * by its run-unique name), and the teacher is never invited to it.
 *
 * Content is created through the product API in `test.beforeAll` as well — two
 * question banks and two flashcard decks per org, shared with the org's default
 * group that `teacherA` teaches. Every write is idempotent (looked up by its
 * run-unique name first), so a CI retry or `--repeat-each` against the same
 * seeded tenant starts from the same rows and the exact-id assertions stay
 * stable.
 */

const CASE = 'ONB-07';

interface Entity {
  id: string;
  name: string;
}

interface TenantUser {
  id: string;
  email: string;
  password: string;
}

interface TenantOrg {
  id: string;
  name: string;
  /** Default group first, then the org's second group. */
  groups: [string, string];
}

/** The `two-org` tenant shape `scripts/qa-tenant.ts` writes for this case. */
interface TwoOrgTenant extends QaTenant {
  manager: TenantUser;
  orgA: TenantOrg;
  orgB: TenantOrg;
  users: NonNullable<QaTenant['users']> & {
    manager: TenantUser;
    studentA: TenantUser;
    teacherA: TenantUser;
    studentB: TenantUser;
  };
}

const TENANT = loadTenant(CASE) as TwoOrgTenant;
const TEACHER = TENANT.users.teacherA;

type Side = 'A' | 'B';

const ORGS: Record<Side, TenantOrg> = { A: TENANT.orgA, B: TENANT.orgB };

/** Naming suffix of this run's tenant, so a retry reuses the same content rows. */
const RUN = TENANT.runSuffix ?? TENANT.orgA.id.slice(0, 8);

interface OrgContent {
  org: TenantOrg;
  groups: Entity[];
  banks: Entity[];
  decks: Entity[];
}

/** Each org's groups and the banks/decks the case creates in it. */
let content!: Record<Side, OrgContent>;
/** An existing org this teacher is deliberately **not** a member of. */
let foreignOrg!: Entity;

interface OrgMembership {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

function appUrl(): string {
  return process.env.QA_APP_URL ?? 'http://localhost:3010';
}

async function apiData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path} → ${response.status()} ${await response.text()}`).toBe(
    200,
  );
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data;
}

/** Id of one of the active organization's groups, as the product lists it. */
async function groupId(page: Page, name: string): Promise<string> {
  const groups = await apiData<Entity[]>(page, '/api/v1/organization/groups');
  const group = groups.find((row) => row.name === name);
  expect(group, `group "${name}" is listed for the active organization`).toBeTruthy();
  return group!.id;
}

/** `GET /api/v1/questions/banks?limit=100` — the same list the screen renders. */
async function bankItems(page: Page): Promise<Entity[]> {
  return (await apiData<{ items: Entity[] }>(page, '/api/v1/questions/banks?limit=100')).items;
}

/** `GET /api/v1/flashcards/decks?limit=100` — the same list the screen renders. */
async function deckItems(page: Page): Promise<Entity[]> {
  return (await apiData<{ items: Entity[] }>(page, '/api/v1/flashcards/decks?limit=100')).items;
}

/** Create a group-visible question bank, or reuse the row a retry already made. */
async function ensureBank(page: Page, name: string, group: string): Promise<Entity> {
  const existing = (await bankItems(page)).find((item) => item.name === name);
  if (existing) return existing;

  const response = await page.request.post('/api/v1/questions/banks', {
    data: { name, visibility: 'group', groupIds: [group] },
  });
  expect(
    response.status(),
    `POST /api/v1/questions/banks (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<Entity>;
  expect(body.success, `POST /api/v1/questions/banks (${name}) success`).toBe(true);
  return body.data;
}

/** Create a group-visible flashcard deck, or reuse the row a retry already made. */
async function ensureDeck(page: Page, name: string, group: string): Promise<Entity> {
  const existing = (await deckItems(page)).find((item) => item.name === name);
  if (existing) return existing;

  const response = await page.request.post('/api/v1/flashcards/decks', {
    data: { name, visibility: 'group', groupIds: [group] },
  });
  expect(
    response.status(),
    `POST /api/v1/flashcards/decks (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<Entity>;
  expect(body.success, `POST /api/v1/flashcards/decks (${name}) success`).toBe(true);
  return body.data;
}

/** Make the active org the one the caller's next requests are scoped to. */
async function activateOrg(page: Page, orgId: string): Promise<void> {
  const response = await page.request.post('/api/v1/me/orgs/switch', { data: { orgId } });
  expect(
    response.ok(),
    `POST /api/v1/me/orgs/switch ${orgId} → ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

/**
 * The seeder enrols an org member in the default group with the `member` role, but
 * a group-visible bank/deck may only be shared to a group the caller *teaches*.
 * Promote the educator through the manager's own roster endpoint — the same write
 * `/manage/groups` performs. Idempotent.
 */
async function ensureGroupTeacher(page: Page, group: string, userId: string): Promise<void> {
  const url = `/api/v1/organization/groups/${group}/members`;
  const roster = await apiData<GroupMemberRow[]>(page, url);
  const current = roster.find((row) => row.userId === userId);
  if (current?.role === 'teacher') return;

  const members = current
    ? roster.map((row) => (row.userId === userId ? { userId, role: 'teacher' as const } : row))
    : [...roster, { userId, role: 'teacher' as const }];
  const response = await page.request.put(url, { data: { members } });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);

  const after = await apiData<GroupMemberRow[]>(page, url);
  expect(after.find((row) => row.userId === userId)?.role).toBe('teacher');
}

/**
 * Make the educator a `teacher`-role member of the second organization through the
 * product's own invitation flow (org admin invites, invitee accepts). A retry finds
 * the membership already accepted and skips the invitation; the role is then
 * re-asserted idempotently.
 */
async function ensureOrgMember(inviter: Page, invitee: Page, org: TenantOrg): Promise<void> {
  const probe = await invitee.request.get(`/api/v1/organization/${org.id}`);
  if (probe.status() !== 200) {
    expect(probe.status(), 'a non-member cannot read the organization').toBe(403);

    const roles = await apiData<{ id: string; name: string }[]>(
      inviter,
      '/api/v1/organization/roles',
    );
    const teacherRole = roles.find((row) => row.name === 'teacher');
    expect(teacherRole, 'the organization has its default teacher role').toBeTruthy();

    const created = await inviter.request.post('/api/v1/organization/invites', {
      data: { email: TEACHER.email, targetOrgRoleId: teacherRole!.id },
    });
    expect(
      created.status(),
      `POST /api/v1/organization/invites → ${created.status()} ${await created.text()}`,
    ).toBe(201);
    const invitation = ((await created.json()) as ApiEnvelope<{ inviteCode: string }>).data;
    expect(invitation.inviteCode, 'the invitation has a join code').toMatch(/^[0-9a-f]{32}$/);

    const accepted = await invitee.request.post('/api/v1/organization/invites/accept', {
      data: { token: invitation.inviteCode },
    });
    expect(
      accepted.ok(),
      `POST /api/v1/organization/invites/accept → ${accepted.status()} ${await accepted.text()}`,
    ).toBe(true);

    const after = await invitee.request.get(`/api/v1/organization/${org.id}`);
    expect(after.status(), 'the accepted invitation makes the educator an org member').toBe(200);
  }

  // The case asserts the `teacher` org role in both organizations, so keep it true
  // even if an earlier attempt invited with another role.
  const roles = await apiData<{ id: string; name: string }[]>(
    inviter,
    '/api/v1/organization/roles',
  );
  const teacherRole = roles.find((row) => row.name === 'teacher');
  expect(teacherRole, 'the organization has its default teacher role').toBeTruthy();
  const changed = await inviter.request.put('/api/v1/organization/members', {
    data: { targetUserId: TEACHER.id, newOrgRoleId: teacherRole!.id },
  });
  expect(
    changed.ok(),
    `PUT /api/v1/organization/members → ${changed.status()} ${await changed.text()}`,
  ).toBe(true);
}

/** The third org the teacher must not reach: owned by the manager, no membership for them. */
async function ensureForeignOrg(manager: Page): Promise<Entity> {
  const name = `ONB07 ${RUN} foreign`;
  const memberships = await apiData<Entity[]>(manager, '/api/v1/me/orgs');
  const existing = memberships.find((row) => row.name === name);
  if (existing) return existing;

  const response = await manager.request.post('/api/v1/organization', { data: { name } });
  expect(
    response.status(),
    `POST /api/v1/organization (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<Entity>).data;
}

/** The case's own content for one org: its two groups, two banks and two decks. */
async function ensureOrgContent(page: Page, side: Side): Promise<OrgContent> {
  const org = ORGS[side];
  const groups = await apiData<Entity[]>(page, '/api/v1/organization/groups');
  const orgGroups = org.groups.map((name) => {
    const found = groups.find((group) => group.name === name);
    expect(found, `group "${name}" is listed in ${org.name}`).toBeTruthy();
    return found!;
  });
  const team = orgGroups[0].id;

  const banks: Entity[] = [];
  for (const n of [1, 2]) {
    banks.push(await ensureBank(page, `ONB07 ${RUN} ${side} Bank ${n}`, team));
  }
  const decks: Entity[] = [];
  for (const n of [1, 2]) {
    decks.push(await ensureDeck(page, `ONB07 ${RUN} ${side} Deck ${n}`, team));
  }

  return { org, groups: orgGroups, banks, decks };
}

/**
 * The case's own tenant shape, made once through the product API: `teacherA` as a
 * `teacher` in org B (invitation), a group-teacher roster in both default groups,
 * and two banks/decks per org. Nothing global is written — no settings, feature
 * flags, plans or platform rows — and no other case's tenant is touched.
 */
test.beforeAll(async ({ browser }) => {
  const baseURL = appUrl();
  const managerContext = await browser.newContext({ baseURL });
  const teacherContext = await browser.newContext({ baseURL });
  try {
    const manager = await managerContext.newPage();
    const teacher = await teacherContext.newPage();

    // Org A: the educator teaches the default group (the seeder enrols them).
    await loginAs(manager, TENANT, 'manager', { locale: 'pl', activeOrgId: TENANT.orgA.id });
    await loginAs(teacher, TENANT, 'teacherA', { locale: 'pl', activeOrgId: TENANT.orgA.id });
    await ensureGroupTeacher(manager, await groupId(manager, TENANT.orgA.groups[0]), TEACHER.id);

    // Org B: the educator joins through the real invitation flow, then teaches its
    // default group. The manager must be scoped to org B for both writes.
    await loginAs(manager, TENANT, 'manager', { locale: 'pl', activeOrgId: TENANT.orgB.id });
    await ensureOrgMember(manager, teacher, TENANT.orgB);
    await ensureGroupTeacher(manager, await groupId(manager, TENANT.orgB.groups[0]), TEACHER.id);

    // Accepting the invitation switched the educator's active org to B, so pin the
    // org each block of content is created in.
    await activateOrg(teacher, TENANT.orgA.id);
    const orgAContent = await ensureOrgContent(teacher, 'A');
    await activateOrg(teacher, TENANT.orgB.id);
    const orgBContent = await ensureOrgContent(teacher, 'B');
    content = { A: orgAContent, B: orgBContent };

    // Last: creating an org switches the manager's own active org.
    foreignOrg = await ensureForeignOrg(manager);

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(`ONB-07 tenant: ${TENANT.key}`);
  } finally {
    await managerContext.close();
    await teacherContext.close();
  }
});

async function memberships(page: Page): Promise<OrgMembership[]> {
  return apiData<OrgMembership[]>(page, '/api/v1/me/orgs');
}

async function bankIds(page: Page): Promise<string[]> {
  return (await bankItems(page)).map((bank) => bank.id).sort();
}

async function deckIds(page: Page): Promise<string[]> {
  return (await deckItems(page)).map((deck) => deck.id).sort();
}

async function groupIds(page: Page): Promise<string[]> {
  const groups = await apiData<Entity[]>(page, '/api/v1/organization/groups');
  return groups.map((group) => group.id).sort();
}

function ids(entities: Entity[]): string[] {
  return entities.map((entity) => entity.id).sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"]');

/** The switcher trigger carries the active org's tenant label. */
const ORG_NAME_PATTERN = new RegExp(
  [TENANT.orgA.name, TENANT.orgB.name].map(escapeRegExp).join('|'),
);

/**
 * The sidebar has two dropdown triggers: the org switcher (top) and the account
 * menu (bottom). The org switcher is the only one carrying the tenant label.
 */
function orgTrigger(page: Page) {
  return sidebar(page)
    .locator('[data-slot="dropdown-menu-trigger"]')
    .filter({ hasText: ORG_NAME_PATTERN });
}

async function openSwitcher(page: Page): Promise<void> {
  await orgTrigger(page).click();
  await expect(page.getByRole('menuitem', { name: TENANT.orgA.name })).toBeVisible();
}

function orgMenuItem(page: Page, org: Entity) {
  return page.getByRole('menuitem', { name: org.name });
}

/**
 * The management cards render a mobile and a desktop variant of the same name;
 * only one of them is visible at the desktop viewport.
 */
function visibleName(page: Page, name: string) {
  return page.getByText(name, { exact: true }).filter({ visible: true });
}

/** The menu marks exactly the active org with the check glyph. */
async function expectActiveInSwitcher(
  page: Page,
  active: OrgContent,
  inactive: OrgContent,
): Promise<void> {
  await openSwitcher(page);

  await expect(orgMenuItem(page, active.org)).toBeVisible();
  await expect(orgMenuItem(page, inactive.org)).toBeVisible();
  await expect(orgMenuItem(page, active.org)).toContainText('Teacher');
  await expect(orgMenuItem(page, inactive.org)).toContainText('Teacher');

  await expect(page.locator('[role="menuitem"] svg.lucide-check')).toHaveCount(1);
  await expect(orgMenuItem(page, active.org).locator('svg.lucide-check')).toBeVisible();
  await expect(orgMenuItem(page, inactive.org).locator('svg.lucide-check')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
}

/** Switch through the switcher the way a teacher does; the app must land on /edu. */
async function switchTo(page: Page, org: OrgContent): Promise<void> {
  await openSwitcher(page);
  await orgMenuItem(page, org.org).click();
  // Wait for the menu to finish closing: reopening while Radix still holds the
  // trigger in its open state would toggle it closed instead.
  await expect(page.getByRole('menuitem')).toHaveCount(0);

  await expect(page).toHaveURL(/\/edu(\/|$)/, { timeout: 20_000 });
  await expect
    .poll(async () => (await memberships(page)).find((membership) => membership.isActive)?.id)
    .toBe(org.org.id);
  await expect(orgTrigger(page)).toContainText(org.org.name);
}

/** Assert the active org's content is the only content every surface lists. */
async function expectOnlyOrgContent(
  page: Page,
  visible: OrgContent,
  hidden: OrgContent,
): Promise<void> {
  // Server state first: the same isolation the UI must render.
  expect(await bankIds(page), 'question banks scoped to the active org').toEqual(
    ids(visible.banks),
  );
  expect(await deckIds(page), 'decks scoped to the active org').toEqual(ids(visible.decks));
  expect(await groupIds(page), 'groups scoped to the active org').toEqual(ids(visible.groups));

  // Pytania — question banks.
  await sidebar(page).locator('a[href="/edu/questions"]').click();
  await expect(page).toHaveURL(/\/edu\/questions$/);
  for (const bank of visible.banks) {
    await expect(visibleName(page, bank.name)).toHaveCount(1);
  }
  for (const bank of hidden.banks) {
    await expect(visibleName(page, bank.name)).toHaveCount(0);
  }

  // Talie — flashcard decks.
  await sidebar(page).locator('a[href="/edu/flashcards"]').click();
  await expect(page).toHaveURL(/\/edu\/flashcards$/);
  for (const deck of visible.decks) {
    await expect(visibleName(page, deck.name)).toHaveCount(1);
  }
  for (const deck of hidden.decks) {
    await expect(visibleName(page, deck.name)).toHaveCount(0);
  }

  // Grupy — organization groups.
  await sidebar(page).locator('a[href="/edu/groups"]').click();
  await expect(page).toHaveURL(/\/edu\/groups$/);
  for (const group of visible.groups) {
    await expect(visibleName(page, group.name)).toHaveCount(1);
  }
  for (const group of hidden.groups) {
    await expect(visibleName(page, group.name)).toHaveCount(0);
  }
}

/** Real login through the API, then boot the app; the context keeps the session cookie. */
async function loginAsTeacher(page: Page): Promise<void> {
  await loginAs(page, TENANT, 'teacherA', { locale: 'pl', activeOrgId: TENANT.orgA.id });
  expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

  await expect(sidebar(page)).toBeVisible();
  // Let `useOrgs` settle its auto-selection into exactly one active org.
  await expect
    .poll(async () => (await memberships(page)).filter((org) => org.isActive).length)
    .toBe(1);
}

test.describe('@case:ONB-07 @area:ONB @prio:P1 switching organizations', () => {
  test('lists both orgs and swaps the visible content on every teacher surface', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const orgA = content.A;
    const orgB = content.B;

    await loginAsTeacher(page);

    // --- Step 1: the switcher lists exactly this teacher's two orgs ---------
    const listed = await memberships(page);
    expect(listed.map((org) => org.id).sort()).toEqual(ids([orgA.org, orgB.org]));
    expect(listed.map((org) => org.orgRoleName)).toEqual(['teacher', 'teacher']);

    const first = listed.find((org) => org.isActive)!;
    const firstOrg = first.id === orgA.org.id ? orgA : orgB;
    const secondOrg = firstOrg === orgA ? orgB : orgA;

    await expectActiveInSwitcher(page, firstOrg, secondOrg);

    // --- Step 2: switch to the other org → the /edu dashboard --------------
    await switchTo(page, secondOrg);
    await expect(orgTrigger(page), 'the sidebar shows the newly active org').toContainText(
      secondOrg.org.name,
    );
    await expectActiveInSwitcher(page, secondOrg, firstOrg);

    // --- Step 3: Pytania / Fiszki / Grupy show the new org, only ----------
    await expectOnlyOrgContent(page, secondOrg, firstOrg);

    // --- Step 4: switch back from a content page → /edu again ------------
    await switchTo(page, firstOrg);
    await expectActiveInSwitcher(page, firstOrg, secondOrg);

    await expectOnlyOrgContent(page, firstOrg, secondOrg);

    // The active org is a server cookie: a reload must not fall back to the
    // auto-selected org or show the other org's rows.
    await page.reload();
    await expect(page).toHaveURL(/\/edu\/groups$/);
    for (const group of firstOrg.groups) {
      await expect(visibleName(page, group.name)).toHaveCount(1);
    }
    for (const group of secondOrg.groups) {
      await expect(visibleName(page, group.name)).toHaveCount(0);
    }
    await expect
      .poll(async () => (await memberships(page)).find((org) => org.isActive)?.id)
      .toBe(firstOrg.org.id);
  });

  test('refuses to switch into an org the teacher does not belong to', async ({ page }) => {
    test.setTimeout(60_000);

    await loginAsTeacher(page);
    const before = await memberships(page);
    const activeBefore = before.find((org) => org.isActive)!;

    // The foreign org exists, but this teacher holds no `org_members` row for it.
    const switched = await page.request.post('/api/v1/me/orgs/switch', {
      data: { orgId: foreignOrg.id },
    });
    expect(switched.status(), 'switch to a non-member org').toBe(404);

    const after = await memberships(page);
    expect(after.map((org) => org.id).sort()).toEqual(before.map((org) => org.id).sort());
    expect(after.filter((org) => org.isActive).map((org) => org.id)).toEqual([activeBefore.id]);

    // The switcher never offers the foreign org either.
    await openSwitcher(page);
    await expect(page.getByRole('menuitem', { name: foreignOrg.name })).toHaveCount(0);
  });
});
