import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-15 — Utworzenie talii (`/app/flashcards`).
 *
 * Case steps: click „Nowa talia”, enter the name „Biologia – rozdział 1” and the
 * description „Komórka”, leave the visibility at „Tylko ja”, click „Utwórz”.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-15 --fresh
 *
 * gives the org `qa-stu-15-<suffix>` with a manager, an educator and a student,
 * where every id derives from
 * `tenantKey('qa/cases/STU-15.md', 'STU-15#<suffix>', 'qa-shared')` + `tenantId`.
 * Nothing global is read or written — no admin setting, feature flag, plan,
 * platform stat or singleton row. The deck is created through the product UI and
 * lives only in this tenant.
 *
 * The case was written against the legacy seed (`student1@dev.local`, password
 * `pass`); the suite version uses the tenant student and its default password.
 *
 * Acceptance points (walked on the shared app before writing the test):
 * 1. „Nowa talia” opens the „Utwórz talię” dialog with a name and an optional
 *    description field; „Utwórz” creates the deck and the list shows the
 *    „Talia utworzona” toast.
 * 2. The new deck is listed with the case's name and description, a „0 fiszek”
 *    badge and the owner's „Zarządzaj” label.
 * 3. „Tylko ja” is the deck's resulting visibility: a tenant student cannot share
 *    with groups (the dialog only renders the visibility switch for callers with
 *    `group.manage`), so the created deck is stored as `personal`.
 * 4. Adjacent regression for the ownership label: a group deck shared to the
 *    student's group by the tenant manager renders „Przeglądaj”, not „Zarządzaj”,
 *    while the student's own deck keeps „Zarządzaj”. The label is the source of
 *    truth for who may manage the deck, so it must not be a constant.
 * 5. Adjacent regression for the manage path: „Zarządzaj” opens the deck detail
 *    of that same deck (empty, „0 fiszek”), not another list item.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from another case cannot change it.
 */

const CASE = 'STU-15';

const DECK_NAME = 'Biologia – rozdział 1';
const DECK_DESCRIPTION = 'Komórka';

/** Polish copy from `AppFlashcardDecksPage` / `Common` (pl.json). */
const COPY = {
  newDeck: 'Nowa talia',
  createTitle: 'Utwórz talię',
  createDesc: 'Utwórz kolekcję fiszek',
  create: 'Utwórz',
  deckCreated: 'Talia utworzona',
  manageDeck: 'Zarządzaj',
  viewDeck: 'Przeglądaj',
  flashcardsZero: '0 fiszek',
  decksZero: '0 talii',
  emptyDecks: /stwórz swoją pierwszą talię/,
  emptyDeck: /stwórz swoją pierwszą fiszkę/,
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckItem {
  id: string;
  name: string;
  description: string | null;
  visibility: 'personal' | 'group';
  created_by: string;
  flashcard_count: number;
}

/** `GET` a deck-list page as the signed-in student and unwrap the envelope. */
async function listDecks(page: Page): Promise<DeckItem[]> {
  const response = await page.request.get('/api/v1/flashcards/decks?limit=200');
  expect(
    response.status(),
    `GET /api/v1/flashcards/decks → ${response.status()} ${await response.text()}`,
  ).toBe(200);
  const body = (await response.json()) as ApiEnvelope<{ items: DeckItem[] }>;
  expect(body.success, 'deck list success flag').toBe(true);
  return body.data.items;
}

/** The list card that owns a given deck name (deck cards are `data-slot="card"`). */
function deckCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.getByText(name, { exact: true }) });
}

/**
 * `DeckCard` renders a mobile and a desktop variant of every card, both in the DOM
 * (one is CSS-hidden per breakpoint), so text assertions must target the visible one.
 */
function visible(locator: Locator): Locator {
  return locator.filter({ visible: true });
}

/**
 * The case's group deck: created by the tenant manager (the only account that is a
 * teacher in the tenant's default group, so it may share to it) through the product
 * API, in its own browser context so the student session is untouched.
 *
 * It is the control for the „Zarządzaj” label: the student can read the deck
 * (`deck.read` = group) but cannot manage it, so it must render „Przeglądaj”.
 */
async function createGroupDeck(
  browser: Browser,
  tenant: QaTenant,
  page: Page,
): Promise<{ name: string; id: string }> {
  const org = tenant.org;
  const group = tenant.group;
  const manager = tenant.users.manager;
  if (!org || !group || !manager) {
    throw new Error(`${CASE} needs the content tenant profile (org, group, manager)`);
  }

  // Same origin as the student page, so the cookies the app sets are reused.
  const origin = new URL(page.url()).origin;
  const host = new URL(origin).hostname;
  const context = await browser.newContext({ baseURL: origin });
  try {
    const login = await context.request.post('/api/v1/auth/login', {
      data: { email: manager.email, password: manager.password },
    });
    expect(
      login.status(),
      `manager login (${manager.email}) → ${login.status()} ${await login.text()}`,
    ).toBe(200);

    // The app only writes `active_org_id` when an org is created or switched.
    await context.addCookies([
      { name: 'active_org_id', value: org.id, domain: host, path: '/', httpOnly: true },
    ]);

    const name = `${CASE} talia grupowa ${tenant.runSuffix ?? 'stable'}`;
    const response = await context.request.post('/api/v1/flashcards/decks', {
      data: { name, visibility: 'group', groupIds: [group.id] },
    });
    expect(
      response.status(),
      `POST /api/v1/flashcards/decks (group deck) → ${response.status()} ${await response.text()}`,
    ).toBe(201);
    const body = (await response.json()) as ApiEnvelope<DeckItem>;
    expect(body.data.visibility, 'the manager created a group deck').toBe('group');
    expect(body.data.flashcard_count, 'the group deck starts empty').toBe(0);
    return { name, id: body.data.id };
  } finally {
    await context.close();
  }
}

test.describe('@case:STU-15 @area:STU @prio:P1 create a deck', () => {
  test('creates “Biologia – rozdział 1” as a personal deck with 0 cards and the owner label', async ({
    page,
    browser,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    const student = tenant.users.student;
    if (!student) throw new Error(`${CASE} needs the content tenant profile (student)`);
    expect(tenant.org, 'the student under test belongs to the tenant organization').toBeTruthy();
    expect(tenant.group, 'the tenant has the default group the student belongs to').toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Precondition: a student on /app with an empty deck list ─────────────
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(
      (await listDecks(page)).map((deck) => deck.name),
      'a fresh tenant owns no deck yet',
    ).not.toContain(DECK_NAME);

    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    await expect(page.getByText(COPY.decksZero, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.emptyDecks).first()).toBeVisible();

    // ── Step 1: „Nowa talia” opens the create dialog ────────────────────────
    // The toolbar button is rendered before the empty-state one in DOM order.
    await page.getByRole('button', { name: COPY.newDeck, exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(COPY.createTitle, { exact: true })).toBeVisible();
    await expect(dialog.getByText(COPY.createDesc, { exact: true })).toBeVisible();

    // ── Step 2: the case's name and description ─────────────────────────────
    const nameInput = dialog.locator('input');
    const descriptionInput = dialog.locator('textarea');
    await expect(nameInput).toHaveValue('');
    await expect(descriptionInput).toHaveValue('');
    await nameInput.fill(DECK_NAME);
    await descriptionInput.fill(DECK_DESCRIPTION);
    await expect(nameInput).toHaveValue(DECK_NAME);
    await expect(descriptionInput).toHaveValue(DECK_DESCRIPTION);

    // ── Step 3: „Tylko ja” + „Utwórz” ───────────────────────────────────────
    // The student has no `group.manage`, so the dialog offers no group sharing and
    // the create call is the personal default the case leaves untouched.
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/flashcards/decks',
    );
    await dialog.getByRole('button', { name: COPY.create, exact: true }).click();
    const created = await createdResponse;
    expect(
      created.status(),
      `POST /api/v1/flashcards/decks → ${created.status()} ${await created.text()}`,
    ).toBe(201);

    // ── Expected: the toast, and the deck in the list with 0 cards ──────────
    await expect(page.getByText(COPY.deckCreated, { exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);

    const createdDeck = ((await created.json()) as ApiEnvelope<DeckItem>).data;
    expect(createdDeck.name, 'the deck keeps the case’s name').toBe(DECK_NAME);
    expect(createdDeck.description, 'the deck keeps the case’s description').toBe(DECK_DESCRIPTION);
    expect(createdDeck.visibility, 'the case’s „Tylko ja” is a personal deck').toBe('personal');
    expect(createdDeck.created_by, 'the student owns the deck it created').toBe(student.id);
    expect(createdDeck.flashcard_count, 'a new deck starts with 0 flashcards').toBe(0);

    const ownCard = deckCard(page, DECK_NAME);
    await expect(ownCard, 'exactly one card carries the new deck').toHaveCount(1);
    await expect(visible(ownCard.getByText(DECK_NAME, { exact: true }))).toBeVisible();
    await expect(visible(ownCard.getByText(DECK_DESCRIPTION, { exact: true }))).toBeVisible();
    await expect(visible(ownCard.getByText(COPY.flashcardsZero, { exact: true }))).toBeVisible();

    // ── Expected: the owner's „Zarządzaj” label ─────────────────────────────
    const manageButton = ownCard.getByRole('button', { name: COPY.manageDeck, exact: true });
    await expect(manageButton).toBeVisible();
    await expect(
      ownCard.getByRole('button', { name: COPY.viewDeck, exact: true }),
      'the owner never sees the read-only label on its own deck',
    ).toHaveCount(0);

    const listed = (await listDecks(page)).filter((deck) => deck.name === DECK_NAME);
    expect(
      listed.map((deck) => deck.id),
      'the API lists exactly the created deck',
    ).toEqual([createdDeck.id]);
    expect(listed[0].visibility, 'the stored deck is „Tylko ja”').toBe('personal');

    // ── Adjacent regression: the label follows ownership, not the page ──────
    const groupDeck = await createGroupDeck(browser, tenant, page);
    await page.reload();
    await expect(visible(page.getByText(groupDeck.name, { exact: true }))).toBeVisible();

    const groupCard = deckCard(page, groupDeck.name);
    await expect(groupCard, 'the shared deck is visible to the student').toHaveCount(1);
    await expect(visible(groupCard.getByText(COPY.flashcardsZero, { exact: true }))).toBeVisible();
    await expect(
      groupCard.getByRole('button', { name: COPY.viewDeck, exact: true }),
      'a shared deck the student cannot update renders „Przeglądaj”',
    ).toBeVisible();
    await expect(
      groupCard.getByRole('button', { name: COPY.manageDeck, exact: true }),
      '„Zarządzaj” is never shown for another user’s deck',
    ).toHaveCount(0);
    await expect(
      visible(groupCard.getByText(tenant.group!.name, { exact: true })),
      'the shared deck carries its group badge',
    ).toBeVisible();
    await expect(
      deckCard(page, DECK_NAME).getByRole('button', { name: COPY.manageDeck, exact: true }),
      'the student’s own deck keeps „Zarządzaj”',
    ).toBeVisible();

    // ── Adjacent regression: „Zarządzaj” opens this deck’s detail ───────────
    await deckCard(page, DECK_NAME)
      .getByRole('button', { name: COPY.manageDeck, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${createdDeck.id}$`));
    await expect(page.getByRole('heading', { name: DECK_NAME, exact: true })).toBeVisible();
    await expect(page.getByText(DECK_DESCRIPTION, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.flashcardsZero, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.emptyDeck).first()).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
