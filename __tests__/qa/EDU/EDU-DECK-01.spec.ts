import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-DECK-01 — the educator's flashcard hub (`/edu/flashcards`).
 *
 * Case steps: open `/edu/flashcards`, then check the deck list, the scope filter
 * („Wszystkie” / „Moje”) and the group filter.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-DECK-01 --fresh
 *
 * gives the org `qa-edu-deck-01-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1` (`tenantKey('qa/cases/EDU-DECK-01.md',
 * 'EDU-DECK-01#<suffix>', 'qa-shared')` + `tenantId` for every id). Nothing global
 * is read or written: no admin setting, feature flag, plan, platform stat or
 * singleton row.
 *
 * The case was written against the legacy seed (`teacher1@dev.local`, `O1G1T1`).
 * In the tenant model the educator owns two decks — one personal and one shared to
 * `G1` — and the manager shares a third deck to the same group. Because the seeded
 * educator holds the org `member` role, its `deck.read` scope is `group`, so the
 * manager's shared deck is readable under „Wszystkie” and filtered out by „Moje”.
 * The seeder enrolls group members as group `member`, and only a group `teacher`
 * may share content, so the spec promotes the educator through the manager's own
 * group-roster endpoint first (tenant-local, idempotent).
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. The breadcrumb title is „Talie fiszek”.
 * 2. The scope select offers exactly „Wszystkie” / „Moje” — no legacy „Grupy” or
 *    „Udostępnione” option.
 * 3. The group filter is a single multi-select with the „Dowolna grupa” placeholder
 *    and the „Moje grupy” quick action (the educator belongs to `G1`).
 * 4. The educator's own decks are listed with their group badges: the group deck
 *    carries `G1`, the personal deck carries none.
 * 5. „Moje” narrows the list to the educator's own decks; „Wszystkie” brings the
 *    group-shared deck back.
 * 6. „Moje grupy” selects the educator's groups, leaves only the `G1` decks, marks
 *    itself disabled, and clearing the selection restores the full list.
 */

const CASE = 'EDU-DECK-01';

/** Polish copy from `EduFlashcardDecksPage` / `ScopeGroupFilter` (pl.json). */
const COPY = {
  title: 'Talie fiszek',
  ownerAll: 'Wszystkie',
  ownerMine: 'Moje',
  groupAny: 'Dowolna grupa',
  groupMine: 'Moje grupy',
} as const;

/** Decks the spec prepares in its own tenant; names are case-scoped. */
const DECKS = {
  ownGroup: 'EDU-DECK-01 własna grupowa',
  ownPersonal: 'EDU-DECK-01 własna osobista',
  shared: 'EDU-DECK-01 udostępniona',
} as const;

const DECKS_URL = '/api/v1/flashcards/decks';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckListResult {
  items: DeckListItem[];
  total: number;
  hasMore: boolean;
}

interface DeckListItem {
  id: string;
  name: string;
  created_by: string;
  visibility: 'personal' | 'group';
  groupIds: string[];
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `GET /api/v1/flashcards/decks` — the same list the screen renders. */
async function listDecks(page: Page): Promise<DeckListResult> {
  return getData<DeckListResult>(page, `${DECKS_URL}?sortBy=created_at&sortOrder=desc&limit=100`);
}

/** Polish plural for the deck counter line (`decks_count`). */
function decksCountLabel(count: number): string {
  if (count === 1) return '1 talia';
  if (count >= 2 && count <= 4) return `${count} talie`;
  return `${count} talii`;
}

/** The deck-list counter (`<p>{n} talii</p>`) must show the given total. */
async function expectDecksCount(page: Page, count: number): Promise<void> {
  await expect(page.getByText(decksCountLabel(count), { exact: true })).toBeVisible();
}

/** The card of the deck with this name (the title is the card's `h3`). */
function deckCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/** Visible group badges on a card (the flashcard counter is a badge too). */
function visibleGroupBadges(card: Locator, groupName: string): Locator {
  return card.locator('[data-slot="badge"]:visible').filter({ hasText: groupName });
}

/**
 * The tenant seeder enrolls group members with the group `member` role, but only a
 * group `teacher` may share a deck to the group (`canShareContentToGroups`). Promote
 * the educator through the manager's own roster endpoint — the same write
 * `/manage/groups` performs — keeping every other member untouched.
 */
async function ensureEducatorLeadsGroup(page: Page, tenant: QaTenant): Promise<void> {
  const groupId = tenant.group?.id;
  const educator = tenant.users.teacher;
  if (!groupId || !educator) {
    throw new Error(`${CASE} needs the content tenant profile (org, group and educator)`);
  }

  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<GroupMemberRow[]>(page, url);
  const member = roster.find((row) => row.userId === educator.id);
  expect(member, 'the seeded educator is a member of the tenant group').toBeTruthy();
  if (member!.role === 'teacher') return;

  const response = await page.request.put(url, {
    data: {
      members: roster.map((row) =>
        row.userId === educator.id ? { userId: row.userId, role: 'teacher' } : row,
      ),
    },
  });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);

  const after = await getData<GroupMemberRow[]>(page, url);
  expect(
    after.find((row) => row.userId === educator.id)?.role,
    'the educator now teaches the tenant group',
  ).toBe('teacher');
}

/**
 * Create one of the case's decks if the tenant does not have it yet. Idempotent so
 * a re-run on an already-seeded tenant (CI seeds one tenant per spec without a
 * fresh suffix) neither fails on duplicates nor depends on another run's leftovers.
 */
async function ensureDeck(
  page: Page,
  name: string,
  data: { visibility: 'personal' | 'group'; groupIds?: string[] },
): Promise<DeckListItem> {
  const existing = (await listDecks(page)).items.find((deck) => deck.name === name);
  if (existing) return existing;

  const response = await page.request.post(DECKS_URL, { data: { name, ...data } });
  expect(
    response.status(),
    `POST ${DECKS_URL} (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<DeckListItem>;
  expect(body.success, `POST ${DECKS_URL} (${name}) success flag`).toBe(true);
  return body.data;
}

/**
 * Prepare the tenant's content: the manager shares a deck to the tenant group, then
 * the educator creates its own personal and group decks. Runs through the product
 * API so RBAC and the share rule decide what is allowed.
 */
async function prepareTenant(page: Page, tenant: QaTenant): Promise<void> {
  const groupId = tenant.group?.id;
  if (!groupId) throw new Error(`${CASE} needs the content tenant profile (org + group)`);

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  await ensureEducatorLeadsGroup(page, tenant);
  await ensureDeck(page, DECKS.shared, { visibility: 'group', groupIds: [groupId] });

  await page.context().clearCookies();
  await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
  await ensureDeck(page, DECKS.ownGroup, { visibility: 'group', groupIds: [groupId] });
  await ensureDeck(page, DECKS.ownPersonal, { visibility: 'personal' });
}

test.describe('@case:EDU-DECK-01 @area:EDU @prio:P2 educator flashcard deck hub', () => {
  test('shows the deck list with the scope and group filters', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const group = tenant.group;
    const educator = tenant.users.teacher;
    if (!group || !educator) {
      throw new Error(`${CASE} needs the content tenant profile (org, group and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await prepareTenant(page, tenant);

    // --- Step 1: the educator's deck hub -----------------------------------
    await page.goto('/edu/flashcards');
    await expect(page).toHaveURL(/\/edu\/flashcards$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.locator('[data-slot="breadcrumb"]').getByText(COPY.title, { exact: true }),
    ).toBeVisible();

    // The page must mirror this tenant's own set: two educator decks and the one
    // the manager shared to G1 (visible through the educator's group read scope).
    const initial = await listDecks(page);
    expect(initial.total, 'decks readable by the educator').toBe(3);
    expect(
      initial.items.filter((deck) => deck.created_by === educator.id),
      'decks owned by the educator',
    ).toHaveLength(2);
    expect(
      initial.items.find((deck) => deck.name === DECKS.shared)?.groupIds,
      'the manager deck is shared to the tenant group',
    ).toEqual([group.id]);

    await expectDecksCount(page, 3);
    for (const name of Object.values(DECKS)) {
      await expect(deckCard(page, name), `card "${name}"`).toBeVisible();
    }

    // Group badges: both group decks carry G1, the personal deck carries none.
    await expect(
      visibleGroupBadges(deckCard(page, DECKS.ownGroup), group.name),
      'own group deck badge',
    ).toHaveCount(1);
    await expect(
      visibleGroupBadges(deckCard(page, DECKS.shared), group.name),
      'shared group deck badge',
    ).toHaveCount(1);
    await expect(
      visibleGroupBadges(deckCard(page, DECKS.ownPersonal), group.name),
      'personal deck has no group badge',
    ).toHaveCount(0);

    // --- Step 2a: the scope filter -----------------------------------------
    // Radix `Select` triggers expose their value as the control's value, not its
    // accessible name, so the owner select is the one quoting „Wszystkie”.
    const ownerSelect = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: COPY.ownerAll });
    await expect(ownerSelect).toBeVisible();
    await ownerSelect.click();

    const ownerOptions = page.getByRole('option');
    await expect(ownerOptions).toHaveCount(2);
    await expect(ownerOptions.nth(0)).toHaveText(COPY.ownerAll);
    await expect(ownerOptions.nth(1)).toHaveText(COPY.ownerMine);
    // The retired toggles must not come back as extra scope options.
    await expect(page.getByRole('option', { name: 'Grupy', exact: true })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Udostępnione', exact: true })).toHaveCount(0);

    const mineRequest = page.waitForRequest((request) => {
      if (!request.url().includes(`${DECKS_URL}?`)) return false;
      return new URL(request.url()).searchParams.get('owner') === 'mine';
    });
    await page.getByRole('option', { name: COPY.ownerMine, exact: true }).click();
    await mineRequest;

    await expectDecksCount(page, 2);
    await expect(deckCard(page, DECKS.ownGroup)).toBeVisible();
    await expect(deckCard(page, DECKS.ownPersonal)).toBeVisible();
    await expect(deckCard(page, DECKS.shared), 'not the educator’s deck').toHaveCount(0);

    // Back to „Wszystkie”: the group-shared deck is readable again.
    await page.locator('[data-slot="select-trigger"]').filter({ hasText: COPY.ownerMine }).click();
    await page.getByRole('option', { name: COPY.ownerAll, exact: true }).click();
    await expectDecksCount(page, 3);
    await expect(deckCard(page, DECKS.shared)).toBeVisible();

    // --- Step 2b: the group filter -----------------------------------------
    // The group filter is the only combobox that is not a Radix `Select` trigger.
    const groupSelect = page.locator('button[role="combobox"]:not([data-slot="select-trigger"])');
    await expect(groupSelect).toContainText(COPY.groupAny);
    const mineGroups = page.getByRole('button', { name: COPY.groupMine, exact: true });
    await expect(mineGroups).toBeVisible();
    await expect(mineGroups).toBeEnabled();

    const groupRequest = page.waitForRequest((request) => {
      if (!request.url().includes(`${DECKS_URL}?`)) return false;
      return new URL(request.url()).searchParams.get('groups') === group.id;
    });
    await mineGroups.click();
    await groupRequest;

    await expectDecksCount(page, 2);
    await expect(groupSelect).toContainText(group.name);
    await expect(mineGroups).toBeDisabled();
    await expect(deckCard(page, DECKS.ownGroup)).toBeVisible();
    await expect(deckCard(page, DECKS.shared)).toBeVisible();
    await expect(deckCard(page, DECKS.ownPersonal), 'personal deck is outside G1').toHaveCount(0);

    // Clearing the group selection restores the placeholder and the full list.
    await groupSelect.click();
    await page.getByRole('option', { name: group.name, exact: true }).click();

    await expect(groupSelect).toContainText(COPY.groupAny);
    await expect(mineGroups).toBeEnabled();
    await expectDecksCount(page, 3);
    await expect(deckCard(page, DECKS.ownPersonal)).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
