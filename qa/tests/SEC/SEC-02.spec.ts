import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  request as apiRequest,
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
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
 * SEC-02 — a student of another organization cannot reach a deck or the
 * organization data of an organization they do not belong to.
 *
 * Prerequisite (reconciled with the tenant seeder): a student who is a member of
 * **another** organization than the deck's owner. The legacy manual seed
 * (`student2@dev.local`, WSB Merito / UE Wrocław, password `pass`) is never used.
 * The case's own tenant has two organizations:
 *
 * - org A — teacher A (admin) and student A (member of the default group); teacher A
 *   owns a group-visible deck `O1G1T1 <run>` with one card, shared to that group.
 * - org B — teacher B (admin) and student B (member of the default group); teacher B
 *   owns a group-visible deck `O2G1T1 <run>`. Student B is the outsider: it belongs
 *   to org B only and never to org A.
 *
 * Tenant: `tenantKey('qa/cases/SEC-02.md', <title>, 'qa-shared')::<run>` with one
 * `::org-a` / `::org-b` suffix per organization, so the two graphs cannot collide on
 * `org_members.id`. Every account/org/group id is `tenantId(key, entity)`, so a run
 * is reproducible by pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which
 * gives each independent run its own pair of organizations.
 *
 * The spec seeds its own graphs through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`) instead of reading `qa/.tenants/SEC-02.json`,
 * so it needs no `bun scripts/qa-tenant.ts SEC-02` step. Nothing global is written —
 * no settings, flags, plans or platform rows — and no other case's tenant is touched.
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

const CASE_FILE = 'qa/cases/SEC-02.md';
const TITLE = 'SEC-02 cross-organization deck and organization isolation';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const ORG_A_GROUP = `O1G1-${RUN_SUFFIX}`;
const ORG_B_GROUP = `O2G1-${RUN_SUFFIX}`;
const DECK_A = `O1G1T1 ${RUN_SUFFIX}`;
const DECK_B = `O2G1T1 ${RUN_SUFFIX}`;
const CARD_A = { front: `front-secret-a-${RUN_SUFFIX}`, back: `back-secret-a-${RUN_SUFFIX}` };
const CARD_B = { front: `front-b-${RUN_SUFFIX}`, back: `back-b-${RUN_SUFFIX}` };

/** Polish copy the case quotes; `NEXT_LOCALE=pl` pins it for the run. */
const UI = {
  deckNotFound: 'Nie znaleziono talii',
  deckNotFoundDescription: 'Ta talia mogła zostać usunięta lub nie masz do niej dostępu.',
} as const;

interface QaDeck {
  id: string;
  name: string;
  groupId: string;
  cardId: string;
  cardFront: string;
}

interface QaOrg {
  id: string;
  name: string;
  deck: QaDeck;
}

interface Sec02Tenant {
  key: string;
  teacherA: SeedAccount;
  studentA: SeedAccount;
  teacherB: SeedAccount;
  studentB: SeedAccount;
  orgA: QaOrg;
  orgB: QaOrg;
}

/**
 * Resolve the shared Supabase admin credentials. The worker's `qa/env.json` wins over
 * `process.env`: the repository `.env` names the per-slot stack, which is not running
 * in the shared QA setup, and `bun` auto-loads it.
 */
function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url: process.env.QA_SUPABASE_URL ?? fromEnvJson ?? LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

async function login(api: APIRequestContext, account: SeedAccount): Promise<void> {
  const response = await api.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);
}

/**
 * Create the org's deck through the real API as its teacher: log in, switch to the
 * org (the app's own membership-checked endpoint), then create a group-visible deck
 * with one card. This is the same shape as the case's `O1G1T1` (teacher's deck shared
 * to a group).
 */
async function createSharedDeck(
  api: APIRequestContext,
  owner: SeedAccount,
  orgId: string,
  groupId: string,
  name: string,
  card: { front: string; back: string },
): Promise<QaDeck> {
  await login(api, owner);

  const switched = await api.post('/api/v1/me/orgs/switch', { data: { orgId } });
  expect(switched.status(), `switch ${owner.email} to ${orgId}`).toBe(200);

  const created = await api.post('/api/v1/flashcards/decks', {
    data: { name, visibility: 'group', groupIds: [groupId] },
  });
  expect(created.status(), `create deck ${name}`).toBe(201);
  const deckId = ((await created.json()) as { data: { id: string } }).data.id;

  const createdCard = await api.post('/api/v1/flashcards', { data: { deckId, ...card } });
  expect(createdCard.status(), `create card in ${name}`).toBe(201);
  const cardId = ((await createdCard.json()) as { data: { id: string } }).data.id;

  const loggedOut = await api.post('/api/v1/auth/logout');
  expect(loggedOut.status(), 'logout after seeding a deck').toBe(200);

  return { id: deckId, name, groupId, cardId, cardFront: card.front };
}

/** Both organizations of the case, each with its own teacher, student and deck. */
async function seedCaseTenant(baseURL: string): Promise<Sec02Tenant> {
  const base = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const keyA = `${base}::org-a`;
  const keyB = `${base}::org-b`;

  const teacherA = buildAccount(keyA, 'teacher-a', 'educator', {
    name: `SEC-02 teacher A ${RUN_SUFFIX}`,
  });
  const studentA = buildAccount(keyA, 'student-a', 'student', {
    name: `SEC-02 student A ${RUN_SUFFIX}`,
  });
  const teacherB = buildAccount(keyB, 'teacher-b', 'educator', {
    name: `SEC-02 teacher B ${RUN_SUFFIX}`,
  });
  const studentB = buildAccount(keyB, 'student-b', 'student', {
    name: `SEC-02 student B ${RUN_SUFFIX}`,
  });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seededA = await seedTenantGraph(db, {
    key: keyA,
    org: { id: tenantId(keyA, 'org'), name: `qa-sec02-a-${RUN_SUFFIX}` },
    defaultGroup: { id: tenantId(keyA, 'group:default'), name: ORG_A_GROUP, isDefault: true },
    extraGroups: [],
    owner: teacherA,
    members: [studentA],
    ownerOrgRole: 'admin',
  });
  const seededB = await seedTenantGraph(db, {
    key: keyB,
    org: { id: tenantId(keyB, 'org'), name: `qa-sec02-b-${RUN_SUFFIX}` },
    defaultGroup: { id: tenantId(keyB, 'group:default'), name: ORG_B_GROUP, isDefault: true },
    extraGroups: [],
    owner: teacherB,
    members: [studentB],
    ownerOrgRole: 'admin',
  });

  const api = await apiRequest.newContext({ baseURL });
  try {
    const deckA = await createSharedDeck(
      api,
      teacherA,
      seededA.orgId!,
      seededA.defaultGroupId!,
      DECK_A,
      CARD_A,
    );
    const deckB = await createSharedDeck(
      api,
      teacherB,
      seededB.orgId!,
      seededB.defaultGroupId!,
      DECK_B,
      CARD_B,
    );

    return {
      key: base,
      teacherA,
      studentA,
      teacherB,
      studentB,
      orgA: { id: seededA.orgId!, name: `qa-sec02-a-${RUN_SUFFIX}`, deck: deckA },
      orgB: { id: seededB.orgId!, name: `qa-sec02-b-${RUN_SUFFIX}`, deck: deckB },
    };
  } finally {
    await api.dispose();
  }
}

/**
 * Real login through the API, the real org switch, then boot the app with the Polish
 * locale the case's copy is written in. Logs any previous persona out first so a
 * switch inside the test can never inherit the other account's session.
 */
async function signInAs(
  page: Page,
  baseURL: string,
  account: SeedAccount,
  orgId: string,
): Promise<void> {
  await page.request.post('/api/v1/auth/logout');

  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);

  const switched = await page.request.post('/api/v1/me/orgs/switch', { data: { orgId } });
  expect(switched.status(), `switch ${account.email} to ${orgId}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);

  await page.goto('/app');
  // Students land in /app, teachers in /edu and managers in /manage; the proxy
  // redirects by account type, so wait for whichever dashboard this account owns.
  await expect(page).toHaveURL(/\/(app|edu|manage)(\/|$)/, { timeout: 30_000 });
}

/** The deck the case's API step reads, plus its JSON payload. */
async function getJson(
  page: Page,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await page.request.get(path);
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

test.describe('SEC-02 — isolation between organizations', () => {
  test('a student of another organization cannot open the deck or read the organization', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3010';
    const tenant = await seedCaseTenant(baseURL);

    // --- Premise: the deck is genuinely shared with org A's group. -----------------
    await signInAs(page, baseURL, tenant.studentA, tenant.orgA.id);

    const inOrgDeck = await getJson(page, `/api/v1/flashcards/decks/${tenant.orgA.deck.id}`);
    expect(inOrgDeck.status, 'in-org group member reads the shared deck').toBe(200);
    expect((inOrgDeck.body.data as { name: string }).name).toBe(tenant.orgA.deck.name);

    await page.goto(`/app/flashcards/${tenant.orgA.deck.id}`);
    await expect(page.getByText(tenant.orgA.deck.name, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(tenant.orgA.deck.cardFront).filter({ visible: true }).first(),
    ).toBeVisible();

    // --- Case step 1: the outsider opens the deck URL. -----------------------------
    await signInAs(page, baseURL, tenant.studentB, tenant.orgB.id);

    await page.goto(`/app/flashcards/${tenant.orgA.deck.id}`);
    await expect(page.getByText(UI.deckNotFound, { exact: true })).toBeVisible();
    await expect(page.getByText(UI.deckNotFoundDescription)).toBeVisible();
    // Neither the deck's identity nor its content may appear for the outsider.
    await expect(page.getByText(tenant.orgA.deck.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(tenant.orgA.deck.cardFront)).toHaveCount(0);

    // --- Case step 2: the API must not return the deck, its cards or the org. ------
    const foreignDeck = await getJson(page, `/api/v1/flashcards/decks/${tenant.orgA.deck.id}`);
    expect(foreignDeck.status, 'foreign deck read').toBe(404);
    expect(foreignDeck.body.error).toBe('NOT_FOUND');
    expect(JSON.stringify(foreignDeck.body)).not.toContain(tenant.orgA.deck.name);
    expect(JSON.stringify(foreignDeck.body)).not.toContain(tenant.orgA.deck.cardFront);

    const foreignCards = await getJson(
      page,
      `/api/v1/flashcards?deckIds=${tenant.orgA.deck.id}&limit=30`,
    );
    expect(foreignCards.status, 'foreign deck card list').toBe(200);
    expect((foreignCards.body.data as { items: unknown[] }).items).toHaveLength(0);

    const foreignCard = await getJson(page, `/api/v1/flashcards/${tenant.orgA.deck.cardId}`);
    expect(foreignCard.status, 'foreign card read').toBe(404);
    expect(JSON.stringify(foreignCard.body)).not.toContain(tenant.orgA.deck.cardFront);

    const foreignOrg = await getJson(page, `/api/v1/organization/${tenant.orgA.id}`);
    expect(foreignOrg.status, 'foreign organization read').toBe(403);
    expect(foreignOrg.body.error).toBe('FORBIDDEN');
    expect(JSON.stringify(foreignOrg.body)).not.toContain(tenant.orgA.name);

    // A student has no member-administration access at all; whatever the answer is,
    // it must never carry the other organization's members.
    const members = await getJson(page, '/api/v1/organization/members');
    expect(members.status, 'student requesting the member list').toBe(403);
    expect(JSON.stringify(members.body)).not.toContain(tenant.teacherA.email);
    expect(JSON.stringify(members.body)).not.toContain(tenant.studentA.email);

    // A write from the outsider is refused as "not found" and changes nothing.
    const rename = await page.request.put(`/api/v1/flashcards/decks/${tenant.orgA.deck.id}`, {
      data: { name: 'pwned-by-outsider' },
    });
    expect([403, 404], `foreign deck rename got ${rename.status()}`).toContain(rename.status());

    // The outsider's own deck list only carries its own organization's deck.
    const deckList = await getJson(page, '/api/v1/flashcards/decks?limit=200');
    expect(deckList.status, 'deck list').toBe(200);
    const listedNames = (deckList.body.data as { items: { name: string }[] }).items.map(
      (deck) => deck.name,
    );
    expect(listedNames).toContain(tenant.orgB.deck.name);
    expect(listedNames).not.toContain(tenant.orgA.deck.name);

    // --- Positive control: the same outsider does read its own org's deck. ---------
    const ownDeck = await getJson(page, `/api/v1/flashcards/decks/${tenant.orgB.deck.id}`);
    expect(ownDeck.status, 'own-org deck read').toBe(200);
    expect((ownDeck.body.data as { name: string }).name).toBe(tenant.orgB.deck.name);

    await page.goto(`/app/flashcards/${tenant.orgB.deck.id}`);
    await expect(page.getByText(tenant.orgB.deck.name, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(tenant.orgB.deck.cardFront).filter({ visible: true }).first(),
    ).toBeVisible();

    // --- The denied write did not touch the deck: its owner still sees it intact. --
    await signInAs(page, baseURL, tenant.teacherA, tenant.orgA.id);
    const ownerDeck = await getJson(page, `/api/v1/flashcards/decks/${tenant.orgA.deck.id}`);
    expect(ownerDeck.status, 'owner reads the deck after the denied write').toBe(200);
    expect((ownerDeck.body.data as { name: string }).name).toBe(tenant.orgA.deck.name);
    expect((ownerDeck.body.data as { flashcard_count: number }).flashcard_count).toBe(1);

    // --- Adjacent control: staff of another org is isolated too. -------------------
    await signInAs(page, baseURL, tenant.teacherB, tenant.orgB.id);

    const ownOrg = await getJson(page, `/api/v1/organization/${tenant.orgB.id}`);
    expect(ownOrg.status, 'staff reads its own organization').toBe(200);
    expect((ownOrg.body.data as { name: string }).name).toBe(tenant.orgB.name);

    const staffForeignOrg = await getJson(page, `/api/v1/organization/${tenant.orgA.id}`);
    expect(staffForeignOrg.status, 'staff reads the other organization').toBe(403);

    const staffForeignDeck = await getJson(page, `/api/v1/flashcards/decks/${tenant.orgA.deck.id}`);
    expect(staffForeignDeck.status, 'staff reads the other organization deck').toBe(404);
  });
});
