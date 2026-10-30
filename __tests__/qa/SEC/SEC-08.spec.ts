import type { Browser, Page } from '@playwright/test';
import {
  expect,
  loadTenant,
  loginAs,
  test,
  type QaRole,
  type QaTenant,
} from '@qa/fixtures/qa-tenant';

/**
 * SEC-08 — a student cannot edit or delete another student's flashcard or deck
 * (IDOR).
 *
 * Case (verbatim → tenant model): the legacy prerequisite `student1` / `student2`
 * (`@dev.local`, password `pass`, S1 in WSB Merito, S2 in another organization) is
 * never used. The spec reads its own tenant, seeded fresh for every independent run:
 *
 *   bun scripts/qa-tenant.ts SEC-08 --fresh
 *
 * `__tests__/qa/profiles/SEC-08.json` declares the `org-limit` profile: an organization
 * with an admin, two teachers and one member, plus `invitee1` / `invitee2` — two
 * student accounts that are not organization members yet.
 *
 * The case's two students are modelled inside that one tenant:
 * - S1 (victim) = `student`, an organization member with the system `member` role.
 *   They own the personal deck `O1S1` and one card in it, created through the
 *   product API in their own session.
 * - S2 (attacker) = `invitee1`, invited by the organization admin and accepting the
 *   invitation through `/api/v1/organization/invites/accept` before the test, so the
 *   attacker is a **member of the same organization** with the same `member` role.
 *   That is strictly stronger than the legacy cross-organization S2: a same-org
 *   member already passes the organization scope, so only the per-resource `own`
 *   scope can refuse the write. The seeded invitation is reused on a retry, so a
 *   tenant seeded once supports `--repeat-each` / `--retries`.
 * - A second outsider (`invitee2`, a student with **no organization** — the closest
 *   the tenant profile offers to the legacy "student from another organization")
 *   repeats both writes as the cross-tenant control.
 *
 * Acceptance points walked on the shared app (:3010, worker qa-env-8) on 2026-10-29:
 * 1. `PUT /api/v1/flashcards/<S1 card>` with `{front:"hack"}` as S2 → **403
 *    FORBIDDEN** (same-org member), **404 NOT_FOUND** (student with no organization);
 *    the 403 body is `{"success":false,"error":"FORBIDDEN"}` with no `data`.
 * 2. `DELETE /api/v1/flashcards/decks/<S1 deck>` as S2 → **403 FORBIDDEN** (same-org
 *    member), **404 NOT_FOUND** (no-organization student) — the case's "403/404".
 * 3. S1's card and deck are untouched afterwards: S1 still reads the card with its
 *    original front and back, the deck still exists with its name, and both render
 *    in `/app/flashcards/<deck>`.
 *
 * Adjacent write paths on the same surface are refused too (S2 deleting the card,
 * S2 renaming the deck), and the positive control proves the routes are functional
 * for the owner: S1 updates their own card and deletes their own deck (200).
 *
 * All ids come from the tenant (`tenant.runSuffix` / `tenant.users` / `tenant.org`)
 * and the card front carries the run suffix, so two runs never collide. Nothing
 * global is written: no admin setting, feature flag, plan, platform stat or
 * singleton row, and no other case's tenant is touched.
 */

const CASE = 'SEC-08';

const CARDS_URL = '/api/v1/flashcards';
const DECKS_URL = '/api/v1/flashcards/decks';
const INVITES_URL = '/api/v1/organization/invites/bulk';
const ACCEPT_URL = '/api/v1/organization/invites/accept';
const MEMBERS_URL = '/api/v1/organization/members';
const ROLES_URL = '/api/v1/organization/roles';
const ORGS_URL = '/api/v1/me/orgs';
const ME_URL = '/api/v1/auth/me';

/** The case's deck name (legacy seed: „O1S1” — student1's personal deck). */
const DECK_NAME = 'O1S1';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Deck {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
}

interface Card {
  id: string;
  front: string;
  back: string;
  deck_id: string;
  created_by: string;
  organization_id: string | null;
}

interface Member {
  id: string;
  email: string;
  orgRoleName: string;
}

interface OrgRole {
  id: string;
  name: string;
  isSystem: boolean;
}

interface Me {
  user?: { id?: string; app_metadata?: { account_type?: string } };
}

interface Membership {
  id: string;
  orgRoleName: string;
  isActive: boolean;
}

interface BulkResult {
  email: string;
  success: true;
  data: { success: true; invitationId: string; inviteCode: string; inviteLink: string };
}

interface CallResult {
  status: number;
  errorCode: string | null;
  body: string;
}

function account(tenant: QaTenant, role: QaRole) {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user;
}

/**
 * A signed-in API session for one seeded account, pinned to the given organization
 * (or to no organization at all). The app only writes `active_org_id` when an org is
 * created or switched, so a seeded membership needs the cookie set here — otherwise
 * `withAuth` scopes the request to no org.
 */
async function apiSession(
  browser: Browser,
  baseURL: string,
  tenant: QaTenant,
  role: QaRole,
  orgId: string | null,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const user = account(tenant, role);
  const { hostname } = new URL(baseURL);
  const context = await browser.newContext({ baseURL });
  const cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
  }> = [{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }];
  if (orgId) {
    cookies.push({
      name: 'active_org_id',
      value: orgId,
      domain: hostname,
      path: '/',
      httpOnly: true,
    });
  }
  await context.addCookies(cookies);
  const page = await context.newPage();
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  expect(response.status(), `login ${role} (${user.email})`).toBe(200);
  return { page, close: () => context.close() };
}

async function call(
  page: Page,
  method: 'GET' | 'PUT' | 'DELETE' | 'POST',
  url: string,
  data?: unknown,
): Promise<CallResult> {
  const response =
    method === 'GET'
      ? await page.request.get(url)
      : method === 'PUT'
        ? await page.request.put(url, { data: data ?? {} })
        : method === 'DELETE'
          ? await page.request.delete(url)
          : await page.request.post(url, { data: data ?? {} });
  return {
    status: response.status(),
    errorCode: response.headers()['x-error-code'] ?? null,
    body: await response.text(),
  };
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(200);
  const body = (await response.json()) as Envelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data as T;
}

/**
 * The case accepts 403 or 404 for a rejected foreign write. The error code must
 * agree with the status, so a 403 cannot masquerade as validation, and the
 * envelope carries no payload — a refused operation must not leak the resource.
 */
function expectRejected(result: CallResult, label: string): void {
  expect([403, 404], `${label}: rejected with 403/404 → ${result.status} ${result.body}`).toContain(
    result.status,
  );
  const expected = result.status === 403 ? 'FORBIDDEN' : 'NOT_FOUND';
  expect(result.errorCode, `${label}: x-error-code header`).toBe(expected);
  expect(JSON.parse(result.body), `${label}: response envelope`).toEqual({
    success: false,
    error: expected,
  });
}

/** Decks the caller can see (the owner's list, the attacker's list never here). */
async function listDecks(page: Page): Promise<Deck[]> {
  const body = await getData<{ items: Deck[] }>(page, `${DECKS_URL}?limit=500`);
  return body.items;
}

async function listCards(page: Page, deckId: string): Promise<Card[]> {
  const body = await getData<{ items: Card[] }>(page, `${CARDS_URL}?deckIds=${deckId}&limit=50`);
  return body.items;
}

interface CaseFixture {
  tenant: QaTenant;
  run: string;
  /** S1's personal deck and card (the IDOR target). */
  deck: Deck;
  card: Card;
}

/**
 * Prepare the case inside its own tenant, idempotently — a tenant seeded once must
 * survive `--retries` / `--repeat-each`:
 * 1. S2 (`invitee1`) becomes an organization member through the real invitation
 *    flow (skipped when a previous retry already accepted it).
 * 2. S1 (`student`) owns the personal deck `O1S1` with exactly one card, created
 *    through the product API (reused when a previous run already created it).
 */
async function prepareTenant(browser: Browser, baseURL: string): Promise<CaseFixture> {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');
  if (!tenant.org || !tenant.users.student || !tenant.users.invitee1 || !tenant.users.invitee2) {
    throw new Error(`${CASE} tenant is missing its organization, student or invitee accounts`);
  }
  const org = tenant.org;
  const victim = account(tenant, 'student');
  const attacker = account(tenant, 'invitee1');
  const run = tenant.runSuffix ?? tenant.key.slice(-8);
  const cardFront = `Fiszka S1 ${run}`;
  const cardBack = `Tył S1 ${run}`;

  // --- S2 joins the victim's organization ---------------------------------
  const manager = await apiSession(browser, baseURL, tenant, 'manager', org.id);
  try {
    const members = await getData<Member[]>(manager.page, MEMBERS_URL);
    if (!members.some((member) => member.id === attacker.id)) {
      const roles = await getData<OrgRole[]>(manager.page, ROLES_URL);
      const memberRole = roles.find((role) => role.name === 'member' && role.isSystem);
      expect(memberRole, 'the organization has its system member role').toBeTruthy();

      const invite = await call(manager.page, 'POST', INVITES_URL, {
        invitations: [{ email: attacker.email, targetOrgRoleId: memberRole!.id }],
      });
      expect(invite.status, `manager invites S2 → ${invite.body}`).toBe(200);
      const inviteBody = JSON.parse(invite.body) as Envelope<{ results: BulkResult[] }>;
      const code = inviteBody.data?.results[0]?.data.inviteCode;
      expect(code, 'the invitation carries its 32-hex code').toMatch(/^[0-9a-f]{32}$/);

      const invitee = await apiSession(browser, baseURL, tenant, 'invitee1', null);
      try {
        const accept = await invitee.page.request.post(ACCEPT_URL, { data: { token: code } });
        expect(accept.status(), `S2 accepts the invitation → ${await accept.text()}`).toBe(200);
      } finally {
        await invitee.close();
      }
    }
  } finally {
    await manager.close();
  }

  // --- S1 owns the personal deck and card ---------------------------------
  const owner = await apiSession(browser, baseURL, tenant, 'student', org.id);
  try {
    let deck = (await listDecks(owner.page)).find(
      (row) => row.name === DECK_NAME && row.created_by === victim.id,
    );
    if (!deck) {
      const created = await call(owner.page, 'POST', DECKS_URL, { name: DECK_NAME });
      expect(created.status, `S1 creates the deck ${DECK_NAME} → ${created.body}`).toBe(201);
      deck = (JSON.parse(created.body) as Envelope<Deck>).data!;
    }
    expect(deck.created_by, 'the deck belongs to S1').toBe(victim.id);
    expect(deck.visibility, 'the deck is personal — only its owner may change it').toBe('personal');

    let card = (await listCards(owner.page, deck.id)).find((row) => row.front === cardFront);
    if (!card) {
      const created = await call(owner.page, 'POST', CARDS_URL, {
        deckId: deck.id,
        front: cardFront,
        back: cardBack,
      });
      expect(created.status, `S1 creates a card in ${DECK_NAME} → ${created.body}`).toBe(201);
      card = (JSON.parse(created.body) as Envelope<Card>).data!;
    }
    expect(card.created_by, 'the card belongs to S1').toBe(victim.id);

    console.log(`${CASE} tenant key: ${tenant.key}`);
    console.log(`${CASE} org: ${org.id} (${org.name})`);
    console.log(`${CASE} S1 deck: ${deck.id} ${deck.name} / card: ${card.id} ${card.front}`);

    return { tenant, run, deck, card };
  } finally {
    await owner.close();
  }
}

/** A fresh session for one tenant user; cookies are cleared so roles never overlap. */
async function switchUser(
  page: Page,
  tenant: QaTenant,
  role: QaRole,
  options: { activeOrgId?: string | null } = {},
): Promise<void> {
  await page.context().clearCookies();
  await loginAs(page, tenant, role, {
    locale: 'pl',
    waitFor: /\/app(\/|$)/,
    ...options,
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
}

/** `app_metadata.account_type` the seeder gives each tenant role. */
const ACCOUNT_TYPE: Partial<Record<QaRole, string>> = {
  manager: 'manager',
  teacher: 'educator',
  teacher2: 'educator',
  student: 'student',
  invitee1: 'student',
  invitee2: 'student',
};

async function expectSignedInAs(page: Page, tenant: QaTenant, role: QaRole): Promise<void> {
  const user = account(tenant, role);
  const me = (await (await page.request.get(ME_URL)).json()) as Envelope<Me>;
  expect(me.data?.user?.id, `the signed-in user is the tenant's ${role}`).toBe(user.id);
  expect(me.data?.user?.app_metadata?.account_type, `the ${role} account type`).toBe(
    ACCOUNT_TYPE[role],
  );
}

test.describe('@case:SEC-08 @area:SEC @prio:P1 foreign flashcard and deck writes are refused', () => {
  let fixture: CaseFixture;

  test.beforeAll(async ({ browser, baseURL }) => {
    fixture = await prepareTenant(browser, baseURL ?? 'http://localhost:3010');
  });

  test("a second student cannot update or delete another student's flashcard or deck", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const { tenant, deck, card } = fixture;
    const org = tenant.org!;
    const victim = account(tenant, 'student');

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Step 1: S1's own baseline ----------------------------------------
    await switchUser(page, tenant, 'student');
    await expectSignedInAs(page, tenant, 'student');
    const victimMembership = (await getData<Membership[]>(page, ORGS_URL)).find(
      (row) => row.id === org.id,
    );
    expect(victimMembership, 'S1 holds the member role in the active organization').toMatchObject({
      id: org.id,
      orgRoleName: 'member',
      isActive: true,
    });

    const ownCard = (await getData<Card>(page, `${CARDS_URL}/${card.id}`)) as Card;
    expect(ownCard, 'S1 reads their own card before the attack').toMatchObject({
      id: card.id,
      front: card.front,
      back: card.back,
      deck_id: deck.id,
      created_by: victim.id,
    });
    const ownDeck = await getData<Deck>(page, `${DECKS_URL}/${deck.id}`);
    expect(ownDeck, 'S1 reads their own deck before the attack').toMatchObject({
      id: deck.id,
      name: DECK_NAME,
      created_by: victim.id,
    });

    // --- Step 2: S2 (same organization, same member role) attacks ---------
    await switchUser(page, tenant, 'invitee1');
    await expectSignedInAs(page, tenant, 'invitee1');
    const attackerMembership = (await getData<Membership[]>(page, ORGS_URL)).find(
      (row) => row.id === org.id,
    );
    expect(
      attackerMembership,
      'S2 is a member of the same organization — the 403 below is not an org-scope artifact',
    ).toMatchObject({ id: org.id, orgRoleName: 'member', isActive: true });

    // PUT /api/v1/flashcards/<S1 card> {front:"hack"} — the case's step 2.
    expectRejected(
      await call(page, 'PUT', `${CARDS_URL}/${card.id}`, { front: 'hack' }),
      'S2 PUT /flashcards/<S1 card>',
    );

    // DELETE /api/v1/flashcards/decks/<S1 deck> — the case's step 3.
    expectRejected(
      await call(page, 'DELETE', `${DECKS_URL}/${deck.id}`),
      'S2 DELETE /flashcards/decks/<S1 deck>',
    );

    // Adjacent writes on the same surface: deleting the card and renaming the deck.
    expectRejected(
      await call(page, 'DELETE', `${CARDS_URL}/${card.id}`),
      'S2 DELETE /flashcards/<S1 card>',
    );
    expectRejected(
      await call(page, 'PUT', `${DECKS_URL}/${deck.id}`, { name: 'hack-deck' }),
      'S2 PUT /flashcards/decks/<S1 deck>',
    );

    // --- Step 3: a student outside the organization is refused as well ----
    await switchUser(page, tenant, 'invitee2', { activeOrgId: null });
    await expectSignedInAs(page, tenant, 'invitee2');
    expect(
      await getData<Membership[]>(page, ORGS_URL),
      'the outsider belongs to no organization',
    ).toEqual([]);

    expectRejected(
      await call(page, 'PUT', `${CARDS_URL}/${card.id}`, { front: 'hack' }),
      'outsider PUT /flashcards/<S1 card>',
    );
    expectRejected(
      await call(page, 'DELETE', `${DECKS_URL}/${deck.id}`),
      'outsider DELETE /flashcards/decks/<S1 deck>',
    );

    // --- The victim's card and deck are untouched -------------------------
    await switchUser(page, tenant, 'student');
    await expectSignedInAs(page, tenant, 'student');

    const cardAfter = await getData<Card>(page, `${CARDS_URL}/${card.id}`);
    expect(cardAfter, 'S1’s card kept its front and back').toMatchObject({
      id: card.id,
      front: card.front,
      back: card.back,
      deck_id: deck.id,
      created_by: victim.id,
    });
    const deckAfter = await getData<Deck>(page, `${DECKS_URL}/${deck.id}`);
    expect(deckAfter, 'S1’s deck kept its name, owner and visibility').toMatchObject({
      id: deck.id,
      name: DECK_NAME,
      created_by: victim.id,
      visibility: 'personal',
    });
    const cardsAfter = await listCards(page, deck.id);
    expect(
      cardsAfter.find((row) => row.id === card.id),
      'the card is still listed in S1’s deck',
    ).toMatchObject({ id: card.id, front: card.front, back: card.back });
    expect(
      (await listDecks(page)).find((row) => row.id === deck.id),
      'the deck is still listed for S1',
    ).toMatchObject({ id: deck.id, name: DECK_NAME });

    // --- Positive control: the same routes work for the owner --------------
    const ownerUpdate = await call(page, 'PUT', `${CARDS_URL}/${card.id}`, {
      front: card.front,
      back: card.back,
    });
    expect(ownerUpdate.status, `S1 updates their own card → ${ownerUpdate.body}`).toBe(200);
    expect((JSON.parse(ownerUpdate.body) as Envelope<Card>).data).toMatchObject({
      id: card.id,
      front: card.front,
    });

    const throwaway = await call(page, 'POST', DECKS_URL, {
      name: `SEC-08 control ${fixture.run}`,
    });
    expect(throwaway.status, `S1 creates a control deck → ${throwaway.body}`).toBe(201);
    const throwawayId = (JSON.parse(throwaway.body) as Envelope<Deck>).data!.id;
    expect(
      (await call(page, 'DELETE', `${DECKS_URL}/${throwawayId}`)).status,
      'S1 deletes their own control deck',
    ).toBe(200);

    // --- The untouched content still renders in the student's UI ----------
    await page.goto(`/app/flashcards/${deck.id}`);
    await expect(
      page.getByRole('heading', { name: DECK_NAME, exact: true }).first(),
      'S1’s deck page still renders its heading',
    ).toBeVisible();
    const visibleFront = page.getByText(card.front, { exact: true }).filter({ visible: true });
    await expect(visibleFront.first(), 'S1’s card still renders').toBeVisible();
    await expect(page.getByText('hack', { exact: true })).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
