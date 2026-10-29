import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  request as apiRequest,
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * STU-14 — deck list: ownership filter and group filter (/app/flashcards).
 *
 * Prerequisite (reconciled with the tenant seeder): a student who is a member of
 * exactly one group of an organization. The case's legacy account
 * (`student1@dev.local`, password `pass`) and its O1G1/O1G2 content are never
 * used; the spec owns the whole graph.
 *
 * Tenant: `tenantKey('qa/cases/STU-14.md', 'STU-14#<run>', 'qa-shared')`, a fresh
 * run suffix per independent run. Every id is `tenantId(key, entity)`:
 *   - org: one organization, default group `O1G1` and a second group `O1G2`;
 *   - `teacher`: org role `teacher`, the teacher of both groups, so it may share
 *     a deck with either of them;
 *   - `student`: org member, a member of `O1G1` only (never of `O1G2`).
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
const CASE_FILE = 'qa/cases/STU-14.md';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

const GROUP_G1 = 'O1G1';
const GROUP_G2 = 'O1G2';
const GROUP_DECK = 'O1G1T1';
const OTHER_GROUP_DECK = 'O1G2T2';
const PERSONAL_DECK = 'O1S1';

/** Polish copy the case quotes, as rendered by the current product. */
const COPY = {
  ownerAll: 'Wszystkie',
  ownerMine: 'Moje',
  groupAny: 'Dowolna grupa',
  groupMine: 'Moje grupy',
  twoDecks: '2 talie',
  oneDeck: '1 talia',
  retiredGroupScope: 'Grupy',
  retiredSharedScope: 'Udostępnione',
} as const;

/** Supabase local defaults (the service-role JWT is the `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface CaseTenant extends QaTenant {
  users: {
    teacher: { id: string; email: string; password: string };
    student: { id: string; email: string; password: string };
  };
}

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

function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url:
      process.env.QA_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      fromEnvJson ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

function account(seed: SeedAccount) {
  return { id: seed.id, email: seed.email, password: seed.password };
}

/**
 * Seed the org graph. The teacher is the org's `teacher` (and the default
 * group's teacher), the student is a plain member of `O1G1` only. `O1G2` gets the
 * teacher as its teacher so the second group deck is legitimate, never injected
 * as a row the API would have refused.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const key = tenantKey(CASE_FILE, `${CASE}#${RUN_SUFFIX}`, PROJECT);
  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const org = { id: tenantId(key, 'org'), name: `qa-stu-14-${RUN_SUFFIX}` };
  const groupG1 = { id: tenantId(key, 'group:default'), name: GROUP_G1 };
  const groupG2 = { id: tenantId(key, 'group:second'), name: GROUP_G2 };
  const teacher = buildAccount(key, 'teacher', 'educator', {
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { ...groupG1, isDefault: true },
    extraGroups: [{ ...groupG2, isDefault: false }],
    owner: teacher,
    members: [student],
    ownerOrgRole: 'teacher',
  });

  // Sharing to a group requires a `teacher` group membership; the seeder only
  // enrols the owner in the default group.
  const secondGroupTeacher = await db.from('group_members').upsert(
    {
      id: tenantId(key, 'gm:second:teacher'),
      group_id: groupG2.id,
      user_id: teacher.id,
      role: 'teacher',
    },
    { onConflict: 'id' },
  );
  if (secondGroupTeacher.error) {
    throw new Error(`seed ${key}: group_members(O1G2) ${secondGroupTeacher.error.message}`);
  }

  return {
    case: CASE,
    profile: 'content',
    runSuffix: RUN_SUFFIX,
    key,
    org,
    group: groupG1,
    users: {
      teacher: account(seeded.owner),
      student: account(seeded.members[0]),
    },
  };
}

let tenant: CaseTenant;

test.beforeAll(async () => {
  tenant = await seedCaseTenant();
  console.log(`STU-14 tenant key: ${tenant.key} (org ${tenant.org?.id})`);
});

/** A visible deck card in the grid, addressed by its own heading. */
function deckCard(page: Page, name: string) {
  return page
    .locator('main .group:visible')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/** The scope select (`Wszystkie | Moje`) — first combobox in the toolbar. */
function ownerSelect(page: Page) {
  return page.getByRole('combobox').first();
}

/** The group multi-select trigger — the only popover-style combobox. */
function groupFilter(page: Page) {
  return page.locator('main button[role="combobox"][aria-haspopup="dialog"]');
}

async function createDeckAs(
  api: APIRequestContext,
  data: { name: string; visibility?: 'personal' | 'group'; groupIds?: string[] },
): Promise<DeckRow> {
  const response = await api.post('/api/v1/flashcards/decks', { data });
  expect(response.status(), `POST /api/v1/flashcards/decks (${data.name})`).toBe(201);
  const body = (await response.json()) as { data: DeckRow };
  return body.data;
}

test.describe('STU-14 @area:STU @prio:P2 deck list filters', () => {
  test('lists the group and personal decks and filters them by owner and group', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    // ── Build the tenant content through the API ─────────────────────────────
    const teacherApi = await apiRequest.newContext({ baseURL });
    let groupDeck: DeckRow;
    let otherGroupDeck: DeckRow;
    try {
      const login = await teacherApi.post('/api/v1/auth/login', {
        data: { email: tenant.users.teacher.email, password: tenant.users.teacher.password },
      });
      expect(login.status(), 'teacher login').toBe(200);
      const switched = await teacherApi.post('/api/v1/me/orgs/switch', {
        data: { orgId: tenant.org!.id },
      });
      expect(switched.status(), 'teacher org switch').toBe(200);

      groupDeck = await createDeckAs(teacherApi, {
        name: GROUP_DECK,
        visibility: 'group',
        groupIds: [tenant.group!.id],
      });
      otherGroupDeck = await createDeckAs(teacherApi, {
        name: OTHER_GROUP_DECK,
        visibility: 'group',
        groupIds: [tenantId(tenant.key, 'group:second')],
      });

      // Guard the fixture itself: the deck the student must NOT see really exists
      // and is shared with a different group.
      const teacherList = await teacherApi.get('/api/v1/flashcards/decks');
      expect(teacherList.status(), 'teacher deck list').toBe(200);
      const teacherDecks = ((await teacherList.json()) as DeckListBody).data.items;
      expect(
        teacherDecks.find((deck) => deck.id === otherGroupDeck.id)?.groupIds,
        'O1G2T2 is shared with O1G2',
      ).toEqual([tenantId(tenant.key, 'group:second')]);
    } finally {
      await teacherApi.dispose();
    }

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });
    const personalDeck = await createDeckAs(page.request, { name: PERSONAL_DECK });
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

    // ── Step 2: „Wszystkie” → „Moje” ─────────────────────────────────────────
    await expect(ownerSelect(page)).toContainText(COPY.ownerAll);
    await ownerSelect(page).click();
    // The retired group-scope options are gone: only the two ownership scopes.
    await expect(page.getByRole('option')).toHaveText([COPY.ownerAll, COPY.ownerMine]);
    await expect(page.getByRole('option', { name: COPY.retiredGroupScope })).toHaveCount(0);
    await expect(page.getByRole('option', { name: COPY.retiredSharedScope })).toHaveCount(0);

    await page.getByRole('option', { name: COPY.ownerMine, exact: true }).click();

    await expect(ownerSelect(page)).toContainText(COPY.ownerMine);
    await expect(page.getByText(COPY.oneDeck, { exact: true })).toBeVisible();
    await expect(deckCard(page, PERSONAL_DECK), '„Moje” keeps the personal deck').toHaveCount(1);
    await expect(deckCard(page, GROUP_DECK), '„Moje” drops the teacher’s group deck').toHaveCount(
      0,
    );

    // ── Step 3: „Moje grupy”, then clear back to „Dowolna grupa” ─────────────
    await ownerSelect(page).click();
    await page.getByRole('option', { name: COPY.ownerAll, exact: true }).click();
    await expect(page.getByText(COPY.twoDecks, { exact: true })).toBeVisible();

    const groupSelect = groupFilter(page);
    await expect(groupSelect).toHaveCount(1);
    await expect(groupSelect).toContainText(COPY.groupAny);
    // A student is offered only the groups they belong to.
    await groupSelect.click();
    await expect(page.getByRole('option')).toHaveText([GROUP_G1]);
    await page.keyboard.press('Escape');

    const mineGroups = page.getByRole('button', { name: COPY.groupMine, exact: true });
    await expect(mineGroups).toBeEnabled();
    await mineGroups.click();

    await expect(groupSelect).toContainText(GROUP_G1);
    await expect(page.getByText(COPY.oneDeck, { exact: true })).toBeVisible();
    await expect(deckCard(page, GROUP_DECK), 'the group filter keeps the shared deck').toHaveCount(
      1,
    );
    await expect(
      deckCard(page, PERSONAL_DECK),
      'the group filter drops the personal deck',
    ).toHaveCount(0);
    await expect(mineGroups, '„Moje grupy” is a no-op once applied').toBeDisabled();

    // Clearing the selection restores „Dowolna grupa” and the unfiltered list.
    await groupSelect.locator('span[role="button"]').click();
    await expect(groupSelect).toContainText(COPY.groupAny);
    await expect(page.getByText(COPY.twoDecks, { exact: true })).toBeVisible();
    await expect(deckCard(page, GROUP_DECK)).toHaveCount(1);
    await expect(deckCard(page, PERSONAL_DECK)).toHaveCount(1);
    await expect(mineGroups).toBeEnabled();

    // ── API contract behind the two filters ──────────────────────────────────
    const mine = await page.request.get('/api/v1/flashcards/decks?owner=mine');
    expect(mine.status(), 'GET decks?owner=mine').toBe(200);
    expect(
      ((await mine.json()) as DeckListBody).data.items.map((deck) => deck.id),
      'owner=mine returns exactly the student’s own deck',
    ).toEqual([personalDeck.id]);

    const byGroup = await page.request.get(`/api/v1/flashcards/decks?groups=${tenant.group!.id}`);
    expect(byGroup.status(), 'GET decks?groups=O1G1').toBe(200);
    expect(
      ((await byGroup.json()) as DeckListBody).data.items.map((deck) => deck.id),
      'groups=O1G1 returns exactly the deck shared with that group',
    ).toEqual([groupDeck.id]);

    // A foreign group id cannot widen the caller’s RBAC scope.
    const foreignGroup = await page.request.get(
      `/api/v1/flashcards/decks?groups=${tenantId(tenant.key, 'group:second')}`,
    );
    expect(foreignGroup.status(), 'GET decks?groups=O1G2').toBe(200);
    expect(
      ((await foreignGroup.json()) as DeckListBody).data.items,
      'the other group’s deck id never leaks',
    ).toHaveLength(0);

    // The retired `groupFilter` toggle is rejected, not silently ignored (#595).
    const retired = await page.request.get('/api/v1/flashcards/decks?groupFilter=mine');
    expect(retired.status(), 'GET decks?groupFilter=mine').toBe(422);
  });
});
