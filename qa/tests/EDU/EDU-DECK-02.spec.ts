import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  ensureAccount,
  randomTag,
  seedTenantGraph,
  tenantId,
} from '#test/helpers/tenant-seed';

/**
 * EDU-DECK-02 — Utworzenie talii dla grupy (/edu/flashcards → /app/flashcards).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator in an active
 * organization, whose org role is `teacher`, is the teacher of the organization's
 * default group. The case's legacy accounts (`teacher1@dev.local`, `student1..3`,
 * password `pass`) are never used.
 *
 * Tenant: `tenantKey('qa/cases/EDU-DECK-02.md', 'EDU-DECK-02#<run>', 'qa-shared')`,
 * fresh run suffix per independent run. Every id is `tenantId(key, entity)`:
 *   - org A: the group-deck org; `teacher` (org role `teacher`, group role
 *     `teacher`) owns it, `student` is a member of org A and of group `G1`;
 *   - org B: `student2` — a member of a different organization (its own group);
 *   - `student3` — a standalone student account that belongs to no organization.
 *
 * `group.manage` comes from the org role that the org trigger seeds from the
 * default `launch` plan, and `canShareContentToGroups` requires the caller to be
 * a *teacher* of the group — hence the teacher is the group owner rather than a
 * patched row. Nothing global is written: the two organizations, the group and
 * the deck all live in this tenant.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. „Nowa talia” with „Widoczność: Grupy” needs at least one group: the submit is
 *    disabled and „Wybierz co najmniej jedną grupę” is shown until G1 is picked.
 * 2. „Utwórz” answers the toast „Talia utworzona”; the teacher's card carries the
 *    group badge (G1) and the „Zarządzaj” affordance; the API stores the deck with
 *    `visibility: 'group'` and exactly the selected `groupIds`.
 * 3. The group's student sees the same deck in /app/flashcards with the group
 *    badge and a read-only affordance — the case says „Podgląd”, the product
 *    renders `Common.common_view` („Przeglądaj”), a P3 copy difference, so the
 *    test asserts the read-only behaviour (no edit/delete entry point) instead of
 *    freezing the wording.
 * 4. A student of another organization and a student without an organization do
 *    not see the deck, neither in the list API nor in the UI.
 */

const CASE = 'EDU-DECK-02';
const CASE_FILE = 'qa/cases/EDU-DECK-02.md';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

const DECK_NAME = 'Matematyka – klasa 1';
const GROUP_NAME = 'G1';
const OTHER_GROUP_NAME = 'G2';

/** Polish copy the case quotes, as rendered by the current product. */
const COPY = {
  newDeck: 'Nowa talia',
  dialogTitle: 'Utwórz talię',
  namePlaceholder: 'np. Biologia Rozdział 1',
  groupVisibility: 'Grupy',
  groupsRequired: 'Wybierz co najmniej jedną grupę',
  create: 'Utwórz',
  created: 'Talia utworzona',
  manage: 'Zarządzaj',
  view: 'Przeglądaj',
  edit: 'Edytuj',
  deleteItem: 'Usuń',
  noDecks: '0 talii',
};

/** Supabase local defaults (the service-role JWT is the `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface CaseTenant {
  key: string;
  /** Org A — the group deck's organization, with its teacher and student. */
  org: QaTenant;
  /** The same org, addressed as the student who should see the deck. */
  memberStudent: QaTenant;
  /** Org B — a different organization with its own student. */
  otherOrg: QaTenant;
  /** A student account that belongs to no organization. */
  standalone: QaTenant;
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

  // Org A: the teacher is the group's teacher, so it may share content with it.
  const org = { id: tenantId(key, 'org'), name: `qa-edu-deck-02-${RUN_SUFFIX}` };
  const group = { id: tenantId(key, 'group:default'), name: GROUP_NAME };
  const teacher = buildAccount(key, 'teacher', 'educator', {
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });
  const seededOrg = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { ...group, isDefault: true },
    extraGroups: [],
    owner: teacher,
    members: [student],
    ownerOrgRole: 'teacher',
  });

  // Org B: an unrelated organization, with its own default group and member.
  const otherKey = `${key}:other`;
  const otherOrg = { id: tenantId(otherKey, 'org'), name: `qa-edu-deck-02-other-${RUN_SUFFIX}` };
  const otherManager = buildAccount(otherKey, 'manager', 'manager', { name: 'Other manager' });
  const otherStudent = buildAccount(otherKey, 'student', 'student', { name: 'Other student' });
  const seededOther = await seedTenantGraph(db, {
    key: otherKey,
    org: otherOrg,
    defaultGroup: {
      id: tenantId(otherKey, 'group:default'),
      name: OTHER_GROUP_NAME,
      isDefault: true,
    },
    extraGroups: [],
    owner: otherManager,
    members: [otherStudent],
    ownerOrgRole: 'admin',
  });

  // A standalone student: the auth account exists, but no organization membership.
  const standalone = await ensureAccount(
    db,
    buildAccount(key, 'standalone', 'student', { name: 'Standalone student' }),
  );

  const base = {
    case: CASE,
    key,
    profile: 'content' as const,
    runSuffix: RUN_SUFFIX,
  };

  return {
    key,
    org: {
      ...base,
      org,
      group,
      users: {
        teacher: account(seededOrg.owner),
        student: account(seededOrg.members[0]),
      },
    },
    memberStudent: {
      ...base,
      org,
      group,
      users: { student: account(seededOrg.members[0]) },
    },
    otherOrg: {
      ...base,
      key: otherKey,
      org: otherOrg,
      group: { id: seededOther.defaultGroupId!, name: OTHER_GROUP_NAME },
      users: { student: account(seededOther.members[0]) },
    },
    standalone: {
      ...base,
      org: null,
      group: null,
      users: { student: account(standalone) },
    },
  };
}

let tenant: CaseTenant;

test.beforeAll(async () => {
  tenant = await seedCaseTenant();
  console.log(`EDU-DECK-02 tenant key: ${tenant.key} (org ${tenant.org.org?.id})`);
});

/** A deck card in the grid, addressed by its own heading so no sibling matches. */
function deckCard(page: Page, name: string) {
  return page
    .locator('main .group:visible')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .first();
}

/**
 * The shared-group badge inside a card. Each card renders a mobile and a desktop
 * copy, so the locator is pinned to the one the current breakpoint shows.
 */
function groupBadge(page: Page, groupName: string) {
  return deckCard(page, DECK_NAME).locator('[data-slot="badge"]:visible', { hasText: groupName });
}

test.describe('@case:EDU-DECK-02 @area:EDU @prio:P1 group deck', () => {
  test('shares a new deck with its group and only that group’s students see it', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const dialog = page.locator('[data-slot="dialog-content"]');

    // ── Teacher creates the group deck through /edu/flashcards ────────────
    await loginAs(page, tenant.org, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');
    await page.goto('/edu/flashcards');

    await page.getByRole('button', { name: COPY.newDeck }).first().click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: COPY.dialogTitle })).toBeVisible();

    await dialog.getByPlaceholder(COPY.namePlaceholder).fill(DECK_NAME);
    await dialog.getByText(COPY.groupVisibility, { exact: true }).click();

    // 1. A group deck without a group cannot be submitted.
    await expect(dialog.getByText(COPY.groupsRequired, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.create })).toBeDisabled();

    await dialog.getByRole('combobox').click();
    const option = page
      .locator('[data-slot="popover-content"]')
      .getByRole('option', { name: GROUP_NAME });
    await expect(option).toBeVisible();
    await option.click();
    await expect(dialog.getByRole('combobox')).toContainText(GROUP_NAME);

    // The multi-select keeps its popover open after a pick; the dialog title
    // closes it without touching the rest of the form.
    await dialog.getByRole('heading', { name: COPY.dialogTitle }).click();
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);

    const create = dialog.getByRole('button', { name: COPY.create });
    await expect(create).toBeEnabled();
    await create.click();

    // 2. Toast, card badge and manage affordance for the teacher.
    await expect(page.getByText(COPY.created, { exact: true }).first()).toBeVisible();
    await expect(dialog).toHaveCount(0);

    const teacherCard = deckCard(page, DECK_NAME);
    await expect(teacherCard).toBeVisible();
    await expect(groupBadge(page, GROUP_NAME)).toHaveText(GROUP_NAME);
    await expect(teacherCard.getByRole('button', { name: COPY.manage })).toBeVisible();

    // The stored deck is group-visible and shared with exactly this group.
    const listResponse = await page.request.get('/api/v1/flashcards/decks');
    expect(listResponse.status(), 'GET /api/v1/flashcards/decks').toBe(200);
    const list = (await listResponse.json()) as {
      data: { items: { id: string; name: string; visibility?: string; groupIds?: string[] }[] };
    };
    const created = list.data.items.find((deck) => deck.name === DECK_NAME);
    expect(created, 'the new deck is listed for its creator').toBeTruthy();
    expect(created!.visibility, 'deck visibility').toBe('group');
    expect(created!.groupIds, 'deck group share').toEqual([tenant.org.group!.id]);

    // ── The group's student sees the deck, read-only ──────────────────────
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      await loginAs(studentPage, tenant.memberStudent, 'student', { locale: 'pl' });
      expect(new URL(studentPage.url()).pathname, 'student lands on /app').toBe('/app');
      await studentPage.goto('/app/flashcards');

      const studentCard = deckCard(studentPage, DECK_NAME);
      await expect(studentCard).toBeVisible();
      await expect(groupBadge(studentPage, GROUP_NAME)).toHaveText(GROUP_NAME);
      // 3. Read-only affordance, and no edit/delete entry point anywhere on the card.
      await expect(studentCard.getByRole('button', { name: COPY.view })).toBeVisible();
      await expect(studentCard.getByRole('button', { name: COPY.manage })).toHaveCount(0);

      await studentCard.getByRole('button', { name: `Więcej akcji: ${DECK_NAME}` }).click();
      await expect(studentPage.getByRole('menuitem', { name: COPY.edit })).toHaveCount(0);
      await expect(studentPage.getByRole('menuitem', { name: COPY.deleteItem })).toHaveCount(0);
    } finally {
      await studentContext.close();
    }

    // ── Neither a student of another org nor a student without an org ─────
    const invisible: { label: string; tenant: QaTenant }[] = [
      { label: 'another organization', tenant: tenant.otherOrg },
      { label: 'no organization', tenant: tenant.standalone },
    ];

    for (const candidate of invisible) {
      const context = await browser.newContext({ baseURL });
      try {
        const outsider = await context.newPage();
        await loginAs(outsider, candidate.tenant, 'student', { locale: 'pl' });
        await outsider.goto('/app/flashcards');
        // The list has resolved once its (empty) count is rendered.
        await expect(outsider.getByText(COPY.noDecks, { exact: true })).toBeVisible();
        await expect(
          outsider.getByRole('heading', { name: DECK_NAME, exact: true }),
          `the deck is invisible to a student with ${candidate.label}`,
        ).toHaveCount(0);

        const response = await outsider.request.get('/api/v1/flashcards/decks');
        expect(response.status(), `deck list for ${candidate.label}`).toBe(200);
        const body = (await response.json()) as { data: { items: { id: string }[] } };
        expect(
          body.data.items.map((deck) => deck.id),
          `the deck id must not leak to a student with ${candidate.label}`,
        ).not.toContain(created!.id);
      } finally {
        await context.close();
      }
    }
  });
});
