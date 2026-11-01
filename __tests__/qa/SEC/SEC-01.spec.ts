import type { Browser, Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import {
  expect,
  loadTenant,
  loginAs,
  test,
  type QaRole,
  type QaTenant,
} from '@qa/fixtures/qa-tenant';

/**
 * SEC-01 — Student nie widzi treści innej grupy.
 *
 * Prerequisite (reconciled with the tenant seeder): a student who is a member of
 * one group, and content (deck + question bank) that a teacher shares with a
 * *different* group of the same organization. The legacy manual seed
 * (`student1@dev.local`, `O1G1`/`O1G2`, password `pass`) is never used.
 *
 * Tenant: the `content` profile of this case
 * (`tenantKey('qa/cases/SEC-01.md', 'SEC-01#<run>', 'qa-shared')` plus a fresh run
 * suffix, written to `qa/.tenants/SEC-01.json` by
 * `bun scripts/qa-tenant.ts SEC-01 --fresh`). Every account and the default group
 * `G1` come from the shared seeder; no account, org or group id is hard-coded.
 *
 * The second group and all content are built through the product's own API, so
 * the rows carry real authorship and org scoping and nothing is shared with
 * another case or worker:
 *
 * - the manager creates group `G2` and makes the teacher teach `G1` and `G2`
 *   (sharing content to a group requires the `teacher` role in that group);
 * - the teacher creates a deck and a question bank shared with `G1` (control,
 *   must be reachable by the student) and a deck and a bank shared only with `G2`
 *   (the case's „talia O1G2T2 z innej grupy”, must be sealed off);
 * - the student belongs to `G1` only.
 *
 * Acceptance points confirmed during the walk on the shared app:
 * 1. `/app/flashcards/<foreign deck>` renders „Nie znaleziono talii” and never the
 *    deck's name or card contents.
 * 2. `GET /api/v1/flashcards/decks/<foreign deck>` answers 403/404 with no deck
 *    payload, and the deck's cards do not come back from `/api/v1/flashcards`.
 * 3. `GET /api/v1/questions/banks` lists the student's own-group bank only.
 * 4. Control: the student's own-group deck opens normally and its card is shown.
 *
 * Nothing global is written: no admin setting, feature flag, plan, platform stat
 * or singleton row; only this run's own tenant rows are touched.
 */

const CASE = 'SEC-01';
const TENANT: QaTenant = loadTenant(CASE);

/** Run suffix the seeder folded into the tenant key (stable tenants have none). */
const RUN = TENANT.runSuffix ?? 'stable';

/** Polish copy from the app's message catalog (pl.json), the case's exact wording. */
const COPY = {
  deckNotFound: 'Nie znaleziono talii',
  deckNotFoundDescription: 'Ta talia mogła zostać usunięta lub nie masz do niej dostępu.',
  backToFlashcards: 'Wróć do fiszek',
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

interface SeededContent {
  /** Deck and bank shared with the student's own group G1 (positive control). */
  ownDeck: { id: string; name: string; cardFront: string };
  ownBank: NamedRow;
  /** Deck and bank shared with the other group G2 (must stay sealed off). */
  foreignDeck: { id: string; name: string; cardFront: string };
  foreignBank: NamedRow;
}

function account(tenant: QaTenant, role: QaRole) {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user;
}

/**
 * A signed-in API session for one seeded account, pinned to the tenant's org.
 * The app only writes `active_org_id` when an org is created or switched, so a
 * seeded membership needs the cookie set here — otherwise `withAuth` scopes the
 * request to no org and the setup rows land outside the tenant.
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

async function createGroup(page: Page, name: string, orgId: string): Promise<string> {
  const response = await page.request.post('/api/v1/organization/groups', { data: { name } });
  if (response.status() === 409) {
    // A retry after a transport error finds the group the interrupted attempt already created.
    // The API's list hides groups without a teacher, so look the exact name up in this tenant.
    const { data, error } = await createQaSupabase()
      .from('groups')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', name)
      .single();
    expect(error, `existing group ${name}`).toBeNull();
    return data!.id;
  }
  expectCreated(response, 'POST /api/v1/organization/groups');
  return ((await response.json()) as ApiEnvelope<{ id: string }>).data.id;
}

/** Replace a group's roster (the group page's own `PUT`). */
async function setGroupMembers(
  page: Page,
  groupId: string,
  members: Array<{ userId: string; role: 'teacher' | 'member' }>,
): Promise<void> {
  const response = await page.request.put(`/api/v1/organization/groups/${groupId}/members`, {
    data: { members },
  });
  expect(response.status(), `PUT /api/v1/organization/groups/${groupId}/members`).toBe(200);
}

async function createDeck(page: Page, name: string, groupId: string): Promise<NamedRow> {
  const response = await page.request.post('/api/v1/flashcards/decks', {
    data: { name, visibility: 'group', groupIds: [groupId] },
  });
  expectCreated(response, 'POST /api/v1/flashcards/decks');
  return ((await response.json()) as ApiEnvelope<NamedRow>).data;
}

async function createCard(page: Page, deckId: string, front: string): Promise<void> {
  const response = await page.request.post('/api/v1/flashcards', {
    data: { deckId, front, back: `back ${front}` },
  });
  expectCreated(response, 'POST /api/v1/flashcards');
}

async function createBank(page: Page, name: string, groupId: string): Promise<NamedRow> {
  const response = await page.request.post('/api/v1/questions/banks', {
    data: { name, visibility: 'group', groupIds: [groupId] },
  });
  expectCreated(response, 'POST /api/v1/questions/banks');
  return ((await response.json()) as ApiEnvelope<NamedRow>).data;
}

/**
 * Build the case's data inside its own tenant: one group the student belongs to
 * (the seeded `G1`) and a second group they do not, each with a teacher-owned
 * deck and bank.
 */
async function seedCaseContent(browser: Browser, baseURL: string): Promise<SeededContent> {
  const orgId = TENANT.org?.id;
  const ownGroupId = TENANT.group?.id;
  if (!orgId || !ownGroupId) {
    throw new Error(`tenant ${CASE} needs the content profile (org + default group)`);
  }

  const manager = await apiSession(browser, baseURL, orgId, 'manager');
  let foreignGroupId: string;
  try {
    foreignGroupId = await createGroup(manager.page, `G2 ${RUN}`, orgId);
    await setGroupMembers(manager.page, foreignGroupId, [
      { userId: account(TENANT, 'teacher').id, role: 'teacher' },
    ]);
    // The seeder enrolls the teacher as a plain member of the default group;
    // sharing content to a group requires teaching it, so the manager promotes
    // the teacher there as well (the roster is replaced, the student stays).
    await setGroupMembers(manager.page, ownGroupId, [
      { userId: account(TENANT, 'manager').id, role: 'teacher' },
      { userId: account(TENANT, 'teacher').id, role: 'teacher' },
      { userId: account(TENANT, 'student').id, role: 'member' },
    ]);
  } finally {
    await manager.close();
  }

  const teacher = await apiSession(browser, baseURL, orgId, 'teacher');
  try {
    const ownDeckRow = await createDeck(teacher.page, `Talia G1 ${RUN}`, ownGroupId);
    const ownCardFront = `Fiszka G1 ${RUN}`;
    await createCard(teacher.page, ownDeckRow.id, ownCardFront);

    const foreignDeckRow = await createDeck(teacher.page, `Talia G2 ${RUN}`, foreignGroupId);
    const foreignCardFront = `Fiszka G2 ${RUN}`;
    await createCard(teacher.page, foreignDeckRow.id, foreignCardFront);

    return {
      ownDeck: { id: ownDeckRow.id, name: ownDeckRow.name, cardFront: ownCardFront },
      ownBank: await createBank(teacher.page, `Bank G1 ${RUN}`, ownGroupId),
      foreignDeck: {
        id: foreignDeckRow.id,
        name: foreignDeckRow.name,
        cardFront: foreignCardFront,
      },
      foreignBank: await createBank(teacher.page, `Bank G2 ${RUN}`, foreignGroupId),
    };
  } finally {
    await teacher.close();
  }
}

function listIds<T extends { id: string }>(body: ApiEnvelope<{ items: T[] }>): string[] {
  return body.data.items.map((item) => item.id);
}

test.describe('@case:SEC-01 @area:SEC @prio:P1 group content isolation', () => {
  let content: SeededContent;

  test.beforeAll(async ({ browser, baseURL }) => {
    content = await seedCaseContent(browser, baseURL ?? 'http://localhost:3010');
    console.log(`SEC-01 tenant key: ${TENANT.key}`);
    console.log(`SEC-01 org: ${TENANT.org?.id} (${TENANT.org?.name})`);
    console.log(`SEC-01 own deck (G1): ${content.ownDeck.id} ${content.ownDeck.name}`);
    console.log(`SEC-01 foreign deck (G2): ${content.foreignDeck.id} ${content.foreignDeck.name}`);
    console.log(`SEC-01 own bank (G1): ${content.ownBank.id} ${content.ownBank.name}`);
    console.log(`SEC-01 foreign bank (G2): ${content.foreignBank.id} ${content.foreignBank.name}`);
  });

  test("a student cannot read another group's deck or bank, but keeps their own group's", async ({
    page,
  }) => {
    await loginAs(page, TENANT, 'student', { locale: 'pl', waitFor: /\/app/ });

    // 1. The page for the other group's deck renders the not-found state and no
    //    deck content (case: „Strona: Nie znaleziono talii”).
    await page.goto(`/app/flashcards/${content.foreignDeck.id}`);
    await expect(page.getByRole('heading', { name: COPY.deckNotFound, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.deckNotFoundDescription, { exact: true })).toBeVisible();
    //    The recovery link goes to the student's deck list, not the dashboard:
    //    this screen owns the deck area, so "back" must stay inside it.
    await expect(
      page.getByRole('link', { name: COPY.backToFlashcards, exact: true }),
    ).toHaveAttribute('href', '/app/flashcards');
    await expect(page.getByText(content.foreignDeck.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(content.foreignDeck.cardFront, { exact: true })).toHaveCount(0);

    // 2. The deck endpoint answers 403/404 and carries no deck payload.
    const deckResponse = await page.request.get(
      `/api/v1/flashcards/decks/${content.foreignDeck.id}`,
    );
    expect([403, 404], 'foreign deck detail status').toContain(deckResponse.status());
    const deckText = await deckResponse.text();
    expect(deckText, 'no foreign deck name in the response').not.toContain(
      content.foreignDeck.name,
    );
    expect(deckText, 'no foreign card in the response').not.toContain(
      content.foreignDeck.cardFront,
    );
    const deckBody = JSON.parse(deckText) as { success: boolean; data?: unknown };
    expect(deckBody.success).toBe(false);
    expect(deckBody.data).toBeUndefined();

    // 3. The deck's cards are not readable through the flashcards endpoint either.
    const cardsResponse = await page.request.get(
      `/api/v1/flashcards?deckIds=${content.foreignDeck.id}&limit=50`,
    );
    expect(cardsResponse.status(), 'GET /api/v1/flashcards?deckIds=<foreign>').toBe(200);
    const cardsBody = (await cardsResponse.json()) as ApiEnvelope<{ items: { id: string }[] }>;
    expect(cardsBody.data.items, 'no cards from the other group').toEqual([]);

    // 4. The bank list contains only the bank shared with the student's group.
    const banksResponse = await page.request.get('/api/v1/questions/banks?limit=100');
    expect(banksResponse.status(), 'GET /api/v1/questions/banks').toBe(200);
    const banksBody = (await banksResponse.json()) as ApiEnvelope<{
      items: Array<{ id: string; name: string }>;
    }>;
    const bankIds = listIds(banksBody);
    expect(bankIds, 'own-group bank is listed').toContain(content.ownBank.id);
    expect(bankIds, "other group's bank is not listed").not.toContain(content.foreignBank.id);
    const bankNames = banksBody.data.items.map((bank) => bank.name);
    expect(bankNames).toContain(content.ownBank.name);
    expect(bankNames).not.toContain(content.foreignBank.name);

    // 5. Control: the same student opens their own group's deck and sees its card,
    //    and the deck list offers only the own-group deck.
    await page.goto(`/app/flashcards/${content.ownDeck.id}`);
    await expect(
      page.getByRole('heading', { name: content.ownDeck.name, exact: true }),
    ).toBeVisible();
    // A flip card keeps its hidden side in the DOM, so only the visible one counts.
    const visibleCardFront = page
      .getByText(content.ownDeck.cardFront, { exact: true })
      .filter({ visible: true });
    await expect(visibleCardFront.first()).toBeVisible();

    const decksResponse = await page.request.get('/api/v1/flashcards/decks?limit=200');
    expect(decksResponse.status(), 'GET /api/v1/flashcards/decks').toBe(200);
    const decksBody = (await decksResponse.json()) as ApiEnvelope<{
      items: Array<{ id: string; name: string }>;
    }>;
    const deckIds = listIds(decksBody);
    expect(deckIds, 'own-group deck is listed').toContain(content.ownDeck.id);
    expect(deckIds, "other group's deck is not listed").not.toContain(content.foreignDeck.id);
  });
});
