import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
} from '#test/helpers/tenant-seed';

/**
 * EDU-DECK-03 — changing a deck's visibility „Tylko ja” ⇄ „Grupy” (/edu/flashcards
 * → /app/flashcards).
 *
 * Prerequisite (reconciled with the tenant seeder): the deck from EDU-DECK-02,
 * i.e. an educator of an organization whose group `G1` holds a student, with a
 * group-visible deck shared to that group. The case's legacy accounts
 * (`teacher1@dev.local`, `student1..3`, password `pass`) are never used.
 *
 * Tenant: `tenantKey('qa/cases/EDU-DECK-03.md', 'EDU-DECK-03#<run>', 'qa-shared')`,
 * fresh run suffix per independent run. Every id is `tenantId(key, entity)`:
 *   - org A: the deck's organization, with groups `G1` (default, holds the student)
 *     and `G2` (second group the teacher leads) — the case's „dodaj drugą grupę”;
 *   - org B: a second organization the same teacher belongs to, with its own group
 *     `G3` — only there to prove the group picker stays inside the active org;
 *   - `teacher` (org role `teacher`, group teacher of G1/G2) and `student`
 *     (org A member and G1 member).
 *
 * `group.manage` comes from the org role the organization trigger seeds from the
 * default `launch` plan, and `canShareContentToGroups` requires the caller to be a
 * teacher of every selected group — hence the teacher owns the org and is enrolled
 * as `G2`'s teacher (the seeder only enrols the default group). Nothing global is
 * written: both organizations, the groups and the deck live in this tenant.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. „Nowa talia” → „Grupy” → `G1` → „Utwórz” answers „Talia utworzona”; the deck is
 *    stored `visibility: 'group'` with exactly `[G1]` and the student sees it
 *    read-only (the case says „Podgląd”, the product renders „Przeglądaj”, a P3 copy
 *    difference — the test asserts the read-only entry point, not the wording).
 * 2. „Edytuj” → „Tylko ja” → „Aktualizuj” answers „Talia zaktualizowana”, stores
 *    `visibility: 'personal'` and **clears the share links** (`groupIds: []`, no
 *    group badge): the student loses the deck — gone from the list, deck detail 404.
 * 3. „Edytuj” → „Grupy” requires at least one group again (submit disabled,
 *    „Wybierz co najmniej jedną grupę”); picking `G1` + `G2` restores the share with
 *    both groups, and the student sees the deck again.
 * 4. The group picker lists only groups of the **active** organization: `G1`, `G2`
 *    — never org B's `G3`, although the teacher belongs to it too.
 */

const CASE = 'EDU-DECK-03';
const CASE_FILE = 'qa/cases/EDU-DECK-03.md';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

const DECK_NAME = 'Matematyka – klasa 1';
const GROUP_NAME = 'G1';
const SECOND_GROUP_NAME = 'G2';
const OTHER_ORG_GROUP_NAME = 'G3';

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

/** Supabase local defaults (the service-role JWT is the `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface CaseTenant {
  key: string;
  group1: { id: string; name: string };
  group2: { id: string; name: string };
  otherOrgGroup: { id: string; name: string };
  /** The educator who owns the deck (org A, teacher of G1 + G2). */
  teacher: QaTenant;
  /** Org A student, member of G1 — the reader the case calls student1. */
  student: QaTenant;
}

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

function account(seed: { id: string; email: string; password: string }) {
  return { id: seed.id, email: seed.email, password: seed.password };
}

async function seedCaseTenant(): Promise<CaseTenant> {
  const key = tenantKey(CASE_FILE, `${CASE}#${RUN_SUFFIX}`, PROJECT);
  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  // Org A: the teacher owns the org (org role `teacher`) and its default group,
  // so it may create decks and share them with the groups it leads.
  const org = { id: tenantId(key, 'org'), name: `qa-edu-deck-03-${RUN_SUFFIX}` };
  const group1 = { id: tenantId(key, 'group:default'), name: GROUP_NAME };
  const group2 = { id: tenantId(key, 'group:second'), name: SECOND_GROUP_NAME };
  const teacher = buildAccount(key, 'teacher', 'educator', {
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });
  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { ...group1, isDefault: true },
    extraGroups: [{ ...group2, isDefault: false }],
    owner: teacher,
    members: [student],
    ownerOrgRole: 'teacher',
  });

  // `seedTenantGraph` enrols only the default group; the picker lists a group only
  // when it has a teacher, so enrol the owner as G2's teacher.
  const secondGroupTeacher = await db.from('group_members').upsert(
    {
      id: tenantId(key, 'gm:second:owner'),
      group_id: group2.id,
      user_id: teacher.id,
      role: 'teacher',
    },
    { onConflict: 'id' },
  );
  if (secondGroupTeacher.error) {
    throw new Error(`seed ${CASE}: group_members(G2) ${secondGroupTeacher.error.message}`);
  }

  // Org B: the same teacher is a member of another organization with its own group,
  // so a leaked cross-org option would be visible in the active-org picker.
  const otherKey = `${key}:other`;
  const otherOrg = { id: tenantId(otherKey, 'org'), name: `qa-edu-deck-03-other-${RUN_SUFFIX}` };
  const otherGroup = { id: tenantId(otherKey, 'group:default'), name: OTHER_ORG_GROUP_NAME };
  const otherManager = buildAccount(otherKey, 'manager', 'manager', { name: 'Other manager' });
  const seededOther = await seedTenantGraph(db, {
    key: otherKey,
    org: otherOrg,
    defaultGroup: { ...otherGroup, isDefault: true },
    extraGroups: [],
    owner: otherManager,
    members: [{ ...teacher, orgRole: 'teacher' }],
    ownerOrgRole: 'admin',
  });

  const base = {
    case: CASE,
    key,
    profile: 'content' as const,
    runSuffix: RUN_SUFFIX,
  };

  return {
    key,
    group1: { id: seeded.defaultGroupId!, name: GROUP_NAME },
    group2,
    otherOrgGroup: { id: seededOther.defaultGroupId!, name: OTHER_ORG_GROUP_NAME },
    teacher: {
      ...base,
      org,
      group: group1,
      users: {
        teacher: account(seeded.owner),
        student: account(seeded.members[0]),
      },
    },
    student: {
      ...base,
      org,
      group: group1,
      users: { student: account(seeded.members[0]) },
    },
  };
}

let tenant: CaseTenant;

test.beforeAll(async () => {
  tenant = await seedCaseTenant();
  console.log(`EDU-DECK-03 tenant key: ${tenant.key} (org ${tenant.teacher.org?.id})`);
});

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

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
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

test.describe('@case:EDU-DECK-03 @area:EDU @prio:P2 deck visibility', () => {
  test('switches a group deck to „Tylko ja” and back, and the group student follows', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Teacher: the EDU-DECK-02 deck, shared with G1 ─────────────────────
    await loginAs(page, tenant.teacher, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');
    await page.goto('/edu/flashcards');
    await expect(page).toHaveURL(/\/edu\/flashcards$/);

    await page.getByRole('button', { name: COPY.newDeck }).first().click();
    const createDialog = page.locator('[data-slot="dialog-content"]');
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByRole('heading', { name: COPY.createTitle })).toBeVisible();

    await createDialog.getByPlaceholder(COPY.namePlaceholder).fill(DECK_NAME);
    await createDialog.locator('label[for="visibility-group"]').click();

    // A group deck without a group cannot be submitted.
    await expect(createDialog.getByText(COPY.groupsRequired, { exact: true })).toBeVisible();
    await expect(createDialog.getByRole('button', { name: COPY.create })).toBeDisabled();

    // 4. The picker offers the active org's groups only — G3 belongs to org B.
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
    expect(created.groupIds, 'deck group share').toEqual([tenant.group1.id]);
    const deckId = created.id;

    // ── The G1 student sees the group deck, read-only ─────────────────────
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      await loginAs(studentPage, tenant.student, 'student', { locale: 'pl' });
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

      // ── Step 3: „Grupy” again, now with G1 + G2 ─────────────────────────
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
        tenant.group1.id,
        tenant.group2.id,
      ]);

      // ── Step 4: the student sees the deck again ─────────────────────────
      await studentPage.goto('/app/flashcards');
      const restoredStudentCard = deckCard(studentPage, DECK_NAME);
      await expect(restoredStudentCard).toBeVisible();
      // The student only knows G1; the G2 badge is not part of its group map.
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
