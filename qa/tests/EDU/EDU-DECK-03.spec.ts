import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-DECK-03 — changing a deck's visibility „Tylko ja” ⇄ „Grupy” (/edu/flashcards
 * → /app/flashcards).
 *
 * Prerequisite (reconciled with the tenant seeder): the deck from EDU-DECK-02,
 * i.e. an educator of an organization whose group `G1` holds a student, with a
 * group-visible deck shared to that group. The case's legacy accounts
 * (`teacher1@dev.local`, `student1..3`, password `pass`) are never used.
 *
 * Tenant: the `two-org` profile (`qa/tests/profiles/EDU-DECK-03.json`), seeded once
 * before Playwright starts (`bun scripts/qa-tenant.ts --all --run <suffix>`) and
 * read through `loadTenant(CASE)` — the spec never creates accounts, orgs or
 * groups at runtime:
 *   - org A: `teacherA` (educator, org role `teacher`) owns the deck and teaches
 *     the default group `O1G1-<run>`; `studentA` is an org member and member of
 *     `O1G1-<run>`. The second group `O1G2-<run>` is the case's „dodaj drugą
 *     grupę”.
 *   - org B: a second organization with its own groups `O2G1-<run>` / `O2G2-<run>`
 *     — only there to prove the group picker stays inside the active org.
 *
 * The `two-org` seeder enrols a member in the default group only, so the two
 * group-roster writes the case needs — `teacherA` teaches `O1G2-<run>` (the picker
 * lists a group only when it has a teacher, and only a group teacher may share
 * content to it) and `teacherA` is a member of org B teaching `O2G1-<run>` — are
 * made once in `test.beforeAll` through the product's own endpoints (the same
 * requests `/manage/groups` and `/manage/invites` make). They are tenant-local and
 * idempotent, so a retry against the same tenant starts from the same state. The
 * deck itself is created through the UI, as the case does.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. „Nowa talia” → „Grupy” → `O1G1-<run>` → „Utwórz” answers „Talia utworzona”;
 *    the deck is stored `visibility: 'group'` with exactly `[O1G1]` and the student
 *    sees it read-only (the case says „Podgląd”, the product renders „Przeglądaj”,
 *    a P3 copy difference — the test asserts the read-only entry point, not the
 *    wording).
 * 2. „Edytuj” → „Tylko ja” → „Aktualizuj” answers „Talia zaktualizowana”, stores
 *    `visibility: 'personal'` and **clears the share links** (`groupIds: []`, no
 *    group badge): the student loses the deck — gone from the list, deck detail 404.
 * 3. „Edytuj” → „Grupy” requires at least one group again (submit disabled,
 *    „Wybierz co najmniej jedną grupę”); picking `O1G1` + `O1G2` restores the share
 *    with both groups, and the student sees the deck again.
 * 4. The group picker lists only groups of the **active** organization: `O1G1`,
 *    `O1G2` — never org B's `O2G1`, although the teacher belongs to it too.
 */

const CASE = 'EDU-DECK-03';

/** The deck the case creates, and the groups its picker must offer. */
const DECK_NAME = 'Matematyka – klasa 1';

/** Polish copy the case quotes, as rendered by the current product. */
const COPY = {
  newDeck: 'Nowa talia',
  createTitle: 'Utwórz talię',
  editTitle: 'Edytuj talię',
  namePlaceholder: 'np. Biologia Rozdział 1',
  personalVisibility: 'Tylko ja',
  groupVisibility: 'Grupy',
  groupsRequired: 'Wybierz co najmniej jedną grupę',
  create: 'Utwórz',
  update: 'Aktualizuj',
  created: 'Talia utworzona',
  updated: 'Talia zaktualizowana',
  manage: 'Zarządzaj',
  view: 'Przeglądaj',
  edit: 'Edytuj',
  noDecks: '0 talii',
};

interface TenantUser {
  id: string;
  email: string;
  password: string;
}

interface TenantOrg {
  id: string;
  name: string;
  /** Default group first, then the org's second group. */
  groups: string[];
  student: TenantUser;
  inviteEmail: string;
  counts: { total: number; teachers: number; students: number };
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

/** Org A's default group (the deck's first share) and its second group. */
const GROUP_NAME = TENANT.orgA.groups[0];
const SECOND_GROUP_NAME = TENANT.orgA.groups[1];
/** A group of org B — the teacher is a member there too, but it must never leak. */
const OTHER_ORG_GROUP_NAME = TENANT.orgB.groups[0];

interface CaseGroups {
  group1: string;
  group2: string;
  otherOrgGroup: string;
}

/** Resolved once in `test.beforeAll` from the product's own group list. */
let groups: CaseGroups;

interface DeckListItem {
  id: string;
  name: string;
  visibility: 'personal' | 'group';
  groupIds: string[];
}

interface DeckListResult {
  items: DeckListItem[];
  total: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupRow {
  id: string;
  name: string;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

/** A deck card in the grid, addressed by its own heading so no sibling matches. */
function deckCard(page: Page, name: string): Locator {
  return page
    .locator('main [data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/**
 * A group badge on a card. Each card renders a mobile and a desktop copy, so the
 * locator is pinned to the one the current breakpoint shows.
 */
function groupBadge(card: Locator, groupName: string): Locator {
  return card
    .locator('[data-slot="badge"]:visible')
    .filter({ hasText: new RegExp(`^${groupName}$`) });
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `GET /api/v1/flashcards/decks` — the same list the screen renders. */
async function listDecks(page: Page): Promise<DeckListResult> {
  return getData<DeckListResult>(page, '/api/v1/flashcards/decks?limit=50');
}

async function findDeck(page: Page, name: string): Promise<DeckListItem> {
  const deck = (await listDecks(page)).items.find((item) => item.name === name);
  expect(deck, `deck "${name}" is stored for its creator`).toBeTruthy();
  return deck!;
}

/** The group options a picker offers right now, in render order. */
async function expectVisibleGroupOptions(page: Page, names: string[]): Promise<void> {
  const options = page.locator('[data-slot="popover-content"] [role="option"]');
  await expect(options).toHaveCount(names.length);
  for (const [index, name] of names.entries()) {
    await expect(options.nth(index)).toHaveText(name);
  }
  await expect(
    page.getByRole('option', { name: OTHER_ORG_GROUP_NAME, exact: true }),
    'a group of another organization must never be offered',
  ).toHaveCount(0);
}

/** Open the edit dialog of the deck through the card's own context menu. */
async function openEditDialog(page: Page): Promise<Locator> {
  const card = deckCard(page, DECK_NAME);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: `Więcej akcji: ${DECK_NAME}` }).click();
  await page.getByRole('menuitem', { name: COPY.edit, exact: true }).click();

  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: COPY.editTitle })).toBeVisible();
  return dialog;
}

/**
 * A retry against the same seeded tenant must start from the same state: drop the
 * decks a previous run left behind so the deck screen is empty again. Only this
 * case's own deck (same name, same tenant) is touched.
 */
async function resetDecks(page: Page): Promise<void> {
  for (const deck of (await listDecks(page)).items.filter((row) => row.name === DECK_NAME)) {
    const response = await page.request.delete(`/api/v1/flashcards/decks/${deck.id}`);
    expect(response.ok(), `DELETE /api/v1/flashcards/decks/${deck.id} → ${response.status()}`).toBe(
      true,
    );
  }
}

/** Id of one of the active organization's groups, as the product lists it. */
async function findGroupId(page: Page, name: string): Promise<string> {
  const list = await getData<GroupRow[]>(page, '/api/v1/organization/groups');
  const group = list.find((row) => row.name === name);
  expect(group, `group "${name}" is listed for the active organization`).toBeTruthy();
  return group!.id;
}

/**
 * The seeder enrols an org member in the default group with the `member` role, but
 * a group is offered in the pickers only when it has a teacher and only a group
 * `teacher` may share content to it. Promote the account through the manager's own
 * roster endpoint — the same write `/manage/groups` performs. Idempotent.
 */
async function ensureGroupTeacher(page: Page, groupId: string, userId: string): Promise<void> {
  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<GroupMemberRow[]>(page, url);
  const current = roster.find((row) => row.userId === userId);
  if (current?.role === 'teacher') return;

  const members = current
    ? roster.map((row) => (row.userId === userId ? { userId, role: 'teacher' as const } : row))
    : [...roster, { userId, role: 'teacher' as const }];
  const response = await page.request.put(url, { data: { members } });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);

  const after = await getData<GroupMemberRow[]>(page, url);
  expect(after.find((row) => row.userId === userId)?.role).toBe('teacher');
}

/**
 * Make the educator a member of the second organization through the product's own
 * invitation flow (the same requests `/manage/invites` and `/app/join` make), so
 * the active-org picker has a real cross-organization membership to hide. A retry
 * finds the membership already accepted and skips the invitation. Idempotent.
 */
async function ensureOrgMember(
  inviter: Page,
  invitee: Page,
  orgId: string,
  email: string,
): Promise<void> {
  const probe = await invitee.request.get(`/api/v1/organization/${orgId}`);
  if (probe.status() === 200) return;
  expect(probe.status(), 'a non-member cannot read the organization').toBe(403);

  const roles = await getData<{ id: string; name: string }[]>(
    inviter,
    '/api/v1/organization/roles',
  );
  const memberRole = roles.find((row) => row.name === 'member');
  expect(memberRole, 'the organization has its default member role').toBeTruthy();

  const created = await inviter.request.post('/api/v1/organization/invites', {
    data: { email, targetOrgRoleId: memberRole!.id },
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

  const after = await invitee.request.get(`/api/v1/organization/${orgId}`);
  expect(after.status(), 'the accepted invitation makes the educator an org member').toBe(200);
}

/**
 * The case's own tenant shape: org A with its second group led by the educator,
 * and org B where the educator is a member and teaches a group. Nothing global is
 * written — only this tenant's group rosters and org membership.
 */
test.beforeAll(async ({ browser }) => {
  const baseURL = process.env.QA_APP_URL ?? 'http://localhost:3010';
  const managerContext = await browser.newContext({ baseURL });
  const teacherContext = await browser.newContext({ baseURL });
  try {
    const manager = await managerContext.newPage();
    const teacher = await teacherContext.newPage();
    const teacherId = TENANT.users.teacherA.id;

    // Org A: the educator teaches both groups (the seeder only enrols the default).
    await loginAs(manager, TENANT, 'manager', { locale: 'pl', activeOrgId: TENANT.orgA.id });
    const group1 = await findGroupId(manager, GROUP_NAME);
    const group2 = await findGroupId(manager, SECOND_GROUP_NAME);
    await ensureGroupTeacher(manager, group2, teacherId);

    // Org B: the same educator is a member and teaches its group, so a picker that
    // leaked another organization's groups would offer it.
    await loginAs(manager, TENANT, 'manager', { locale: 'pl', activeOrgId: TENANT.orgB.id });
    const otherOrgGroup = await findGroupId(manager, OTHER_ORG_GROUP_NAME);
    await loginAs(teacher, TENANT, 'teacherA', { locale: 'pl', activeOrgId: TENANT.orgA.id });
    await ensureOrgMember(manager, teacher, TENANT.orgB.id, TENANT.users.teacherA.email);
    // Accepting the invitation switches the invitee's active org; the roster write
    // below needs the manager scoped to org B again.
    await loginAs(manager, TENANT, 'manager', { locale: 'pl', activeOrgId: TENANT.orgB.id });
    await ensureGroupTeacher(manager, otherOrgGroup, teacherId);

    groups = { group1, group2, otherOrgGroup };
  } finally {
    await managerContext.close();
    await teacherContext.close();
  }
});

test.describe('@case:EDU-DECK-03 @area:EDU @prio:P2 deck visibility', () => {
  test('switches a group deck to „Tylko ja” and back, and the group student follows', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Teacher: the EDU-DECK-02 deck, shared with the default group ───────
    await loginAs(page, TENANT, 'teacherA', { locale: 'pl', activeOrgId: TENANT.orgA.id });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');
    await page.goto('/edu/flashcards');
    await expect(page).toHaveURL(/\/edu\/flashcards$/);

    // A retry against the same tenant starts from an empty deck screen.
    await resetDecks(page);

    await page.getByRole('button', { name: COPY.newDeck }).first().click();
    const createDialog = page.locator('[data-slot="dialog-content"]');
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByRole('heading', { name: COPY.createTitle })).toBeVisible();

    await createDialog.getByPlaceholder(COPY.namePlaceholder).fill(DECK_NAME);
    await createDialog.locator('label[for="visibility-group"]').click();

    // A group deck without a group cannot be submitted.
    await expect(createDialog.getByText(COPY.groupsRequired, { exact: true })).toBeVisible();
    await expect(createDialog.getByRole('button', { name: COPY.create })).toBeDisabled();

    // 4. The picker offers the active org's groups only — org B's group is hidden.
    await createDialog.getByRole('combobox').click();
    await expectVisibleGroupOptions(page, [GROUP_NAME, SECOND_GROUP_NAME]);

    await page.getByRole('option', { name: GROUP_NAME, exact: true }).click();
    // The multi-select keeps its popover open after a pick; the dialog title
    // closes it without touching the rest of the form.
    await createDialog.getByRole('heading', { name: COPY.createTitle }).click();
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);

    const create = createDialog.getByRole('button', { name: COPY.create });
    await expect(create).toBeEnabled();
    await create.click();

    await expect(page.getByText(COPY.created, { exact: true }).first()).toBeVisible();
    await expect(createDialog).toHaveCount(0);

    const teacherCard = deckCard(page, DECK_NAME);
    await expect(teacherCard).toBeVisible();
    await expect(groupBadge(teacherCard, GROUP_NAME)).toHaveText(GROUP_NAME);
    await expect(teacherCard.getByRole('button', { name: COPY.manage })).toBeVisible();

    const created = await findDeck(page, DECK_NAME);
    expect(created.visibility, 'deck visibility').toBe('group');
    expect(created.groupIds, 'deck group share').toEqual([groups.group1]);
    const deckId = created.id;

    // ── The default-group student sees the group deck, read-only ───────────
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      await loginAs(studentPage, TENANT, 'studentA', { locale: 'pl', activeOrgId: TENANT.orgA.id });
      expect(new URL(studentPage.url()).pathname, 'student lands on /app').toBe('/app');
      await studentPage.goto('/app/flashcards');

      const studentCard = deckCard(studentPage, DECK_NAME);
      await expect(studentCard).toBeVisible();
      await expect(groupBadge(studentCard, GROUP_NAME)).toHaveText(GROUP_NAME);
      await expect(studentCard.getByRole('button', { name: COPY.view })).toBeVisible();
      await expect(studentCard.getByRole('button', { name: COPY.manage })).toHaveCount(0);
      const visibleDetail = await studentPage.request.get(`/api/v1/flashcards/decks/${deckId}`);
      expect(visibleDetail.status(), 'the student may open the shared deck').toBe(200);

      // ── Step 1: „Tylko ja” ──────────────────────────────────────────────
      const editDialog = await openEditDialog(page);
      await expect(editDialog.locator('#visibility-group')).toHaveAttribute('aria-checked', 'true');
      await expect(editDialog.getByRole('combobox')).toContainText(GROUP_NAME);

      await editDialog.locator('label[for="visibility-personal"]').click();
      await expect(
        editDialog.getByRole('combobox'),
        'no group picker on a personal deck',
      ).toHaveCount(0);
      await editDialog.getByRole('button', { name: COPY.update }).click();

      await expect(page.getByText(COPY.updated, { exact: true }).first()).toBeVisible();
      await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: DECK_NAME, exact: true })).toBeVisible();

      const personal = await findDeck(page, DECK_NAME);
      expect(personal.id).toBe(deckId);
      expect(personal.visibility, 'deck visibility after „Tylko ja”').toBe('personal');
      expect(personal.groupIds, 'the share links are cleared, not just hidden').toEqual([]);
      await expect(groupBadge(deckCard(page, DECK_NAME), GROUP_NAME)).toHaveCount(0);

      // ── Step 2: the student loses access ────────────────────────────────
      await studentPage.goto('/app/flashcards');
      await expect(studentPage.getByText(COPY.noDecks, { exact: true })).toBeVisible();
      await expect(
        studentPage.getByRole('heading', { name: DECK_NAME, exact: true }),
        'the deck is gone from the student list',
      ).toHaveCount(0);
      const hiddenDetail = await studentPage.request.get(`/api/v1/flashcards/decks/${deckId}`);
      expect(hiddenDetail.status(), 'a personal deck is invisible to the group student').toBe(404);

      // ── Step 3: „Grupy” again, now with both groups ─────────────────────
      const restoreDialog = await openEditDialog(page);
      await expect(restoreDialog.locator('#visibility-personal')).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await restoreDialog.locator('label[for="visibility-group"]').click();
      await expect(
        restoreDialog.getByText(COPY.groupsRequired, { exact: true }),
        'a group deck must select at least one group again',
      ).toBeVisible();
      await expect(restoreDialog.getByRole('button', { name: COPY.update })).toBeDisabled();

      await restoreDialog.getByRole('combobox').click();
      await expectVisibleGroupOptions(page, [GROUP_NAME, SECOND_GROUP_NAME]);
      await page.getByRole('option', { name: GROUP_NAME, exact: true }).click();
      await page.getByRole('option', { name: SECOND_GROUP_NAME, exact: true }).click();
      await restoreDialog.getByRole('heading', { name: COPY.editTitle }).click();
      await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
      await expect(restoreDialog.getByRole('combobox')).toContainText(SECOND_GROUP_NAME);

      const update = restoreDialog.getByRole('button', { name: COPY.update });
      await expect(update).toBeEnabled();
      await update.click();

      await expect(page.getByText(COPY.updated, { exact: true }).first()).toBeVisible();
      await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);

      const restoredCard = deckCard(page, DECK_NAME);
      await expect(groupBadge(restoredCard, GROUP_NAME)).toHaveText(GROUP_NAME);
      await expect(groupBadge(restoredCard, SECOND_GROUP_NAME)).toHaveText(SECOND_GROUP_NAME);

      const restored = await findDeck(page, DECK_NAME);
      expect(restored.id).toBe(deckId);
      expect(restored.visibility, 'deck visibility after restoring „Grupy”').toBe('group');
      expect(restored.groupIds, 'both selected groups are shared').toEqual([
        groups.group1,
        groups.group2,
      ]);

      // ── Step 4: the student sees the deck again ─────────────────────────
      await studentPage.goto('/app/flashcards');
      const restoredStudentCard = deckCard(studentPage, DECK_NAME);
      await expect(restoredStudentCard).toBeVisible();
      // The student only knows the default group; the second badge is not part of
      // its group map.
      await expect(groupBadge(restoredStudentCard, GROUP_NAME)).toHaveText(GROUP_NAME);
      await expect(
        studentPage.getByText(COPY.noDecks, { exact: true }),
        'the student list is no longer empty',
      ).toHaveCount(0);
      const restoredDetail = await studentPage.request.get(`/api/v1/flashcards/decks/${deckId}`);
      expect(restoredDetail.status(), 'the restored share grants deck access again').toBe(200);
    } finally {
      await studentContext.close();
    }

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
