import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
 * MGR-ROL-03 — the role permission editor (`/manage/roles` → „Uprawnienia roli”).
 *
 * Prerequisite (reconciled with the tenant seeder): an **existing custom role** with
 * one member. The legacy manual seed (`manager@dev.local`, password `pass`) is never
 * used; the case's own tenant provides the manager (admin), the custom role, the
 * custom-role user and the content the scopes are checked against.
 *
 * Tenant: `tenantKey('qa/cases/MGR-ROL-03.md', <title>, 'qa-shared')::<run suffix>`.
 * Every org/role/user/content id is `tenantId(key, entity)`, so a run is reproducible
 * by pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which gives each
 * independent run its own organization, role, users and content.
 *
 * The org is moved onto the `hub` plan through the product's own `apply_org_plan()`
 * (the same RPC a plan upgrade calls): custom roles are a `role.builder` feature, and
 * the Launch plan deliberately has no role builder. This is tenant-local — the plan
 * catalog, feature flags and every other org are untouched.
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

const CASE_FILE = 'qa/cases/MGR-ROL-03.md';
const TITLE = 'MGR-ROL-03 role permission editor scopes';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

const ROLE_NAME = 'content-reader';
const ROLE_DESCRIPTION = 'Custom role for MGR-ROL-03';

/** Polish copy of `ManageRolesPage` (the case is written against the Polish UI). */
const TOAST_SAVED = 'Uprawnienia zaktualizowane';
const SAVE_LABEL = 'Zapisz uprawnienia';
const CANCEL_LABEL = 'Anuluj';

type Scope = 'own' | 'group' | 'organization';

const SECTIONS = [
  { key: 'flashcard', title: 'Fiszki' },
  { key: 'deck', title: 'Talie' },
  { key: 'topic', title: 'Tematy' },
  { key: 'question_bank', title: 'Banki pytań' },
  { key: 'question', title: 'Pytania' },
] as const;

const ACTIONS = ['read', 'create', 'update', 'delete'] as const;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

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

interface CaseTenant {
  key: string;
  org: { id: string; name: string };
  group: { id: string; name: string };
  manager: SeedAccount;
  reader: SeedAccount;
  roleId: string;
  decks: Record<Scope, ContentRow>;
  topics: Record<Scope, ContentRow>;
  banks: Record<Scope, ContentRow>;
  cards: Record<Scope, CardRow>;
  questions: Record<Scope, QuestionRow>;
}

/**
 * Resolve the shared Supabase admin credentials. `QA_SUPABASE_*` wins; otherwise
 * the routine `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, then the
 * worker's `qa/env.json`, then the shared local defaults.
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

/**
 * Seed the case's org, its custom role and the three content families that make the
 * three scopes distinguishable:
 *
 * - `own`   — created by the custom-role user,
 * - `group` — created by the admin and shared with the tenant's default group,
 * - `org`   — created by the admin, in the org, not shared with any group.
 *
 * Group scope must therefore yield own + group, organization scope all three, and
 * own scope only the first. Content is written through the service-role client with
 * deterministic ids; it is tenant-local and touches nothing shared.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-mgr-rol03-${RUN_SUFFIX}` };
  const group = { id: tenantId(key, 'group:default'), name: 'G1' };

  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const reader = buildAccount(key, 'reader', 'student', { name: 'QA custom role reader' });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { id: group.id, name: group.name, isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [reader],
    ownerOrgRole: 'admin',
  });

  // Custom roles are the `role.builder` feature, which the Launch plan does not
  // include. Upgrade this tenant's own org to Hub with the product's plan RPC.
  const upgrade = await db.rpc('apply_org_plan', { p_org_id: org.id, p_plan: 'hub' });
  if (upgrade.error) {
    throw new Error(`seed ${key}: apply_org_plan(hub) failed: ${upgrade.error.message}`);
  }

  // Prerequisite: a custom role that exists before the editor is opened.
  const roleId = tenantId(key, 'role:content-reader');
  const role = await db.from('org_roles').upsert(
    {
      id: roleId,
      organization_id: org.id,
      name: ROLE_NAME,
      display_name: ROLE_NAME,
      description: ROLE_DESCRIPTION,
      is_system: false,
    },
    { onConflict: 'id' },
  );
  if (role.error) throw new Error(`seed ${key}: org_roles ${role.error.message}`);

  // A pinned run suffix must start from the case's prerequisite, not from the
  // permissions a previous run left behind: the custom role starts without any.
  const clear = await db.from('org_role_permissions').delete().eq('org_role_id', roleId);
  if (clear.error) throw new Error(`seed ${key}: clear permissions ${clear.error.message}`);

  // Give the custom-role user that role in the tenant org.
  const membership = await db
    .from('org_members')
    .update({ org_role_id: roleId })
    .eq('organization_id', org.id)
    .eq('user_id', reader.id);
  if (membership.error) throw new Error(`seed ${key}: org_members ${membership.error.message}`);

  const now = new Date().toISOString();

  const deckRows = {
    own: { id: tenantId(key, 'deck:own'), name: `deck-own-${RUN_SUFFIX}` },
    group: { id: tenantId(key, 'deck:group'), name: `deck-group-${RUN_SUFFIX}` },
    org: { id: tenantId(key, 'deck:org'), name: `deck-org-${RUN_SUFFIX}` },
  };
  const topicRows = {
    own: { id: tenantId(key, 'topic:own'), name: `topic-own-${RUN_SUFFIX}` },
    group: { id: tenantId(key, 'topic:group'), name: `topic-group-${RUN_SUFFIX}` },
    org: { id: tenantId(key, 'topic:org'), name: `topic-org-${RUN_SUFFIX}` },
  };
  const bankRows = {
    own: { id: tenantId(key, 'bank:own'), name: `bank-own-${RUN_SUFFIX}` },
    group: { id: tenantId(key, 'bank:group'), name: `bank-group-${RUN_SUFFIX}` },
    org: { id: tenantId(key, 'bank:org'), name: `bank-org-${RUN_SUFFIX}` },
  };

  const decks = await db.from('flashcard_decks').upsert(
    [
      {
        ...deckRows.own,
        organization_id: org.id,
        created_by: reader.id,
        visibility: 'personal' as const,
        created_at: now,
      },
      {
        ...deckRows.group,
        organization_id: org.id,
        created_by: manager.id,
        visibility: 'group' as const,
        created_at: now,
      },
      {
        ...deckRows.org,
        organization_id: org.id,
        created_by: manager.id,
        visibility: 'personal' as const,
        created_at: now,
      },
    ],
    { onConflict: 'id' },
  );
  if (decks.error) throw new Error(`seed ${key}: flashcard_decks ${decks.error.message}`);

  const deckGroups = await db
    .from('deck_groups')
    .upsert([{ deck_id: deckRows.group.id, group_id: group.id }], {
      onConflict: 'deck_id,group_id',
    });
  if (deckGroups.error) {
    throw new Error(`seed ${key}: deck_groups ${deckGroups.error.message}`);
  }

  const topics = await db.from('topics').upsert(
    [
      {
        ...topicRows.own,
        organization_id: org.id,
        created_by: reader.id,
        visibility: 'personal' as const,
        created_at: now,
      },
      {
        ...topicRows.group,
        organization_id: org.id,
        created_by: manager.id,
        visibility: 'group' as const,
        created_at: now,
      },
      {
        ...topicRows.org,
        organization_id: org.id,
        created_by: manager.id,
        visibility: 'personal' as const,
        created_at: now,
      },
    ],
    { onConflict: 'id' },
  );
  if (topics.error) throw new Error(`seed ${key}: topics ${topics.error.message}`);

  const topicGroups = await db
    .from('topic_groups')
    .upsert([{ topic_id: topicRows.group.id, group_id: group.id }], {
      onConflict: 'topic_id,group_id',
    });
  if (topicGroups.error) {
    throw new Error(`seed ${key}: topic_groups ${topicGroups.error.message}`);
  }

  const banks = await db.from('question_banks').upsert(
    [
      {
        ...bankRows.own,
        organization_id: org.id,
        created_by: reader.id,
        visibility: 'personal' as const,
        created_at: now,
      },
      {
        ...bankRows.group,
        organization_id: org.id,
        created_by: manager.id,
        visibility: 'group' as const,
        created_at: now,
      },
      {
        ...bankRows.org,
        organization_id: org.id,
        created_by: manager.id,
        visibility: 'personal' as const,
        created_at: now,
      },
    ],
    { onConflict: 'id' },
  );
  if (banks.error) throw new Error(`seed ${key}: question_banks ${banks.error.message}`);

  const bankGroups = await db
    .from('bank_groups')
    .upsert([{ bank_id: bankRows.group.id, group_id: group.id }], {
      onConflict: 'bank_id,group_id',
    });
  if (bankGroups.error) {
    throw new Error(`seed ${key}: bank_groups ${bankGroups.error.message}`);
  }

  const cardRows = {
    own: { id: tenantId(key, 'card:own'), deck_id: deckRows.own.id, created_by: reader.id },
    group: { id: tenantId(key, 'card:group'), deck_id: deckRows.group.id, created_by: manager.id },
    org: { id: tenantId(key, 'card:org'), deck_id: deckRows.org.id, created_by: manager.id },
  };
  const cards = await db.from('flashcards').upsert(
    (Object.entries(cardRows) as Array<[Scope, (typeof cardRows)[Scope]]>).map(([scope, card]) => ({
      id: card.id,
      organization_id: org.id,
      deck_id: card.deck_id,
      created_by: card.created_by,
      front: `front-${scope}-${RUN_SUFFIX}`,
      back: `back-${scope}-${RUN_SUFFIX}`,
      visibility: 'personal' as const,
    })),
    { onConflict: 'id' },
  );
  if (cards.error) throw new Error(`seed ${key}: flashcards ${cards.error.message}`);

  const questionRows = {
    own: { id: tenantId(key, 'question:own'), bank_id: bankRows.own.id, created_by: reader.id },
    group: {
      id: tenantId(key, 'question:group'),
      bank_id: bankRows.group.id,
      created_by: manager.id,
    },
    org: { id: tenantId(key, 'question:org'), bank_id: bankRows.org.id, created_by: manager.id },
  };
  const questions = await db.from('questions').upsert(
    (Object.entries(questionRows) as Array<[Scope, (typeof questionRows)[Scope]]>).map(
      ([scope, question]) => ({
        id: question.id,
        organization_id: org.id,
        bank_id: question.bank_id,
        created_by: question.created_by,
        type: 'mcq' as const,
        content: `question-${scope}-${RUN_SUFFIX}`,
        visibility: 'personal' as const,
      }),
    ),
    { onConflict: 'id' },
  );
  if (questions.error) throw new Error(`seed ${key}: questions ${questions.error.message}`);

  return {
    key,
    org,
    group,
    manager: seeded.owner,
    reader: seeded.members[0],
    roleId,
    decks: deckRows,
    topics: topicRows,
    banks: bankRows,
    cards: {
      own: { id: cardRows.own.id },
      group: { id: cardRows.group.id },
      org: { id: cardRows.org.id },
    },
    questions: {
      own: { id: questionRows.own.id },
      group: { id: questionRows.group.id },
      org: { id: questionRows.org.id },
    },
  };
}

/** Rows of a tenant scope: own → 1, group → 2 (own + group), organization → 3. */
function visibleFor<T>(rows: Record<Scope, T>, scope: Scope): T[] {
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
  baseURL: string,
  account: SeedAccount,
  orgId: string,
  waitFor: RegExp,
): Promise<void> {
  await page.request.post('/api/v1/auth/logout');

  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: orgId, domain: hostname, path: '/', httpOnly: true },
  ]);

  await page.goto('/login');
  await expect(page).toHaveURL(waitFor, { timeout: 20_000 });
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
async function saveRoleScope(
  page: Page,
  baseURL: string,
  tenant: CaseTenant,
  scope: Scope,
): Promise<void> {
  await signInAs(page, baseURL, tenant.manager, tenant.org.id, /\/manage$/);

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
  const permissions = await readRolePermissions(page, tenant.roleId);
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
async function expectReaderContent(
  page: Page,
  baseURL: string,
  tenant: CaseTenant,
  scope: Scope,
): Promise<void> {
  await signInAs(page, baseURL, tenant.reader, tenant.org.id, /\/app(\/|$)/);

  const expectedDecks = visibleFor(tenant.decks, scope);
  const expectedCards = visibleFor(tenant.cards, scope);
  const expectedTopics = visibleFor(tenant.topics, scope);
  const expectedBanks = visibleFor(tenant.banks, scope);
  const expectedQuestions = visibleFor(tenant.questions, scope);

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
  for (const deck of Object.values(tenant.decks).filter(
    (candidate) => !expectedDecks.some((expected) => expected.id === candidate.id),
  )) {
    await expect(visibleText(page, deck.name), `hidden deck ${deck.name}`).toHaveCount(0);
  }

  // The other content pages follow the same scope matrix.
  await page.goto('/app/topics');
  for (const topic of expectedTopics) {
    await expect(visibleText(page, topic.name), `visible topic ${topic.name}`).toHaveCount(1);
  }
  for (const topic of Object.values(tenant.topics).filter(
    (candidate) => !expectedTopics.some((expected) => expected.id === candidate.id),
  )) {
    await expect(visibleText(page, topic.name), `hidden topic ${topic.name}`).toHaveCount(0);
  }

  await page.goto('/app/questions');
  for (const bank of expectedBanks) {
    await expect(visibleText(page, bank.name), `visible bank ${bank.name}`).toHaveCount(1);
  }
  for (const bank of Object.values(tenant.banks).filter(
    (candidate) => !expectedBanks.some((expected) => expected.id === candidate.id),
  )) {
    await expect(visibleText(page, bank.name), `hidden bank ${bank.name}`).toHaveCount(0);
  }
}

test.describe('@case:MGR-ROL-03 @area:MGR @prio:P2 role permission editor', () => {
  test.setTimeout(240_000);

  let tenant: CaseTenant;

  test.beforeAll(async () => {
    tenant = await seedCaseTenant();
    console.log(
      `MGR-ROL-03 tenant key: ${tenant.key} (org ${tenant.org.id}, role ${tenant.roleId}, ` +
        `manager ${tenant.manager.email}, reader ${tenant.reader.email})`,
    );
  });

  test('scopes saved in the role editor drive the member content access', async ({
    page,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';

    // The custom role starts without permissions (the case's prerequisite).
    await signInAs(page, origin, tenant.manager, tenant.org.id, /\/manage$/);
    await page.goto('/manage/roles');
    await expect(page.getByRole('heading', { level: 1, name: 'Role' })).toBeVisible();
    const roleRow = page.getByRole('row', { name: new RegExp(ROLE_NAME) });
    await expect(roleRow.locator('td').nth(1).getByText('Niestandardowa')).toBeVisible();
    await expect(roleRow.locator('td').nth(2)).toHaveText('1');
    await expect(roleRow.locator('td').nth(3)).toHaveText('0 uprawnień');

    // „Własne” for all five sections → the member sees only their own content.
    await saveRoleScope(page, origin, tenant, 'own');
    await expectReaderContent(page, origin, tenant, 'own');

    // „Grupa” for all five sections → own + group content, never org-only content.
    await saveRoleScope(page, origin, tenant, 'group');
    await expectReaderContent(page, origin, tenant, 'group');

    // „Organizacja” for all five sections → all of the organization's content.
    await saveRoleScope(page, origin, tenant, 'organization');
    await expectReaderContent(page, origin, tenant, 'organization');

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
