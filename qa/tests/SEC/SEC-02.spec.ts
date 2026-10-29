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
 * SEC-02 — a student of another organization cannot reach a deck or the
 * organization data of an organization they do not belong to.
 *
 * Prerequisite (reconciled with the tenant seeder): a student who is a member of
 * **another** organization than the deck's owner. The legacy manual seed
 * (student2, WSB Merito / UE Wrocław, password `pass`) is never used. The case's
 * own tenant has two organizations (the `two-org` profile, the same shape
 * `MGR-03` uses):
 *
 * - org A — manager admin, educator teacher A and student A (member of the default
 *   group `O1G1-<run>`); teacher A owns a group-visible deck `O1G1T1 <run>` with
 *   one card, shared to that group.
 * - org B — the same manager admin and student B (member of `O2G1-<run>`); the
 *   manager owns a group-visible deck `O2G1T1 <run>`. Student B is the outsider:
 *   it belongs to org B only and never to org A.
 *
 * Tenant: `bun scripts/qa-tenant.ts SEC-02 --fresh` seeds both organizations into
 * `qa/.tenants/SEC-02.json` before the suite starts (the `two-org` profile), so
 * the spec never creates accounts, orgs or groups. Every deck and card is then
 * built through the product's own API inside the test, exactly like the other QA
 * cases: nothing global is written — no settings, flags, plans or platform rows —
 * and no other case's tenant is touched.
 *
 * Acceptance points (case SEC-02):
 * 1. `/app/flashcards/<org A deck>` for student B shows „Nie znaleziono talii”.
 * 2. `GET /api/v1/flashcards/decks/<org A deck>` is 404 and carries no deck data.
 * 3. `GET /api/v1/organization/<org A>` is 403 and carries no organization data.
 *
 * The positive controls keep the negative result meaningful: student A (same org,
 * member of the deck's group) reads the deck, student B reads only its own org's
 * deck, and a denied write never mutates the foreign deck.
 */

const CASE = 'SEC-02';

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
  student: TenantUser;
  inviteEmail: string;
  counts: { total: number; teachers: number; students: number };
}

interface TwoOrgTenant extends QaTenant {
  manager: TenantUser;
  orgA: TenantOrg;
  orgB: TenantOrg;
  users: NonNullable<QaTenant['users']> & {
    manager: TenantUser;
    studentA: TenantUser;
    teacherA: TenantUser;
    studentB: TenantUser;
  };
}

const TENANT = loadTenant(CASE) as TwoOrgTenant;

/** Run suffix the seeder folded into the tenant key. */
const RUN = TENANT.runSuffix ?? 'stable';

/** Polish copy the case quotes; `NEXT_LOCALE=pl` pins it for the run. */
const COPY = {
  deckNotFound: 'Nie znaleziono talii',
  deckNotFoundDescription: 'Ta talia mogła zostać usunięta lub nie masz do niej dostępu.',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface NamedRow {
  id: string;
  name: string;
}

interface QaDeck {
  id: string;
  name: string;
  groupId: string;
  cardId: string;
  cardFront: string;
}

interface SeededContent {
  /** Teacher A's deck in org A — the case's O1G1T1. */
  deckA: QaDeck;
  /** The manager's deck in org B — student B's positive control. */
  deckB: QaDeck;
}

function account(tenant: TwoOrgTenant, role: QaRole): TenantUser {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user;
}

/**
 * A signed-in API session for one seeded account, pinned to one of the tenant's
 * organizations. The app only writes `active_org_id` when an org is created or
 * switched, so a seeded membership needs the cookie set here — otherwise
 * `withAuth` scopes the request to no org and the setup rows land outside it.
 */
async function apiSession(
  browser: Browser,
  baseURL: string,
  orgId: string,
  role: QaRole,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const user = account(TENANT, role);
  const { hostname } = new URL(baseURL);
  const context = await browser.newContext({ baseURL });
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: orgId, domain: hostname, path: '/', httpOnly: true },
  ]);
  const page = await context.newPage();
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  expect(response.status(), `login ${role} (${user.email})`).toBe(200);
  return { page, close: () => context.close() };
}

function expectCreated(response: { status(): number }, label: string): void {
  expect(response.status(), label).toBe(201);
}

/** The active org's groups, visible to its staff (`/manage/groups` source). */
async function listGroups(page: Page): Promise<NamedRow[]> {
  const response = await page.request.get('/api/v1/organization/groups');
  expect(response.status(), 'GET /api/v1/organization/groups').toBe(200);
  return ((await response.json()) as ApiEnvelope<NamedRow[]>).data;
}

/** Resolve a seeded group's id from its name through the product API. */
async function groupId(page: Page, org: TenantOrg): Promise<string> {
  const groups = await listGroups(page);
  const group = groups.find((row) => row.name === org.groups[0]);
  if (!group) throw new Error(`org ${org.id} has no group ${org.groups[0]}`);
  return group.id;
}

async function createDeck(page: Page, name: string, groupIdValue: string): Promise<NamedRow> {
  const response = await page.request.post('/api/v1/flashcards/decks', {
    data: { name, visibility: 'group', groupIds: [groupIdValue] },
  });
  expectCreated(response, 'POST /api/v1/flashcards/decks');
  return ((await response.json()) as ApiEnvelope<NamedRow>).data;
}

async function createCard(
  page: Page,
  deckId: string,
  card: { front: string; back: string },
): Promise<string> {
  const response = await page.request.post('/api/v1/flashcards', {
    data: { deckId, ...card },
  });
  expectCreated(response, 'POST /api/v1/flashcards');
  return ((await response.json()) as ApiEnvelope<{ id: string }>).data.id;
}

/**
 * Create an org's deck through the real API as its staff member: log in with the
 * org active, resolve its default group, then create a group-visible deck with
 * one card — the same shape as the case's `O1G1T1` (teacher's deck shared to a
 * group).
 */
async function createSharedDeck(
  page: Page,
  org: TenantOrg,
  name: string,
  card: { front: string; back: string },
): Promise<QaDeck> {
  const groupIdValue = await groupId(page, org);
  const deck = await createDeck(page, name, groupIdValue);
  const cardId = await createCard(page, deck.id, card);
  return { id: deck.id, name: deck.name, groupId: groupIdValue, cardId, cardFront: card.front };
}

/**
 * Build the case's content inside its own tenant: teacher A's deck in org A and
 * the manager's deck in org B. Both are created as the real staff member, so the
 * rows carry real authorship and org scoping.
 */
async function seedCaseContent(browser: Browser, baseURL: string): Promise<SeededContent> {
  const { orgA, orgB } = TENANT;

  const teacherA = await apiSession(browser, baseURL, orgA.id, 'teacherA');
  let deckA: QaDeck;
  try {
    deckA = await createSharedDeck(teacherA.page, orgA, `O1G1T1 ${RUN}`, {
      front: `front-secret-a-${RUN}`,
      back: `back-secret-a-${RUN}`,
    });
  } finally {
    await teacherA.close();
  }

  const manager = await apiSession(browser, baseURL, orgB.id, 'manager');
  let deckB: QaDeck;
  try {
    deckB = await createSharedDeck(manager.page, orgB, `O2G1T1 ${RUN}`, {
      front: `front-b-${RUN}`,
      back: `back-b-${RUN}`,
    });
  } finally {
    await manager.close();
  }

  return { deckA, deckB };
}

/** The API answer, plus its parsed JSON body. */
async function getJson(
  page: Page,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await page.request.get(path);
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('@case:SEC-02 @area:SEC @prio:P1 organization isolation', () => {
  let content: SeededContent;

  test.beforeAll(async ({ browser, baseURL }) => {
    expect(
      TENANT.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    content = await seedCaseContent(browser, baseURL ?? 'http://localhost:3010');
    console.log(`SEC-02 tenant key: ${TENANT.key}`);
    console.log(`SEC-02 org A: ${TENANT.orgA.id} (${TENANT.orgA.name})`);
    console.log(`SEC-02 org B: ${TENANT.orgB.id} (${TENANT.orgB.name})`);
    console.log(`SEC-02 deck A: ${content.deckA.id} ${content.deckA.name}`);
    console.log(`SEC-02 deck B: ${content.deckB.id} ${content.deckB.name}`);
  });

  test('a student of another organization cannot open the deck or read the organization', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { orgA, orgB } = TENANT;
    const { deckA, deckB } = content;

    // --- Premise: the deck is genuinely shared with org A's group. -----------------
    await loginAs(page, TENANT, 'studentA', {
      locale: 'pl',
      activeOrgId: orgA.id,
      waitFor: /\/app(\/|$)/,
    });

    const inOrgDeck = await getJson(page, `/api/v1/flashcards/decks/${deckA.id}`);
    expect(inOrgDeck.status, 'in-org group member reads the shared deck').toBe(200);
    expect((inOrgDeck.body.data as { name: string }).name).toBe(deckA.name);

    await page.goto(`/app/flashcards/${deckA.id}`);
    await expect(page.getByText(deckA.name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(deckA.cardFront).filter({ visible: true }).first()).toBeVisible();

    // --- Case step 1: the outsider opens the deck URL. -----------------------------
    await loginAs(page, TENANT, 'studentB', {
      locale: 'pl',
      activeOrgId: orgB.id,
      waitFor: /\/app(\/|$)/,
    });

    await page.goto(`/app/flashcards/${deckA.id}`);
    await expect(page.getByRole('heading', { name: COPY.deckNotFound, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.deckNotFoundDescription, { exact: true })).toBeVisible();
    // Neither the deck's identity nor its content may appear for the outsider.
    await expect(page.getByText(deckA.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(deckA.cardFront)).toHaveCount(0);

    // --- Case step 2: the API must not return the deck, its cards or the org. ------
    const foreignDeck = await getJson(page, `/api/v1/flashcards/decks/${deckA.id}`);
    expect(foreignDeck.status, 'foreign deck read').toBe(404);
    expect(foreignDeck.body.error).toBe('NOT_FOUND');
    expect(JSON.stringify(foreignDeck.body)).not.toContain(deckA.name);
    expect(JSON.stringify(foreignDeck.body)).not.toContain(deckA.cardFront);

    const foreignCards = await getJson(page, `/api/v1/flashcards?deckIds=${deckA.id}&limit=30`);
    expect(foreignCards.status, 'foreign deck card list').toBe(200);
    expect((foreignCards.body.data as { items: unknown[] }).items).toHaveLength(0);

    const foreignCard = await getJson(page, `/api/v1/flashcards/${deckA.cardId}`);
    expect(foreignCard.status, 'foreign card read').toBe(404);
    expect(JSON.stringify(foreignCard.body)).not.toContain(deckA.cardFront);

    const foreignOrg = await getJson(page, `/api/v1/organization/${orgA.id}`);
    expect(foreignOrg.status, 'foreign organization read').toBe(403);
    expect(foreignOrg.body.error).toBe('FORBIDDEN');
    expect(JSON.stringify(foreignOrg.body)).not.toContain(orgA.name);

    // A student has no member-administration access at all; whatever the answer is,
    // it must never carry the other organization's members.
    const members = await getJson(page, '/api/v1/organization/members');
    expect(members.status, 'student requesting the member list').toBe(403);
    expect(JSON.stringify(members.body)).not.toContain(TENANT.users.teacherA.email);
    expect(JSON.stringify(members.body)).not.toContain(TENANT.users.studentA.email);

    // A write from the outsider is refused as "not found" and changes nothing.
    const rename = await page.request.put(`/api/v1/flashcards/decks/${deckA.id}`, {
      data: { name: 'pwned-by-outsider' },
    });
    expect([403, 404], `foreign deck rename got ${rename.status()}`).toContain(rename.status());

    // The outsider's own deck list only carries its own organization's deck.
    const deckList = await getJson(page, '/api/v1/flashcards/decks?limit=200');
    expect(deckList.status, 'deck list').toBe(200);
    const listedNames = (deckList.body.data as { items: { name: string }[] }).items.map(
      (deck) => deck.name,
    );
    expect(listedNames).toContain(deckB.name);
    expect(listedNames).not.toContain(deckA.name);

    // --- Positive control: the same outsider does read its own org's deck. ---------
    const ownDeck = await getJson(page, `/api/v1/flashcards/decks/${deckB.id}`);
    expect(ownDeck.status, 'own-org deck read').toBe(200);
    expect((ownDeck.body.data as { name: string }).name).toBe(deckB.name);

    await page.goto(`/app/flashcards/${deckB.id}`);
    await expect(page.getByText(deckB.name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(deckB.cardFront).filter({ visible: true }).first()).toBeVisible();

    // --- The denied write did not touch the deck: its owner still sees it intact. --
    await loginAs(page, TENANT, 'teacherA', {
      locale: 'pl',
      activeOrgId: orgA.id,
      waitFor: /\/edu(\/|$)/,
    });

    const ownerDeck = await getJson(page, `/api/v1/flashcards/decks/${deckA.id}`);
    expect(ownerDeck.status, 'owner reads the deck after the denied write').toBe(200);
    expect((ownerDeck.body.data as { name: string }).name).toBe(deckA.name);
    expect((ownerDeck.body.data as { flashcard_count: number }).flashcard_count).toBe(1);

    // --- Adjacent control: staff of another org is isolated too. -------------------
    // Teacher A administers org A only; its active org stays org A, so the other
    // organization and its deck are unreachable even for staff.
    const ownOrg = await getJson(page, `/api/v1/organization/${orgA.id}`);
    expect(ownOrg.status, 'staff reads its own organization').toBe(200);
    expect((ownOrg.body.data as { name: string }).name).toBe(orgA.name);

    const staffForeignOrg = await getJson(page, `/api/v1/organization/${orgB.id}`);
    expect(staffForeignOrg.status, 'staff reads the other organization').toBe(403);

    const staffForeignDeck = await getJson(page, `/api/v1/flashcards/decks/${deckB.id}`);
    expect(staffForeignDeck.status, 'staff reads the other organization deck').toBe(404);
  });
});
