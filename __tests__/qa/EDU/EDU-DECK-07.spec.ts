import { PERMISSIONS } from '@studiq/authz';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * EDU-DECK-07 — sharing a deck with a class grants read only (#961).
 *
 * Case: a teacher shares a deck with `G1`. A member with a read-only custom role
 * sees the deck and its cards, cannot edit them in the UI, and every write the
 * API receives is refused with 403. A role cannot be granted `deck.update` at
 * group in the editor, and a direct save is refused with 422. An org Admin who
 * did not create the deck still edits it.
 *
 * Tenant: `content` on `hub` (`__tests__/qa/profiles/EDU-DECK-07.json`), seeded
 * before Playwright starts. The spec provisions its own prerequisite through the
 * product API, inside this tenant:
 *   - a custom role from `template: 'blank'`, granted `deck.read` and
 *     `flashcard.read` at `group`, assigned to the seeded student;
 *   - the seeded teacher promoted to `teacher` of `G1`, because a deck can be
 *     shared with a group only by its teacher;
 *   - the teacher's group deck (one card) and a personal deck.
 *
 * Walk (2026-11-27, `fix/961-group-scope`): with the catalog change in place the
 * student's payload carries no content write, so the deck menu offers only
 * „Eksportuj” — no „Edytuj”, no „Usuń”, no „Zawieś talię” — and the deck has no
 * „Nowa Fiszka”. The manager's menu on the teacher's deck offers „Edytuj” and
 * „Usuń”, and the role editor's „Edytuj talię” row renders only „Własne” and
 * „Organizacja”.
 *
 * Mutation (proves this spec can fail): remove `orgId` from the deck-detail
 * `deck.update` gate in `deck-detail-screen.tsx`; step 5's „Edytuj” assertion
 * goes red for the Admin. Restoring it turns the spec green again.
 */

const CASE = 'EDU-DECK-07';

const ROLE_NAME = 'view-only';
const GROUP_DECK_NAME = 'EDU-DECK-07 talia grupowa';
const PERSONAL_DECK_NAME = 'EDU-DECK-07 talia osobista';
const CARD = { front: 'EDU-DECK-07 przód', back: 'EDU-DECK-07 tył' };
const RENAMED_DECK_NAME = 'EDU-DECK-07 talia po zmianie';

/** Polish copy of the deck detail (`AppFlashcardDeckViewPage`). */
const COPY = {
  deckMenu: 'Więcej akcji talii',
  edit: 'Edytuj',
  delete: 'Usuń',
  suspend: 'Zawieś talię',
  export: 'Eksportuj',
  newFlashcard: 'Nowa Fiszka',
  roleEditor: (name: string) => `Uprawnienia roli ${name}`,
  scopeGroup: 'Grupa',
} as const;

type Scope = 'own' | 'group' | 'organization';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckRow {
  id: string;
  name: string;
  created_by: string;
  visibility: 'personal' | 'group';
}

interface FlashcardRow {
  id: string;
  deck_id: string;
  front: string;
}

interface RoleRow {
  id: string;
  name: string;
  isSystem: boolean;
}

interface RolePermission {
  permissionName: string;
  scope: string;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

const CATALOG_KEYS = Object.keys(PERMISSIONS);

/** Every catalog key in one payload; only the named ones are granted. */
function catalogPayload(granted: Record<string, Scope> = {}) {
  return {
    permissions: CATALOG_KEYS.map((key) => ({
      permissionName: key,
      scope: granted[key] ?? null,
    })),
  };
}

/** The read-only grant this case assigns: both reads at `group`, nothing else. */
const READ_ONLY_GRANTS: Record<string, Scope> = {
  'deck.read': 'group',
  'flashcard.read': 'group',
};

/** How many catalog keys allow a scope — the number of radios that render its label. */
function scopeRadioCount(scope: Scope): number {
  return Object.values(PERMISSIONS).filter((definition) => definition.allowedScopes.includes(scope))
    .length;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = await json<ApiEnvelope<T>>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

async function postData<T>(page: Page, url: string, data: unknown, status = 201): Promise<T> {
  const response = await page.request.post(url, { data });
  expect(response.status(), `POST ${url} → ${response.status()} ${await response.text()}`).toBe(
    status,
  );
  const body = await json<ApiEnvelope<T>>(response);
  expect(body.success, `POST ${url} success flag`).toBe(true);
  return body.data;
}

async function putData(page: Page, url: string, data: unknown, status = 200): Promise<void> {
  const response = await page.request.put(url, { data });
  expect(response.status(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(
    status,
  );
}

/**
 * A visible text match: the deck screen renders a mobile and a desktop copy of
 * each card, so the locator is pinned to the one the breakpoint shows.
 */
function visibleText(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

/** A deck card in the grid, addressed by its own heading so no sibling matches. */
function deckCard(page: Page, name: string): Locator {
  return page
    .locator('main [data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** Open the deck detail's own action menu. */
async function openDeckMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: COPY.deckMenu, exact: true }).click();
  await expect(page.getByRole('menuitem', { name: COPY.export, exact: true })).toBeVisible();
}

/** Log in as another tenant account: the previous session is a real switch. */
async function signInAs(
  page: Page,
  tenant: QaTenant,
  role: QaRole,
  waitFor: RegExp,
): Promise<void> {
  await page.request.post('/api/v1/auth/logout');
  await loginAs(page, tenant, role, { locale: 'pl', waitFor });
}

/** A retry starts from the same state: drop this case's own decks first. */
async function resetDecks(page: Page): Promise<void> {
  const { items } = await getData<{ items: DeckRow[] }>(page, '/api/v1/flashcards/decks?limit=100');
  for (const deck of items.filter((row) =>
    [GROUP_DECK_NAME, RENAMED_DECK_NAME, PERSONAL_DECK_NAME].includes(row.name),
  )) {
    const response = await page.request.delete(`/api/v1/flashcards/decks/${deck.id}`);
    expect(response.ok(), `DELETE /api/v1/flashcards/decks/${deck.id} → ${response.status()}`).toBe(
      true,
    );
  }
}

/**
 * The custom role exists with exactly the read-only grant. A retry can inherit
 * the previous run's role, so its grants are overwritten with the same payload.
 */
async function ensureReadOnlyRole(page: Page): Promise<string> {
  const roles = await getData<RoleRow[]>(page, '/api/v1/organization/roles');
  const existing = roles.find((role) => !role.isSystem && role.name === ROLE_NAME);
  const roleId =
    existing?.id ??
    (
      await postData<RoleRow>(page, '/api/v1/organization/roles', {
        name: ROLE_NAME,
        template: 'blank',
      })
    ).id;

  await putData(
    page,
    `/api/v1/organization/roles/${roleId}/permissions`,
    catalogPayload(READ_ONLY_GRANTS),
  );
  return roleId;
}

/** Give the student the custom role through the same write `/manage/members` uses. */
async function assignMemberRole(page: Page, tenant: QaTenant, roleId: string): Promise<void> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} needs the seeded student`);
  await putData(page, '/api/v1/organization/members', {
    targetUserId: student.id,
    newOrgRoleId: roleId,
  });
}

/**
 * Only a teacher of the group may share a deck with it (`group.service.ts`), and
 * the seeder enrols the teacher as a plain member. The roster endpoint replaces
 * the whole list, so every other member is sent back unchanged.
 */
async function promoteTeacher(page: Page, tenant: QaTenant): Promise<void> {
  const groupId = tenant.group?.id;
  const teacher = tenant.users.teacher;
  if (!groupId || !teacher) throw new Error(`${CASE} needs the content tenant profile (group)`);

  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<GroupMemberRow[]>(page, url);
  if (roster.find((row) => row.userId === teacher.id)?.role === 'teacher') return;

  await putData(page, url, {
    members: roster.map((row) =>
      row.userId === teacher.id ? { userId: row.userId, role: 'teacher' } : row,
    ),
  });
}

/** The teacher's two decks: the group-shared one (with one card) and a personal one. */
async function createDecks(
  page: Page,
  tenant: QaTenant,
): Promise<{ groupDeck: DeckRow; card: FlashcardRow }> {
  const groupId = tenant.group?.id;
  if (!groupId) throw new Error(`${CASE} needs the seeded group`);

  const groupDeck = await postData<DeckRow>(page, '/api/v1/flashcards/decks', {
    name: GROUP_DECK_NAME,
    visibility: 'group',
    groupIds: [groupId],
  });
  const card = await postData<FlashcardRow>(page, '/api/v1/flashcards', {
    deckId: groupDeck.id,
    front: CARD.front,
    back: CARD.back,
  });
  await postData<DeckRow>(page, '/api/v1/flashcards/decks', {
    name: PERSONAL_DECK_NAME,
    visibility: 'personal',
  });
  return { groupDeck, card };
}

async function readRolePermissions(page: Page, roleId: string): Promise<RolePermission[]> {
  const role = await getData<{ permissions: RolePermission[] }>(
    page,
    `/api/v1/organization/roles/${roleId}`,
  );
  return role.permissions;
}

test.describe('@case:EDU-DECK-07 @area:EDU @prio:P1 a group share is a view share', () => {
  test('a group member reads the deck; the write and the grant are refused', async ({ page }) => {
    test.setTimeout(180_000);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    if (!tenant.group) throw new Error(`${CASE} needs the seeded group`);

    // ── Fixture: the read-only role, the roster, the decks ─────────────────────
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    const roleId = await ensureReadOnlyRole(page);
    await assignMemberRole(page, tenant, roleId);
    await promoteTeacher(page, tenant);
    await resetDecks(page);

    await signInAs(page, tenant, 'teacher', /\/edu(\/|$)/);
    const { groupDeck, card } = await createDecks(page, tenant);

    // ── Step 2: the member sees the shared deck, read-only ─────────────────────
    await signInAs(page, tenant, 'student', /\/app(\/|$)/);
    await page.goto('/app/flashcards');
    await expect(deckCard(page, GROUP_DECK_NAME), 'the shared deck is listed').toHaveCount(1);
    await expect(
      page.getByText(PERSONAL_DECK_NAME, { exact: true }),
      "the teacher's personal deck is not shared with the group",
    ).toHaveCount(0);

    await deckCard(page, GROUP_DECK_NAME).click();
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${groupDeck.id}$`));
    await expect(visibleText(page, CARD.front), 'the shared card is readable').toHaveCount(1);

    await openDeckMenu(page);
    for (const item of [COPY.edit, COPY.delete, COPY.suspend]) {
      await expect(
        page.getByRole('menuitem', { name: item, exact: true }),
        `the member's deck menu offers no „${item}”`,
      ).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: COPY.newFlashcard, exact: true })).toHaveCount(0);

    // ── Step 3: the API refuses every write ────────────────────────────────────
    for (const [method, url, body] of [
      ['PUT', `/api/v1/flashcards/decks/${groupDeck.id}`, { name: 'próba edycji' }],
      ['PUT', `/api/v1/flashcards/${card.id}`, { front: 'próba edycji' }],
      ['POST', '/api/v1/flashcards', { deckId: groupDeck.id, front: 'x', back: 'y' }],
      ['DELETE', `/api/v1/flashcards/decks/${groupDeck.id}`, undefined],
    ] as const) {
      const response =
        method === 'DELETE'
          ? await page.request.delete(url)
          : method === 'PUT'
            ? await page.request.put(url, { data: body })
            : await page.request.post(url, { data: body });
      expect(response.status(), `${method} ${url} as the member`).toBe(403);
    }

    // The read grant still works: the deck and its card are readable.
    await expect(visibleText(page, CARD.front), 'the card is still readable').toHaveCount(1);

    // ── Step 4: no edit share is grantable ─────────────────────────────────────
    await signInAs(page, tenant, 'manager', /\/manage(\/|$)/);
    await page.goto('/manage/roles');
    await page.getByRole('button', { name: COPY.roleEditor(ROLE_NAME), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`Edytuj uprawnienia: ${ROLE_NAME}`)).toBeVisible();

    for (const scope of ['own', 'group', 'organization'] as const) {
      await expect(
        dialog.getByRole('radio', {
          name: { own: 'Własne', group: COPY.scopeGroup, organization: 'Organizacja' }[scope],
          exact: true,
        }),
        `the catalog renders ${scopeRadioCount(scope)} „${scope}” radios`,
      ).toHaveCount(scopeRadioCount(scope));
    }

    const deckUpdateRow = dialog.locator('[data-perm-row="deck.update"]');
    await expect(deckUpdateRow.locator('input[data-perm-radio="true"]')).toHaveCount(2);
    await expect(
      deckUpdateRow.getByRole('radio', { name: COPY.scopeGroup, exact: true }),
      '„Edytuj talię” offers no group scope (#961)',
    ).toHaveCount(0);

    const refused = await page.request.put(`/api/v1/organization/roles/${roleId}/permissions`, {
      data: catalogPayload({ ...READ_ONLY_GRANTS, 'deck.update': 'group' }),
    });
    expect(refused.status(), `PUT a group content write → ${await refused.text()}`).toBe(422);

    const stored = await readRolePermissions(page, roleId);
    expect(stored.map((row) => row.permissionName).toSorted()).toEqual(
      Object.keys(READ_ONLY_GRANTS).toSorted(),
    );
    expect(stored.some((row) => row.permissionName === 'deck.update')).toBe(false);

    // ── Step 5: the Admin edits a deck it did not create ───────────────────────
    await page.goto(`/app/flashcards/${groupDeck.id}`);
    await openDeckMenu(page);
    await expect(page.getByRole('menuitem', { name: COPY.edit, exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: COPY.delete, exact: true })).toBeVisible();

    await putData(page, `/api/v1/flashcards/decks/${groupDeck.id}`, {
      name: RENAMED_DECK_NAME,
    });
    const readback = await getData<{ items: DeckRow[] }>(
      page,
      '/api/v1/flashcards/decks?limit=100',
    );
    expect(readback.items.find((row) => row.id === groupDeck.id)?.name).toBe(RENAMED_DECK_NAME);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
