import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * SEC-03 — a student without an organization cannot read another organization's
 * content (isolation between organizations and groups).
 *
 * Case (verbatim → tenant model): the legacy prerequisite `student3` is a student
 * with **no organization** and one personal deck „S3”. The case opens `/app/flashcards`
 * and `/app/questions`, then tries to read the organization deck „O1G1T1” through the
 * API. Expected: only the student's own deck „S3”; O1 content is unreachable.
 *
 * Tenant (deterministic, `org-limit` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts SEC-03 --fresh
 *
 * gives org `qa-sec-03-<suffix>` (`tenantKey('qa/cases/SEC-03.md', 'SEC-03#<suffix>',
 * 'qa-shared')` + `tenantId` for every id) with an admin (also the teacher of the
 * default group `G1`), two educators and one member, **plus two student accounts that
 * are not organization members**. That shape is exactly what this case needs: an
 * organization with content that exists while the case's subject belongs to no
 * organization. `invitee1` plays `student3`; the org member plays the positive
 * control. No legacy `@dev.local` login and no other worker's tenant is touched.
 *
 * Nothing global is read or written — no admin setting, feature flag, plan, platform
 * stat or singleton row. All content is created inside this tenant through the
 * product API: the org admin creates the group-shared deck „O1G1T1” (two cards) and
 * the group-shared bank „O1G1B1”; the no-org student owns the personal deck „S3”.
 *
 * Acceptance points confirmed on the shared app (:3010, worker qa-env-3) on
 * 2026-10-28:
 * - `/app/flashcards` lists exactly one deck („1 talia”, card „S3”); „O1G1T1” is absent.
 * - `/app/questions` shows the empty state („Nic tu jeszcze nie ma, utwórz swój pierwszy
 *   bank pytań!”); „O1G1B1” is absent.
 * - `GET /api/v1/flashcards/decks` returns only the student's own deck;
 *   `GET /api/v1/flashcards/decks/:id`, `GET /api/v1/flashcards/:id` and
 *   `GET /api/v1/questions/banks/:id` answer **404 NOT_FOUND** (fail closed, no body data),
 *   and a forced `PUT` of the org deck is also 404.
 *
 * The adjacent regression that matters for this surface is the positive control: an
 * actual member of `G1` still reads the same deck, cards and bank afterwards — so a
 * 404 for the outsider cannot be an artifact of a broken fixture, and the forced
 * write did not land.
 */

const CASE = 'SEC-03';

const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';
const BANKS_URL = '/api/v1/questions/banks';

/** The case's own deck (prerequisite „S3”) and the organization content it must not see. */
const OWN_DECK = 'S3';
const ORG_DECK = 'O1G1T1';
const ORG_BANK = 'O1G1B1';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ListResult<T> {
  items: T[];
  total?: number;
  hasMore: boolean;
}

interface Deck {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
  groupIds: string[];
  flashcard_count: number;
}

interface Flashcard {
  id: string;
  front: string;
  deck_id: string | null;
}

interface QuestionBank {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  groupIds?: string[];
}

interface MyOrg {
  id: string;
  name: string;
}

/** `GET` an endpoint as the signed-in user and unwrap the `{ success, data }` envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(200);
  const body = (await response.json()) as Envelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data as T;
}

async function listDecks(page: Page): Promise<ListResult<Deck>> {
  return getData<ListResult<Deck>>(page, `${DECKS_URL}?limit=100`);
}

async function listCards(page: Page, deckId: string): Promise<Flashcard[]> {
  const cards = await getData<ListResult<Flashcard>>(
    page,
    `${CARDS_URL}?deckIds=${deckId}&limit=100`,
  );
  return cards.items;
}

async function listBanks(page: Page): Promise<ListResult<QuestionBank>> {
  return getData<ListResult<QuestionBank>>(page, `${BANKS_URL}?limit=100`);
}

/**
 * A read (or forced write) the outsider must not be able to make: 404 NOT_FOUND,
 * and no payload — the error must not leak the row it refused to return.
 */
async function expectHidden(
  page: Page,
  url: string,
  init?: { method: 'PUT'; data: Record<string, unknown> },
): Promise<void> {
  const response = init
    ? await page.request.put(url, { data: init.data })
    : await page.request.get(url);
  expect(response.status(), `${init?.method ?? 'GET'} ${url} as the no-org student`).toBe(404);
  const body = (await response.json()) as Envelope<unknown>;
  expect(body.success, `${url} must fail`).toBe(false);
  expect(body.error, `${url} error code`).toBe('NOT_FOUND');
  expect(body.data, `${url} must not leak a payload`).toBeUndefined();
}

/** The deck card whose title (`h3`) is the given name. */
function deckCard(page: Page, name: string): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/**
 * Create the tenant's organization content if it does not exist yet — idempotent, so a
 * re-run on an already-seeded tenant neither duplicates rows nor depends on leftovers.
 */
async function ensureDeck(
  page: Page,
  name: string,
  input: { visibility: 'personal' | 'group'; groupIds?: string[] },
): Promise<Deck> {
  const existing = (await listDecks(page)).items.find((deck) => deck.name === name);
  if (existing) return existing;

  const response = await page.request.post(DECKS_URL, { data: { name, ...input } });
  expect(response.status(), `POST ${DECKS_URL} (${name}) → ${await response.text()}`).toBe(201);
  return ((await response.json()) as Envelope<Deck>).data as Deck;
}

async function ensureCards(page: Page, deck: Deck): Promise<Flashcard[]> {
  const existing = await listCards(page, deck.id);
  if (existing.length >= 2) return existing;

  for (let index = existing.length; index < 2; index += 1) {
    const number = index + 1;
    const response = await page.request.post(CARDS_URL, {
      data: {
        deckId: deck.id,
        front: `${ORG_DECK} front ${number}`,
        back: `${ORG_DECK} back ${number}`,
      },
    });
    expect(response.status(), `POST ${CARDS_URL} (card ${number}) → ${await response.text()}`).toBe(
      201,
    );
  }
  return listCards(page, deck.id);
}

async function ensureBank(
  page: Page,
  name: string,
  input: { visibility: 'group'; groupIds: string[] },
): Promise<QuestionBank> {
  const existing = (await listBanks(page)).items.find((bank) => bank.name === name);
  if (existing) return existing;

  const response = await page.request.post(BANKS_URL, { data: { name, ...input } });
  expect(response.status(), `POST ${BANKS_URL} (${name}) → ${await response.text()}`).toBe(201);
  return ((await response.json()) as Envelope<QuestionBank>).data as QuestionBank;
}

/**
 * Build the organization side of the case as its admin: the admin owns the default
 * group `G1`, and only a group teacher may share content to it (`canShareContentToGroups`),
 * so the group-shared deck and bank come from the admin rather than the seeded educator.
 */
async function prepareOrgContent(
  page: Page,
  tenant: QaTenant,
): Promise<{ deck: Deck; cards: Flashcard[]; bank: QuestionBank }> {
  const org = tenant.org;
  const group = tenant.group;
  if (!org || !group) {
    throw new Error(`${CASE} needs the org-limit tenant profile (organization + group)`);
  }

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });

  const activeOrg = (await getData<MyOrg[]>(page, '/api/v1/me/orgs')).find(
    (row) => row.id === org.id,
  );
  expect(activeOrg, 'the manager administers the tenant organization').toBeTruthy();

  const deck = await ensureDeck(page, ORG_DECK, { visibility: 'group', groupIds: [group.id] });
  expect(deck.organization_id, 'the org deck belongs to the tenant organization').toBe(org.id);
  expect(deck.visibility, 'the org deck is shared to the tenant group').toBe('group');
  expect(deck.groupIds, 'the org deck is shared to G1 only').toEqual([group.id]);

  const cards = await ensureCards(page, deck);
  expect(cards.length, 'the org deck has its cards').toBe(2);

  const bank = await ensureBank(page, ORG_BANK, {
    visibility: 'group',
    groupIds: [group.id],
  });
  expect(bank.organization_id, 'the org bank belongs to the tenant organization').toBe(org.id);

  return { deck, cards, bank };
}

test.describe('@case:SEC-03 @area:SEC @prio:P2 no-organization student isolation', () => {
  test('sees only their own deck and cannot read the organization deck, card or bank', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');

    const outsider = tenant.users.invitee1;
    const member = tenant.users.student;
    if (!tenant.org || !tenant.group || !tenant.users.manager || !outsider || !member) {
      throw new Error(
        `${CASE} needs the org-limit tenant profile (org, group, manager, member and invitee1)`,
      );
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Step 0: the organization content exists and belongs to G1 ----------
    const { deck, cards, bank } = await prepareOrgContent(page, tenant);

    // --- Step 1: the no-organization student -------------------------------
    await page.context().clearCookies();
    await loginAs(page, tenant, 'invitee1', {
      locale: 'pl',
      activeOrgId: null,
      waitFor: /\/app(\/|$)/,
    });

    const orgs = await getData<MyOrg[]>(page, '/api/v1/me/orgs');
    expect(orgs, 'the case subject belongs to no organization').toEqual([]);

    // The prerequisite deck „S3” — created through the student's own session.
    const ownDeck = await ensureDeck(page, OWN_DECK, { visibility: 'personal' });
    expect(ownDeck.created_by, '„S3” is the student’s own deck').toBe(outsider.id);
    expect(
      ownDeck.organization_id,
      '„S3” is personal content, owned by no organization',
    ).toBeNull();

    // --- Step 2: the deck list only contains the student's own deck --------
    const decks = await listDecks(page);
    expect(
      decks.items.map((row) => row.id),
      'decks readable by the no-org student',
    ).toEqual([ownDeck.id]);
    expect(decks.items.map((row) => row.name)).not.toContain(ORG_DECK);

    // --- Step 2a: the org deck is unreachable directly through the API -----
    await expectHidden(page, `${DECKS_URL}/${deck.id}`);
    await expectHidden(page, `${CARDS_URL}/${cards[0].id}`);
    await expectHidden(page, `${BANKS_URL}/${bank.id}`);

    const banks = await listBanks(page);
    expect(
      banks.items.map((row) => row.id),
      'banks readable by the no-org student',
    ).not.toContain(bank.id);
    expect(banks.items.map((row) => row.name)).not.toContain(ORG_BANK);

    // --- Step 2b: a forced write fails the same way ------------------------
    // The isolation must not be read-only: guessing the id must not allow a rename.
    await expectHidden(page, `${DECKS_URL}/${deck.id}`, {
      method: 'PUT',
      data: { name: `${ORG_DECK} taken over` },
    });

    // The student's own deck stays readable — the gate must not over-block either.
    const ownRead = await getData<Deck>(page, `${DECKS_URL}/${ownDeck.id}`);
    expect(ownRead.name, 'the no-org student still reads their own deck').toBe(OWN_DECK);

    // --- Step 1 (UI): /app/flashcards shows only „S3” ----------------------
    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByText('1 talia', { exact: true }), 'exactly one deck').toBeVisible();
    await expect(deckCard(page, OWN_DECK), 'the student’s own deck card').toBeVisible();
    await expect(
      page.getByRole('heading', { name: ORG_DECK, exact: true }),
      'the organization deck must not be rendered',
    ).toHaveCount(0);

    // --- Step 1 (UI): /app/questions has no organization content -----------
    await page.goto('/app/questions');
    await expect(page).toHaveURL(/\/app\/questions$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.getByText('Nic tu jeszcze nie ma, utwórz swój pierwszy bank pytań!'),
      'empty question-bank state',
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: ORG_BANK, exact: true }),
      'the organization bank must not be rendered',
    ).toHaveCount(0);

    // --- Step 3: a real G1 member still reads the same content -------------
    // Positive control: the 404s above are a permission boundary, not a broken fixture,
    // and the outsider's forced PUT did not rename anything.
    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

    const memberDecks = await listDecks(page);
    expect(
      memberDecks.items.find((row) => row.id === deck.id)?.name,
      'the G1 member still lists the org deck',
    ).toBe(ORG_DECK);

    const memberDeck = await getData<Deck>(page, `${DECKS_URL}/${deck.id}`);
    expect(memberDeck.name, 'the outsider’s forced rename did not land').toBe(ORG_DECK);

    const memberCard = await getData<Flashcard>(page, `${CARDS_URL}/${cards[0].id}`);
    expect(memberCard.deck_id, 'the G1 member still reads the org deck’s cards').toBe(deck.id);

    const memberBank = await getData<QuestionBank>(page, `${BANKS_URL}/${bank.id}`);
    expect(memberBank.name, 'the G1 member still reads the org bank').toBe(ORG_BANK);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
