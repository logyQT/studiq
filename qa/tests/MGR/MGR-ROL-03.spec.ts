import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-ROL-03 — the role permission editor (`/manage/roles` → „Uprawnienia roli”).
 *
 * Prerequisite (reconciled with the tenant seeder): an **existing custom role** with
 * one member. The legacy manual seed (`manager@dev.local`, password `pass`) is never
 * used; the case's own tenant provides the manager (admin), the custom role, the
 * custom-role user and the content the scopes are checked against.
 *
 * Tenant: `qa/tests/profiles/MGR-ROL-03.json` declares `{ profile: "content", plan:
 * "hub" }`, so the suite seeds one organization with its admin (`manager`), teacher,
 * member (`student`) and default group **before Playwright starts**:
 *
 *   bun scripts/qa-tenant.ts --all --run <suffix>
 *   bun scripts/qa-tenant.ts MGR-ROL-03 --fresh
 *
 * `--plan hub` puts *this tenant's own* organization on Hub through
 * `apply_org_plan()`: custom roles are a `role.builder` feature, and the Launch plan
 * deliberately has no role builder. This is tenant-local — the plan catalog, feature
 * flags and every other org are untouched.
 *
 * The spec then provisions the case's own prerequisite **through the product API**:
 * it resets any content a previous run on the same seeded tenant left behind, creates
 * the `content-reader` custom role (zero grants), creates the three content families
 * that make the scopes distinguishable — `own` by the custom-role member, `group`
 * shared with the tenant's default group, `org` at organization level — and finally
 * grants the role to the member. Nothing is written through the service role.
 *
 * Acceptance points:
 * 1. „Uprawnienia roli” opens the editor with the five case sections (Fiszki, Talie,
 *    Tematy, Banki pytań, Pytania) and the three scopes (Własne / Grupa / Organizacja)
 *    for every read/create/update/delete row.
 * 2. „Zapisz uprawnienia” shows the toast „Uprawnienia zaktualizowane”, closes the
 *    dialog and persists exactly the 20 chosen permission scopes; reopening the
 *    editor shows them pre-selected.
 * 3. A user holding that role sees content according to the scope, for every section:
 *    „Własne” → only their own rows, „Grupa” → their own + group-linked rows,
 *    „Organizacja” → every row of the organization. This is checked for all five
 *    sections on the API the pages call and on the user's own content pages.
 * 4. Changing the scope replaces the previous one (own → group → organization), so the
 *    saved permissions are live, not a one-off snapshot.
 */

const CASE = 'MGR-ROL-03';

const ROLE_NAME = 'content-reader';
const ROLE_DESCRIPTION = 'Custom role for MGR-ROL-03';

/** Polish copy of `ManageRolesPage` (the case is written against the Polish UI). */
const TOAST_SAVED = 'Uprawnienia zaktualizowane';
const SAVE_LABEL = 'Zapisz uprawnienia';
const CANCEL_LABEL = 'Anuluj';

type Scope = 'own' | 'group' | 'organization';

/** The three content families, keyed by the scope they are visible in. */
type ContentScope = 'own' | 'group' | 'org';

const SECTIONS = [
  { key: 'flashcard', title: 'Fiszki' },
  { key: 'deck', title: 'Talie' },
  { key: 'topic', title: 'Tematy' },
  { key: 'question_bank', title: 'Banki pytań' },
  { key: 'question', title: 'Pytania' },
] as const;

const ACTIONS = ['read', 'create', 'update', 'delete'] as const;

/** Content names, one per scope family, so the UI can be asserted by name. */
const CONTENT_NAMES = {
  deck: { own: 'deck-own', group: 'deck-group', org: 'deck-org' },
  topic: { own: 'topic-own', group: 'topic-group', org: 'topic-org' },
  bank: { own: 'bank-own', group: 'bank-group', org: 'bank-org' },
} as const;

interface ContentRow {
  id: string;
  name: string;
}

interface CardRow {
  id: string;
}

interface QuestionRow {
  id: string;
}

/** The content the three scopes are checked against, as created by this run. */
interface CaseContent {
  decks: Record<ContentScope, ContentRow>;
  topics: Record<ContentScope, ContentRow>;
  banks: Record<ContentScope, ContentRow>;
  cards: Record<ContentScope, CardRow>;
  questions: Record<ContentScope, QuestionRow>;
}

/** The seeded tenant plus the state this spec provisioned through the API. */
interface CaseContext {
  tenant: QaTenant;
  content: CaseContent;
  roleId: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url}`).toBe(200);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success`).toBe(true);
  return body.data;
}

async function postJson<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  expect(response.status(), `POST ${url} → ${await response.text()}`).toBe(201);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `POST ${url} success`).toBe(true);
  return body.data;
}

async function putJson<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.put(url, { data });
  expect(response.status(), `PUT ${url} → ${await response.text()}`).toBe(200);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `PUT ${url} success`).toBe(true);
  return body.data;
}

/**
 * Delete the tenant's content through the product API, so a repeated run on the same
 * seeded tenant starts from an empty organization instead of inheriting the previous
 * run's rows. Cards/questions go first, then their decks/banks, then the topics.
 *
 * A question can only be deleted by its creator, so a row the admin is refused is
 * removed by the member account instead (both calls are the product's own DELETE).
 */
async function resetContent(page: Page, tenant: QaTenant): Promise<void> {
  for (const path of [
    '/api/v1/questions',
    '/api/v1/flashcards',
    '/api/v1/flashcards/decks',
    '/api/v1/questions/banks',
    '/api/v1/flashcards/topics',
  ]) {
    const ownedByMember: string[] = [];
    for (const row of await listRows(page, path)) {
      const url = `${path}/${row.id as string}`;
      const response = await page.request.delete(url);
      if (response.status() === 403) {
        ownedByMember.push(url);
        continue;
      }
      expect(response.status(), `DELETE ${url}`).toBe(200);
    }
    if (ownedByMember.length === 0) continue;

    await signInAs(page, tenant, 'student', /\/app(\/|$)/);
    for (const url of ownedByMember) {
      const response = await page.request.delete(url);
      expect(response.status(), `DELETE ${url} (as the member who created it)`).toBe(200);
    }
    await signInAs(page, tenant, 'manager', /\/manage$/);
  }
}

/**
 * The case's prerequisite: the custom role exists before the editor is opened, with
 * no permissions at all (a fresh tenant has none; a repeated run may still carry the
 * grants the previous run saved).
 */
async function ensureCustomRole(page: Page): Promise<string> {
  const roles = await getJson<Array<{ id: string; name: string; isSystem: boolean }>>(
    page,
    '/api/v1/organization/roles',
  );
  const existing = roles.find((role) => !role.isSystem && role.name === ROLE_NAME);
  const role =
    existing ??
    (await postJson<{ id: string }>(page, '/api/v1/organization/roles', {
      name: ROLE_NAME,
      description: ROLE_DESCRIPTION,
    }));

  await putJson(page, `/api/v1/organization/roles/${role.id}/permissions`, { permissions: [] });
  return role.id;
}

/** The id of one of the tenant org's system roles (`admin`, `teacher`, `member`). */
async function orgRoleId(page: Page, name: string): Promise<string> {
  const roles = await getJson<Array<{ id: string; name: string }>>(
    page,
    '/api/v1/organization/roles',
  );
  const role = roles.find((candidate) => candidate.name === name);
  if (!role) throw new Error(`tenant org has no ${name} role`);
  return role.id;
}

/** Give the tenant's member (the student account) an org role. */
async function setMemberRole(page: Page, tenant: QaTenant, roleId: string): Promise<void> {
  const reader = tenant.users.student;
  if (!reader) throw new Error(`tenant ${tenant.case} has no seeded student user`);
  await putJson(page, '/api/v1/organization/members', {
    targetUserId: reader.id,
    newOrgRoleId: roleId,
  });
}

/**
 * Create the three content families that make the three scopes distinguishable,
 * through the product API:
 *
 * - `own`   — created by the custom-role member,
 * - `group` — created by the admin and shared with the tenant's default group,
 * - `org`   — created by the admin, in the org, not shared with any group.
 *
 * Group scope must therefore yield own + group, organization scope all three, and
 * own scope only the first. Everything stays inside the tenant's own organization.
 */
async function createContent(page: Page, tenant: QaTenant): Promise<CaseContent> {
  const groupId = tenant.group?.id;
  if (!groupId) throw new Error(`tenant ${tenant.case}: the content profile seeds no group`);

  const createCard = (deckId: string, scope: ContentScope): Promise<CardRow> =>
    postJson<CardRow>(page, '/api/v1/flashcards', {
      deckId,
      front: `${CONTENT_NAMES.deck[scope]}-front`,
      back: `${CONTENT_NAMES.deck[scope]}-back`,
    });
  const createQuestion = (bankId: string, scope: ContentScope): Promise<QuestionRow> =>
    postJson<QuestionRow>(page, '/api/v1/questions', {
      bankId,
      type: 'mcq',
      content: `${CONTENT_NAMES.bank[scope]}-question`,
      answers: [
        { content: 'correct', isCorrect: true },
        { content: 'wrong', isCorrect: false },
      ],
    });

  // `own` — the member creates their own deck/topic/bank and one row in each, while
  // still holding the default `member` role (a role without grants cannot create).
  await signInAs(page, tenant, 'student', /\/app(\/|$)/);
  const ownDeck = await postJson<ContentRow>(page, '/api/v1/flashcards/decks', {
    name: CONTENT_NAMES.deck.own,
    visibility: 'personal',
  });
  const ownTopic = await postJson<ContentRow>(page, '/api/v1/flashcards/topics', {
    name: CONTENT_NAMES.topic.own,
    visibility: 'personal',
  });
  const ownBank = await postJson<ContentRow>(page, '/api/v1/questions/banks', {
    name: CONTENT_NAMES.bank.own,
    visibility: 'personal',
  });
  const ownCard = await createCard(ownDeck.id, 'own');
  const ownQuestion = await createQuestion(ownBank.id, 'own');

  // `group` and `org` — the admin creates both; only the `group` rows are shared
  // with the tenant's default group.
  await signInAs(page, tenant, 'manager', /\/manage$/);
  const groupDeck = await postJson<ContentRow>(page, '/api/v1/flashcards/decks', {
    name: CONTENT_NAMES.deck.group,
    visibility: 'group',
    groupIds: [groupId],
  });
  const orgDeck = await postJson<ContentRow>(page, '/api/v1/flashcards/decks', {
    name: CONTENT_NAMES.deck.org,
    visibility: 'personal',
  });
  const groupTopic = await postJson<ContentRow>(page, '/api/v1/flashcards/topics', {
    name: CONTENT_NAMES.topic.group,
    visibility: 'group',
    groupIds: [groupId],
  });
  const orgTopic = await postJson<ContentRow>(page, '/api/v1/flashcards/topics', {
    name: CONTENT_NAMES.topic.org,
    visibility: 'personal',
  });
  const groupBank = await postJson<ContentRow>(page, '/api/v1/questions/banks', {
    name: CONTENT_NAMES.bank.group,
    visibility: 'group',
    groupIds: [groupId],
  });
  const orgBank = await postJson<ContentRow>(page, '/api/v1/questions/banks', {
    name: CONTENT_NAMES.bank.org,
    visibility: 'personal',
  });
  const groupCard = await createCard(groupDeck.id, 'group');
  const orgCard = await createCard(orgDeck.id, 'org');
  const groupQuestion = await createQuestion(groupBank.id, 'group');
  const orgQuestion = await createQuestion(orgBank.id, 'org');

  return {
    decks: {
      own: { id: ownDeck.id, name: ownDeck.name },
      group: { id: groupDeck.id, name: groupDeck.name },
      org: { id: orgDeck.id, name: orgDeck.name },
    },
    topics: {
      own: { id: ownTopic.id, name: ownTopic.name },
      group: { id: groupTopic.id, name: groupTopic.name },
      org: { id: orgTopic.id, name: orgTopic.name },
    },
    banks: {
      own: { id: ownBank.id, name: ownBank.name },
      group: { id: groupBank.id, name: groupBank.name },
      org: { id: orgBank.id, name: orgBank.name },
    },
    cards: {
      own: { id: ownCard.id },
      group: { id: groupCard.id },
      org: { id: orgCard.id },
    },
    questions: {
      own: { id: ownQuestion.id },
      group: { id: groupQuestion.id },
      org: { id: orgQuestion.id },
    },
  };
}
/** Rows of a tenant scope: own → 1, group → 2 (own + group), organization → 3. */
function visibleFor<T>(rows: Record<ContentScope, T>, scope: Scope): T[] {
  if (scope === 'own') return [rows.own];
  if (scope === 'group') return [rows.own, rows.group];
  return [rows.own, rows.group, rows.org];
}

/**
 * Real login through the API, then boot the app with the locale the case's copy is
 * written in and the tenant's organization active. Logs the previous user out first
 * so the manager ↔ custom-role user switch is a real session switch.
 */
async function signInAs(
  page: Page,
  tenant: QaTenant,
  role: QaRole,
  waitFor: RegExp,
): Promise<void> {
  await page.request.post('/api/v1/auth/logout');
  await loginAs(page, tenant, role, { locale: 'pl', waitFor });
}

interface ListBody {
  success: boolean;
  data: { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
}

/** Fetch a list endpoint as the signed-in user and return its rows. */
async function listRows(page: Page, path: string): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as ListBody;
  expect(body.success, `GET ${path} success`).toBe(true);
  return Array.isArray(body.data) ? body.data : (body.data.items ?? []);
}

async function listIds(page: Page, path: string): Promise<string[]> {
  return (await listRows(page, path)).map((row) => row.id as string).sort();
}

interface RolePermission {
  permissionName: string;
  scope: string;
}

async function readRolePermissions(page: Page, roleId: string): Promise<RolePermission[]> {
  const response = await page.request.get(`/api/v1/organization/roles/${roleId}`);
  expect(response.status(), `GET /api/v1/organization/roles/${roleId}`).toBe(200);
  const body = (await response.json()) as {
    success: boolean;
    data: { permissions: RolePermission[] };
  };
  expect(body.success, 'role detail success').toBe(true);
  return body.data.permissions;
}

/** Open „Uprawnienia roli <name>” and return the editor dialog. */
async function openPermissionEditor(page: Page, roleName: string) {
  await page.getByRole('button', { name: `Uprawnienia roli ${roleName}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`Edytuj uprawnienia: ${roleName}`)).toBeVisible();
  return dialog;
}

/** Set every section to one scope, the way a tester ticks the 20 radios. */
async function setAllSections(dialog: Locator, scope: Scope) {
  for (const section of SECTIONS) {
    for (const action of ACTIONS) {
      await dialog
        .locator(`input[data-perm-radio="true"][name="${section.key}.${action}"][value="${scope}"]`)
        .check();
    }
  }
  await expect(dialog.locator('input[data-perm-radio="true"]:checked')).toHaveCount(20);
}

/**
 * A full manager round: sign in, open the role editor, set the five sections to
 * `scope`, save, assert the toast + persistence + readback.
 */
async function saveRoleScope(page: Page, context: CaseContext, scope: Scope): Promise<void> {
  await signInAs(page, context.tenant, 'manager', /\/manage$/);

  // Enter the page the way a manager does: dashboard → „Role” in the sidebar.
  await page.locator('a[href="/manage/roles"]').first().click();
  await expect(page).toHaveURL(/\/manage\/roles$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Role' })).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(ROLE_NAME) });
  await expect(row).toHaveCount(1);

  const dialog = await openPermissionEditor(page, ROLE_NAME);

  // The editor always offers the five case sections and the three scopes per row.
  for (const section of SECTIONS) {
    await expect(dialog.getByText(section.title, { exact: true })).toBeVisible();
  }
  await expect(dialog.locator('input[data-perm-radio="true"]')).toHaveCount(
    SECTIONS.length * ACTIONS.length * 3,
  );
  for (const label of ['Własne', 'Grupa', 'Organizacja']) {
    await expect(dialog.getByText(label, { exact: true }).first()).toBeVisible();
  }

  await setAllSections(dialog, scope);

  await dialog.getByRole('button', { name: SAVE_LABEL }).click();

  // Step 3: toast „Uprawnienia zaktualizowane”, dialog closes, list reloads.
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: TOAST_SAVED }),
    'save toast',
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText('20 uprawnień')).toBeVisible();

  // The write persisted exactly the 20 scopes, not a subset or a stale merge.
  const permissions = await readRolePermissions(page, context.roleId);
  expect(permissions).toHaveLength(SECTIONS.length * ACTIONS.length);
  for (const permission of permissions) {
    expect(permission.scope, `${permission.permissionName} scope`).toBe(scope);
  }
  expect(new Set(permissions.map((permission) => permission.permissionName)).size).toBe(
    SECTIONS.length * ACTIONS.length,
  );

  // Reopening the editor renders the saved scopes pre-selected.
  const reopened = await openPermissionEditor(page, ROLE_NAME);
  for (const section of SECTIONS) {
    for (const action of ACTIONS) {
      await expect(
        reopened.locator(`input[name="${section.key}.${action}"][value="${scope}"]`),
        `${section.key}.${action} pre-selected ${scope}`,
      ).toBeChecked();
    }
  }
  await expect(reopened.locator('input[data-perm-radio="true"]:checked')).toHaveCount(20);
  await reopened.getByRole('button', { name: CANCEL_LABEL }).click();
  await expect(reopened).toHaveCount(0);
}

/** A visible text match: the cards render both a mobile and a desktop copy. */
function visibleText(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

/**
 * Step 4: sign in as the holder of the custom role and assert the content that user
 * may see, on the API the pages call and on the user's content pages.
 */
async function expectReaderContent(page: Page, context: CaseContext, scope: Scope): Promise<void> {
  await signInAs(page, context.tenant, 'student', /\/app(\/|$)/);

  const expectedDecks = visibleFor(context.content.decks, scope);
  const expectedCards = visibleFor(context.content.cards, scope);
  const expectedTopics = visibleFor(context.content.topics, scope);
  const expectedBanks = visibleFor(context.content.banks, scope);
  const expectedQuestions = visibleFor(context.content.questions, scope);

  // „Własne” → only own; „Grupa” → own + group; „Organizacja” → all org content.
  expect(await listIds(page, '/api/v1/flashcards/decks'), 'decks').toEqual(
    expectedDecks.map((row) => row.id).sort(),
  );
  expect(await listIds(page, '/api/v1/flashcards'), 'flashcards').toEqual(
    expectedCards.map((row) => row.id).sort(),
  );
  expect(await listIds(page, '/api/v1/flashcards/topics'), 'topics').toEqual(
    expectedTopics.map((row) => row.id).sort(),
  );
  expect(await listIds(page, '/api/v1/questions/banks'), 'question banks').toEqual(
    expectedBanks.map((row) => row.id).sort(),
  );
  expect(await listIds(page, '/api/v1/questions'), 'questions').toEqual(
    expectedQuestions.map((row) => row.id).sort(),
  );

  // The reader's deck page renders exactly the visible decks.
  await page.goto('/app/flashcards');
  await expect(
    page.getByText(new RegExp(`^${expectedDecks.length} (talia|talie|talii)$`)),
    `deck count ${expectedDecks.length}`,
  ).toBeVisible();
  for (const deck of expectedDecks) {
    await expect(visibleText(page, deck.name), `visible deck ${deck.name}`).toHaveCount(1);
  }
  for (const deck of Object.values(context.content.decks).filter(
    (candidate) => !expectedDecks.some((expected) => expected.id === candidate.id),
  )) {
    await expect(visibleText(page, deck.name), `hidden deck ${deck.name}`).toHaveCount(0);
  }

  // The other content pages follow the same scope matrix.
  await page.goto('/app/topics');
  for (const topic of expectedTopics) {
    await expect(visibleText(page, topic.name), `visible topic ${topic.name}`).toHaveCount(1);
  }
  for (const topic of Object.values(context.content.topics).filter(
    (candidate) => !expectedTopics.some((expected) => expected.id === candidate.id),
  )) {
    await expect(visibleText(page, topic.name), `hidden topic ${topic.name}`).toHaveCount(0);
  }

  await page.goto('/app/questions');
  for (const bank of expectedBanks) {
    await expect(visibleText(page, bank.name), `visible bank ${bank.name}`).toHaveCount(1);
  }
  for (const bank of Object.values(context.content.banks).filter(
    (candidate) => !expectedBanks.some((expected) => expected.id === candidate.id),
  )) {
    await expect(visibleText(page, bank.name), `hidden bank ${bank.name}`).toHaveCount(0);
  }
}

test.describe('@case:MGR-ROL-03 @area:MGR @prio:P2 role permission editor', () => {
  test.setTimeout(240_000);

  test('scopes saved in the role editor drive the member content access', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.plan, `${CASE} needs its tenant org on Hub`).toBe('hub');
    expect(tenant.org, `${CASE} needs the seeded organization`).toBeTruthy();
    expect(tenant.group, `${CASE} needs the seeded default group`).toBeTruthy();

    // --- Prerequisite: the custom role, zero grants, and the scope content --------
    // Everything below is provisioned through the product API, so a repeated run on
    // the same seeded tenant starts from the case's own prerequisite rather than
    // from the state the previous run left behind.
    await signInAs(page, tenant, 'manager', /\/manage$/);
    const roleId = await ensureCustomRole(page);
    // The default `member` role first, so the member can create (and clean up) the
    // content that is theirs before the custom role takes its grants away.
    await setMemberRole(page, tenant, await orgRoleId(page, 'member'));
    await resetContent(page, tenant);
    const content = await createContent(page, tenant);
    // The custom role's single member: the tenant's student account.
    await setMemberRole(page, tenant, roleId);

    const context: CaseContext = { tenant, content, roleId };

    // Role and content are in place; the editor opens on the tenant's own role.
    await page.goto('/manage/roles');
    await expect(page.getByRole('heading', { level: 1, name: 'Role' })).toBeVisible();
    const roleRow = page.getByRole('row', { name: new RegExp(ROLE_NAME) });
    await expect(roleRow.locator('td').nth(1).getByText('Niestandardowa')).toBeVisible();
    await expect(roleRow.locator('td').nth(2)).toHaveText('1');
    await expect(roleRow.locator('td').nth(3)).toHaveText('0 uprawnień');

    // „Własne” for all five sections → the member sees only their own content.
    await saveRoleScope(page, context, 'own');
    await expectReaderContent(page, context, 'own');

    // „Grupa” for all five sections → own + group content, never org-only content.
    await saveRoleScope(page, context, 'group');
    await expectReaderContent(page, context, 'group');

    // „Organizacja” for all five sections → all of the organization's content.
    await saveRoleScope(page, context, 'organization');
    await expectReaderContent(page, context, 'organization');

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
