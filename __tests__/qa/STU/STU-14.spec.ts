import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, type QaTenant } from '#test/qa/fixtures/tenant';
import { tenantId } from '#test/helpers/tenant-seed';

/**
 * STU-14 — deck list: ownership filter and group filter (/app/flashcards).
 *
 * Prerequisite (reconciled with the tenant seeder): a student who is a member of
 * exactly one group of an organization. The case's legacy account
 * (`student1@dev.local`, password `pass`) and its O1G1/O1G2 content are never
 * used; the spec owns the whole graph.
 *
 * Tenant: `__tests__/qa/profiles/STU-14.json` declares a declarative `content`
 * shape, seeded **once before Playwright starts** by
 * `bun scripts/qa-tenant.ts --all --run <suffix>`:
 *   - org: one organization, default group `O1G1` and a second, empty group
 *     `O1G2` (`groups`: first is the default, the rest are seeded empty);
 *   - `teacher`: org role `teacher`, the group teacher of `O1G1` (the seeder
 *     enrols the owner that way);
 *   - `student`: org member, a member of `O1G1` only (never of `O1G2`).
 *
 * `O1G2` is created without members, so before sharing a deck with it the spec
 * makes the teacher its group teacher through the product's own group-roster
 * endpoint (`PUT /api/v1/organization/groups/<id>/members`, the same write
 * `/manage/groups` performs). That is a tenant-local group membership change,
 * not tenant shape: accounts, org and groups all come from the pre-suite seed.
 *
 * Content is built through the product's flashcard API, so nothing is shared
 * with another case:
 *   - `O1G1T1` — group deck shared with `O1G1` (the student's group);
 *   - `O1G2T2` — group deck shared with `O1G2` (a group the student is not in);
 *   - `O1S1`   — the student's own personal deck.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. „Wszystkie” lists exactly `O1G1T1` (with the `O1G1` badge) and `O1S1`,
 *    never `O1G2T2`; the counter says „2 talie”.
 * 2. „Moje” narrows the list to the student's own `O1S1`.
 * 3. „Moje grupy” selects the student's groups, narrowing the list to the deck
 *    shared with that group; clearing the selection returns to „Dowolna grupa”
 *    and the full list. The scope select offers only „Wszystkie” / „Moje” — the
 *    retired „Grupy” / „Udostępnione” options are gone (#595), and the API
 *    rejects the retired `groupFilter` parameter instead of ignoring it.
 */

const CASE = 'STU-14';
const TENANT = loadTenant(CASE);

/**
 * The seeder's deterministic id for the second declared group (`groups[1]`).
 * The groups API lists a group only once it has a teacher, so the empty `O1G2`
 * cannot be discovered by name before this spec enrols the teacher in it.
 */
let GROUP_G2_ID: string;

// The tenant is per attempt, so the derived group id is resolved per attempt.
/**
 * Close the filter popover. The pointer has to leave the „Grupy” row first: while
 * it rests there the hover flyout reopens after every Escape, and Escape is spent
 * closing that layer instead of the popover.
 */
async function closeFilterPopover(page: Page): Promise<void> {
  const content = page.locator('[data-slot="popover-content"]');
  // The pointer has to leave the „Grupy” row first: while it rests there the hover
  // flyout reopens after every Escape, and Escape is spent closing that layer.
  await page.mouse.move(0, 0);
  for (let attempt = 0; attempt < 3 && (await content.count()) > 0; attempt += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await expect(content).toHaveCount(0);
}

test.beforeEach(() => {
  GROUP_G2_ID = tenantId(TENANT.key, 'group:2');
});

const GROUP_G1 = 'O1G1';
const GROUP_DECK = 'O1G1T1';
const OTHER_GROUP_DECK = 'O1G2T2';
const PERSONAL_DECK = 'O1S1';

/** Polish copy the case quotes, as rendered by the current product. */
const COPY = {
  filters: 'Filtry',
  ownerMine: 'Moje',
  groups: 'Grupy',
  twoDecks: '2 talie',
  oneDeck: '1 talia',
  retiredGroupScope: 'Udostępnione',
  retiredSharedScope: 'Udostępnione',
} as const;

interface DeckRow {
  id: string;
  name: string;
  visibility?: string;
  groupIds?: string[];
  created_by: string;
}

interface DeckListBody {
  data: { items: DeckRow[]; total: number };
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = await json<ApiEnvelope<T>>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** The tenant's decks, as the deck list API returns them for the current user. */
async function listDecks(page: Page): Promise<DeckRow[]> {
  return (await getData<{ items: DeckRow[] }>(page, '/api/v1/flashcards/decks?limit=100')).items;
}

/**
 * Only a group `teacher` may share a deck with the group
 * (`canShareContentToGroups`). The profile declares that the tenant teacher
 * teaches both declared groups (`groupTeachers`), because no endpoint lets a
 * caller join a class they neither teach nor created: `group.member.manage` at
 * `group` scope needs a `teacher` row to exist first. This only asserts the
 * seeded premise.
 */
async function ensureTeacherLeadsGroup(
  page: Page,
  tenant: QaTenant,
  groupId: string,
): Promise<void> {
  const teacher = tenant.users.teacher;
  if (!teacher) throw new Error(`${CASE} needs the declarative tenant profile (teacher)`);

  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<GroupMemberRow[]>(page, url);
  expect(
    roster.find((row) => row.userId === teacher.id)?.role,
    'the seeded tenant has the teacher on O1G2 as its teacher',
  ).toBe('teacher');
}

/**
 * A retry (or a `--repeat-each` pass) runs against the same seeded tenant: drop
 * the decks a previous pass left behind so the list starts from the same state.
 * Only this case's own decks (same names, same tenant) are touched.
 */
async function deleteDecksNamed(page: Page, names: readonly string[]): Promise<void> {
  for (const deck of (await listDecks(page)).filter((row) => names.includes(row.name))) {
    const response = await page.request.delete(`/api/v1/flashcards/decks/${deck.id}`);
    expect(response.ok(), `DELETE /api/v1/flashcards/decks/${deck.id} → ${response.status()}`).toBe(
      true,
    );
  }
}

/** A visible deck card in the grid, addressed by its own heading. */
function deckCard(page: Page, name: string) {
  return page
    .locator('main .group:visible')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** The filter control — its accessible name stays „Filtry”, the chips are its value. */
function filtersButton(page: Page) {
  return page.getByRole('button', { name: COPY.filters, exact: true });
}

/** A filter dimension row inside the open filter control. */
function filterRow(page: Page, name: string) {
  return page.getByRole('option', { name, exact: true });
}

/** A group inside the flyout beside the list. */
function groupRow(page: Page, name: string) {
  return page
    .locator('[data-slot="hover-card-content"]')
    .getByRole('button', { name, exact: true });
}

async function createDeckAs(
  page: Page,
  data: { name: string; visibility?: 'personal' | 'group'; groupIds?: string[] },
): Promise<DeckRow> {
  const response = await page.request.post('/api/v1/flashcards/decks', { data });
  expect(response.status(), `POST /api/v1/flashcards/decks (${data.name})`).toBe(201);
  const body = await json<{ data: DeckRow }>(response);
  return body.data;
}

test.describe('STU-14 @area:STU @prio:P2 deck list filters', () => {
  test('lists the group and personal decks and filters them by owner and group', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = TENANT;
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const groupG1 = tenant.group;
    const teacher = tenant.users.teacher;
    const student = tenant.users.student;
    if (!groupG1 || !teacher || !student) {
      throw new Error(`${CASE} tenant is missing its default group, teacher or student`);
    }

    // ── Build the tenant content through the API ─────────────────────────────
    // The teacher first joins O1G2 as its group teacher (empty in the seed), so
    // the second group deck is legitimate, never injected as a row the API would
    // have refused.
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    await ensureTeacherLeadsGroup(page, tenant, GROUP_G2_ID);
    await deleteDecksNamed(page, [GROUP_DECK, OTHER_GROUP_DECK]);

    const groupDeck = await createDeckAs(page, {
      name: GROUP_DECK,
      visibility: 'group',
      groupIds: [groupG1.id],
    });
    const otherGroupDeck = await createDeckAs(page, {
      name: OTHER_GROUP_DECK,
      visibility: 'group',
      groupIds: [GROUP_G2_ID],
    });

    // Guard the fixture itself: the deck the student must NOT see really exists
    // and is shared with a different group.
    const teacherDecks = await listDecks(page);
    expect(
      teacherDecks.find((deck) => deck.id === otherGroupDeck.id)?.groupIds,
      'O1G2T2 is shared with O1G2',
    ).toEqual([GROUP_G2_ID]);

    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });
    await deleteDecksNamed(page, [PERSONAL_DECK]);
    const personalDeck = await createDeckAs(page, { name: PERSONAL_DECK });
    expect(personalDeck.visibility ?? 'personal', 'a new deck defaults to personal').toBe(
      'personal',
    );

    // ── Step 1: the list as a whole ──────────────────────────────────────────
    const response = await page.goto('/app/flashcards');
    expect(response?.status(), 'GET /app/flashcards').toBe(200);
    await expect(page).toHaveURL(/\/app\/flashcards$/);

    await expect(page.getByText(COPY.twoDecks, { exact: true })).toBeVisible();
    await expect(deckCard(page, GROUP_DECK), 'the group deck is listed').toHaveCount(1);
    await expect(deckCard(page, PERSONAL_DECK), 'the personal deck is listed').toHaveCount(1);
    // O1G2T2 belongs to a group the student is not in: invisible, not merely filtered.
    await expect(
      page.getByRole('heading', { name: OTHER_GROUP_DECK, exact: true }),
      'the other group deck is not rendered',
    ).toHaveCount(0);

    // The group deck carries its group badge; the personal deck carries none.
    await expect(
      deckCard(page, GROUP_DECK).locator('[data-slot="badge"]:visible', { hasText: GROUP_G1 }),
      'O1G1 badge on the group deck',
    ).toHaveCount(1);
    await expect(
      deckCard(page, PERSONAL_DECK).locator('[data-slot="badge"]:visible', { hasText: GROUP_G1 }),
      'no group badge on the personal deck',
    ).toHaveCount(0);

    // ── Step 2: „Moje” on, then off ─────────────────────────────────────────
    await expect(filtersButton(page)).toContainText(COPY.filters);
    await filtersButton(page).click();
    await expect(filterRow(page, COPY.ownerMine)).toHaveAttribute('aria-checked', 'false');
    // The retired group-scope values are gone; „Grupy” is the group dimension.
    await expect(page.getByRole('option', { name: COPY.retiredGroupScope })).toHaveCount(0);
    await expect(page.getByRole('option', { name: COPY.retiredSharedScope })).toHaveCount(0);

    await filterRow(page, COPY.ownerMine).click();
    await closeFilterPopover(page);

    await expect(filtersButton(page)).toContainText(COPY.ownerMine);
    await expect(page.getByText(COPY.oneDeck, { exact: true })).toBeVisible();
    await expect(deckCard(page, PERSONAL_DECK), '„Moje” keeps the personal deck').toHaveCount(1);
    await expect(deckCard(page, GROUP_DECK), '„Moje” drops the teacher’s group deck').toHaveCount(
      0,
    );

    // ── Step 3: „Grupy”, then clear back to the unfiltered list ──────────────
    await filtersButton(page).click();
    await filterRow(page, COPY.ownerMine).click();
    await closeFilterPopover(page);
    await expect(page.getByText(COPY.twoDecks, { exact: true })).toBeVisible();

    await filtersButton(page).click();
    const groupsRow = filterRow(page, COPY.groups);
    await expect(groupsRow).toHaveAttribute('aria-checked', 'false');
    // A student is offered only the groups they belong to, in the flyout.
    await groupsRow.hover();
    await expect(groupRow(page, GROUP_G1)).toBeVisible();
    await expect(
      page.locator('[data-slot="hover-card-content"]').getByRole('button'),
      'only the caller’s own group',
    ).toHaveCount(1);

    await groupsRow.click();
    await closeFilterPopover(page);

    await expect(filtersButton(page)).toContainText(COPY.groups);
    await expect(page.getByText(COPY.oneDeck, { exact: true })).toBeVisible();
    await expect(deckCard(page, GROUP_DECK), 'the group filter keeps the shared deck').toHaveCount(
      1,
    );
    await expect(
      deckCard(page, PERSONAL_DECK),
      'the group filter drops the personal deck',
    ).toHaveCount(0);

    // Clearing the selection restores the unfiltered list.
    await filtersButton(page).click();
    await expect(groupsRow).toHaveAttribute('aria-checked', 'true');
    await groupsRow.click();
    await closeFilterPopover(page);
    await expect(filtersButton(page)).toContainText(COPY.filters);
    await expect(page.getByText(COPY.twoDecks, { exact: true })).toBeVisible();
    await expect(deckCard(page, GROUP_DECK)).toHaveCount(1);
    await expect(deckCard(page, PERSONAL_DECK)).toHaveCount(1);

    // ── API contract behind the two filters ──────────────────────────────────
    const mine = await page.request.get('/api/v1/flashcards/decks?owner=mine');
    expect(mine.status(), 'GET decks?owner=mine').toBe(200);
    expect(
      (await json<DeckListBody>(mine)).data.items.map((deck) => deck.id),
      'owner=mine returns exactly the student’s own deck',
    ).toEqual([personalDeck.id]);

    const byGroup = await page.request.get(`/api/v1/flashcards/decks?groups=${groupG1.id}`);
    expect(byGroup.status(), 'GET decks?groups=O1G1').toBe(200);
    expect(
      (await json<DeckListBody>(byGroup)).data.items.map((deck) => deck.id),
      'groups=O1G1 returns exactly the deck shared with that group',
    ).toEqual([groupDeck.id]);

    // A foreign group id cannot widen the caller’s RBAC scope.
    const foreignGroup = await page.request.get(`/api/v1/flashcards/decks?groups=${GROUP_G2_ID}`);
    expect(foreignGroup.status(), 'GET decks?groups=O1G2').toBe(200);
    expect(
      (await json<DeckListBody>(foreignGroup)).data.items,
      'the other group’s deck id never leaks',
    ).toHaveLength(0);

    // The retired `groupFilter` toggle is rejected, not silently ignored (#595).
    const retired = await page.request.get('/api/v1/flashcards/decks?groupFilter=mine');
    expect(retired.status(), 'GET decks?groupFilter=mine').toBe(422);
  });
});
