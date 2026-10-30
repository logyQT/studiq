import type { Page } from '@playwright/test';
import { expect, loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-DECK-02 — Utworzenie talii dla grupy (/edu/flashcards → /app/flashcards).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator in an active
 * organization, whose org role is `teacher`, is the teacher of the organization's
 * default group. The case's legacy accounts (`teacher1@dev.local`, `student1..3`,
 * password `pass`) are never used.
 *
 * Tenant: `__tests__/qa/profiles/EDU-DECK-02.json` — the `two-org` shape plus one
 * org-less account, seeded once before Playwright starts
 * (`bun scripts/qa-tenant.ts EDU-DECK-02 --fresh`) and read through
 * `loadTenant(CASE)`; the spec never seeds at runtime:
 *   - org A (`org`) — `teacherA` (org role `teacher`, group role `teacher`) shares
 *     the deck; `studentA` is a member of org A and of the default group `G1`;
 *   - org B (`orgB`) — `studentB`, a member of a different organization (its own
 *     group);
 *   - `standalone` (`solo`) — a student account that belongs to no organization.
 *
 * `group.manage` comes from the org role that the org trigger seeds from the
 * default `launch` plan, and `canShareContentToGroups` requires the caller to be
 * a *teacher* of the group — the seeder enrols `teacherA` as the default group's
 * teacher, exactly as the org's own group screen would. Nothing global is written:
 * the two organizations, the group and the deck all live in this tenant.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. „Nowa talia” with „Widoczność: Grupy” needs at least one group: the submit is
 *    disabled and „Wybierz co najmniej jedną grupę” is shown until the tenant group
 *    is picked.
 * 2. „Utwórz” answers the toast „Talia utworzona”; the teacher's card carries the
 *    group badge and the „Zarządzaj” affordance; the API stores the deck with
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
}

/** The `two-org` tenant the profile declares, plus its `solo` student. */
interface TwoOrgTenant extends QaTenant {
  orgA: TenantOrg;
  orgB: TenantOrg;
  users: NonNullable<QaTenant['users']> & {
    teacherA: TenantUser;
    studentA: TenantUser;
    studentB: TenantUser;
    standalone: TenantUser;
  };
}

const tenant = loadTenant(CASE) as TwoOrgTenant;

const DECK_NAME = 'Matematyka – klasa 1';

/** The default group of org A — the group the deck is shared with. */
const GROUP_NAME = tenant.group!.name;

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
    await loginAs(page, tenant, 'teacherA', { locale: 'pl' });
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
    expect(created!.groupIds, 'deck group share').toEqual([tenant.group!.id]);

    // ── The group's student sees the deck, read-only ──────────────────────
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      await loginAs(studentPage, tenant, 'studentA', { locale: 'pl' });
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
    const invisible: {
      label: string;
      role: 'studentB' | 'standalone';
      activeOrgId: string | null;
    }[] = [
      { label: 'another organization', role: 'studentB', activeOrgId: tenant.orgB.id },
      { label: 'no organization', role: 'standalone', activeOrgId: null },
    ];

    for (const candidate of invisible) {
      const context = await browser.newContext({ baseURL });
      try {
        const outsider = await context.newPage();
        await loginAs(outsider, tenant, candidate.role, {
          locale: 'pl',
          activeOrgId: candidate.activeOrgId,
        });
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
