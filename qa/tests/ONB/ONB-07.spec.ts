import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { shortHash, tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * ONB-07 — switching organizations (teacher in two orgs).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator who is a
 * **teacher in two organizations**, each with its own groups, question banks and
 * flashcard decks. The legacy manual account (`teacher1@dev.local`, password
 * `pass`) is never used.
 *
 * Tenant: `tenantKey('qa/cases/ONB-07.md', <title>, 'qa-shared')::<run suffix>`.
 * Every org/user/group/bank/deck id is `tenantId(key, entity)`, so a run is
 * reproducible by pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which
 * gives each independent run its own two orgs and content.
 *
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`) instead of reading a pre-seeded
 * `qa/.tenants/ONB-07.json`: the case needs two orgs and per-org content that
 * differs on every run, and a spec-owned tenant keeps the three independent runs
 * from ever reading a previous run's rows. Nothing global is written — no
 * settings, feature flags, plans or platform rows — and no other case's tenant
 * is touched.
 */

const CASE_FILE = 'qa/cases/ONB-07.md';
const TITLE = 'ONB-07 switching organizations updates the visible content';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}${randomTag(4)}`;
const KEY = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface Entity {
  id: string;
  name: string;
}

interface CaseOrg {
  id: string;
  name: string;
  groups: Entity[];
  banks: Entity[];
  decks: Entity[];
}

interface CaseTenant {
  key: string;
  teacher: SeedAccount;
  orgs: [CaseOrg, CaseOrg];
  /** An existing org this teacher is deliberately **not** a member of. */
  foreignOrg: Entity;
}

interface OrgMembership {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

let tenant!: CaseTenant;

/** Resolve the shared Supabase admin credentials (env → CI env → worker config → local defaults). */
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
 * Seed two orgs for one teacher plus a third org the teacher must never reach.
 * Each org gets two teacher-led groups, two question banks and two decks; all
 * rows are keyed by the deterministic tenant id.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const tag = shortHash(`${KEY}:teacher`);
  const teacher = buildAccount(KEY, 'teacher', 'educator', {
    email: `qa+${tag}+teacher@test.local`,
    name: 'QA teacher',
  });

  const label = (suffix: string) => `ONB07 ${RUN_SUFFIX} ${suffix}`;
  const org = (side: 'A' | 'B'): CaseOrg => {
    const group = (n: 1 | 2): Entity => ({
      id: tenantId(KEY, `group:${side.toLowerCase()}${n}`),
      name: label(`${side} G${n}`),
    });
    return {
      id: tenantId(KEY, `org:${side}`),
      name: label(side),
      groups: [group(1), group(2)],
      banks: [1, 2].map((n) => ({
        id: tenantId(KEY, `bank:${side.toLowerCase()}${n}`),
        name: label(`${side} Bank ${n}`),
      })),
      decks: [1, 2].map((n) => ({
        id: tenantId(KEY, `deck:${side.toLowerCase()}${n}`),
        name: label(`${side} Deck ${n}`),
      })),
    };
  };

  const orgA = org('A');
  const orgB = org('B');
  const foreignOrg: Entity = {
    id: tenantId(KEY, 'org:foreign'),
    name: label('foreign'),
  };

  // Each org is seeded under its own membership key so the shared helper's
  // `org_members`/`group_members` ids stay unique per org. The teacher keeps the
  // same deterministic account in both orgs and is a `teacher` in each.
  for (const org of [orgA, orgB] as const) {
    await seedTenantGraph(db, {
      key: `${KEY}:${org.name}`,
      org: { id: org.id, name: org.name },
      defaultGroup: { ...org.groups[0], isDefault: true },
      extraGroups: org.groups.slice(1).map((group) => ({ ...group, isDefault: false })),
      owner: teacher,
      members: [],
      ownerOrgRole: 'teacher',
    });
  }

  const fail = async (promise: PromiseLike<{ error: { message: string } | null }>) => {
    const result = await promise;
    if (result.error) throw new Error(`seed ${KEY}: ${result.error.message}`);
  };

  // `seedTenantGraph` only enrolls the owner in the default group; the second
  // group needs a teacher row or the groups list (an inner join on teacher
  // membership) would hide it.
  await fail(
    db.from('group_members').upsert(
      [orgA, orgB].map((org) => ({
        id: tenantId(KEY, `gm:${org.groups[1].id}`),
        group_id: org.groups[1].id,
        user_id: teacher.id,
        role: 'teacher' as const,
      })),
      { onConflict: 'id' },
    ),
  );

  await fail(
    db
      .from('organizations')
      .upsert([{ id: foreignOrg.id, name: foreignOrg.name }], { onConflict: 'id' }),
  );

  const banks = [orgA, orgB].flatMap((org) =>
    org.banks.map((bank, index) => ({ ...bank, orgId: org.id, groupId: org.groups[index].id })),
  );
  const decks = [orgA, orgB].flatMap((org) =>
    org.decks.map((deck, index) => ({ ...deck, orgId: org.id, groupId: org.groups[index].id })),
  );

  await fail(
    db.from('question_banks').upsert(
      banks.map((bank) => ({
        id: bank.id,
        organization_id: bank.orgId,
        created_by: teacher.id,
        name: bank.name,
        visibility: 'group' as const,
      })),
      { onConflict: 'id' },
    ),
  );
  await fail(
    db.from('flashcard_decks').upsert(
      decks.map((deck) => ({
        id: deck.id,
        organization_id: deck.orgId,
        created_by: teacher.id,
        name: deck.name,
        visibility: 'group' as const,
      })),
      { onConflict: 'id' },
    ),
  );
  await fail(
    db.from('bank_groups').upsert(
      banks.map((bank) => ({ bank_id: bank.id, group_id: bank.groupId })),
      { onConflict: 'bank_id,group_id' },
    ),
  );
  await fail(
    db.from('deck_groups').upsert(
      decks.map((deck) => ({ deck_id: deck.id, group_id: deck.groupId })),
      { onConflict: 'deck_id,group_id' },
    ),
  );

  return { key: KEY, teacher, orgs: [orgA, orgB], foreignOrg };
}

const APP_HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

/** Real login through the API, then boot the app; the context keeps the session cookie. */
async function loginAsTeacher(page: Page): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: tenant.teacher.email, password: tenant.teacher.password },
  });
  expect(response.status(), `login ${tenant.teacher.email}`).toBe(200);

  // The case walks the Polish educator dashboard.
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: APP_HOST, path: '/' }]);

  await page.goto('/edu');
  await expect(page).toHaveURL(/\/edu(\/|$)/, { timeout: 20_000 });
  // Let `useOrgs` settle its auto-selection into exactly one active org.
  await expect
    .poll(async () => (await memberships(page)).filter((org) => org.isActive).length)
    .toBe(1);
}

async function apiData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data;
}

function memberships(page: Page): Promise<OrgMembership[]> {
  return apiData<OrgMembership[]>(page, '/api/v1/me/orgs');
}

async function bankIds(page: Page): Promise<string[]> {
  const body = await apiData<{ items: Entity[] }>(page, '/api/v1/questions/banks?limit=100');
  return body.items.map((bank) => bank.id).sort();
}

async function deckIds(page: Page): Promise<string[]> {
  const body = await apiData<{ items: Entity[] }>(page, '/api/v1/flashcards/decks?limit=100');
  return body.items.map((deck) => deck.id).sort();
}

async function groupIds(page: Page): Promise<string[]> {
  const groups = await apiData<Entity[]>(page, '/api/v1/organization/groups');
  return groups.map((group) => group.id).sort();
}

function ids(entities: Entity[]): string[] {
  return entities.map((entity) => entity.id).sort();
}

const sidebar = (page: Page) => page.locator('[data-slot="sidebar"]');

/**
 * The sidebar has two dropdown triggers: the org switcher (top) and the account
 * menu (bottom). The org switcher is the only one carrying the tenant label.
 */
function orgTrigger(page: Page) {
  return sidebar(page)
    .locator('[data-slot="dropdown-menu-trigger"]')
    .filter({ hasText: `ONB07 ${RUN_SUFFIX}` });
}

async function openSwitcher(page: Page): Promise<void> {
  await orgTrigger(page).click();
  await expect(page.getByRole('menuitem', { name: tenant.orgs[0].name })).toBeVisible();
}

function orgMenuItem(page: Page, org: Entity) {
  return page.getByRole('menuitem', { name: org.name });
}

/**
 * The management cards render a mobile and a desktop variant of the same name;
 * only one of them is visible at the desktop viewport.
 */
function visibleName(page: Page, name: string) {
  return page.getByText(name, { exact: true }).filter({ visible: true });
}

/** The menu marks exactly the active org with the check glyph. */
async function expectActiveInSwitcher(
  page: Page,
  active: CaseOrg,
  inactive: CaseOrg,
): Promise<void> {
  await openSwitcher(page);

  await expect(orgMenuItem(page, active)).toBeVisible();
  await expect(orgMenuItem(page, inactive)).toBeVisible();
  await expect(orgMenuItem(page, active)).toContainText('Teacher');
  await expect(orgMenuItem(page, inactive)).toContainText('Teacher');

  await expect(page.locator('[role="menuitem"] svg.lucide-check')).toHaveCount(1);
  await expect(orgMenuItem(page, active).locator('svg.lucide-check')).toBeVisible();
  await expect(orgMenuItem(page, inactive).locator('svg.lucide-check')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
}

/** Switch through the switcher the way a teacher does; the app must land on /edu. */
async function switchTo(page: Page, org: CaseOrg): Promise<void> {
  await openSwitcher(page);
  await orgMenuItem(page, org).click();
  // Wait for the menu to finish closing: reopening while Radix still holds the
  // trigger in its open state would toggle it closed instead.
  await expect(page.getByRole('menuitem')).toHaveCount(0);

  await expect(page).toHaveURL(/\/edu(\/|$)/, { timeout: 20_000 });
  await expect
    .poll(async () => (await memberships(page)).find((membership) => membership.isActive)?.id)
    .toBe(org.id);
  await expect(orgTrigger(page)).toContainText(org.name);
}

/** Assert the active org's content is the only content every surface lists. */
async function expectOnlyOrgContent(page: Page, visible: CaseOrg, hidden: CaseOrg): Promise<void> {
  // Server state first: the same isolation the UI must render.
  expect(await bankIds(page), 'question banks scoped to the active org').toEqual(
    ids(visible.banks),
  );
  expect(await deckIds(page), 'decks scoped to the active org').toEqual(ids(visible.decks));
  expect(await groupIds(page), 'groups scoped to the active org').toEqual(ids(visible.groups));

  // Pytania — question banks.
  await sidebar(page).locator('a[href="/edu/questions"]').click();
  await expect(page).toHaveURL(/\/edu\/questions$/);
  for (const bank of visible.banks) {
    await expect(visibleName(page, bank.name)).toHaveCount(1);
  }
  for (const bank of hidden.banks) {
    await expect(visibleName(page, bank.name)).toHaveCount(0);
  }

  // Talie — flashcard decks.
  await sidebar(page).locator('a[href="/edu/flashcards"]').click();
  await expect(page).toHaveURL(/\/edu\/flashcards$/);
  for (const deck of visible.decks) {
    await expect(visibleName(page, deck.name)).toHaveCount(1);
  }
  for (const deck of hidden.decks) {
    await expect(visibleName(page, deck.name)).toHaveCount(0);
  }

  // Grupy — organization groups.
  await sidebar(page).locator('a[href="/edu/groups"]').click();
  await expect(page).toHaveURL(/\/edu\/groups$/);
  for (const group of visible.groups) {
    await expect(visibleName(page, group.name)).toHaveCount(1);
  }
  for (const group of hidden.groups) {
    await expect(visibleName(page, group.name)).toHaveCount(0);
  }
}

test.beforeAll(async () => {
  tenant = await seedCaseTenant();
  // Evidence for a failing run: the deterministic tenant this run owns.
  console.log(`ONB-07 tenant: ${tenant.key}`);
});

test.describe('ONB-07 — switching organizations', () => {
  test('lists both orgs and swaps the visible content on every teacher surface', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const [orgA, orgB] = tenant.orgs;

    await loginAsTeacher(page);
    await expect(sidebar(page)).toBeVisible();

    // --- Step 1: the switcher lists exactly this teacher's two orgs ---------
    const listed = await memberships(page);
    expect(listed.map((org) => org.id).sort()).toEqual(ids(tenant.orgs));
    expect(listed.map((org) => org.orgRoleName)).toEqual(['teacher', 'teacher']);

    const first = listed.find((org) => org.isActive)!;
    const firstOrg = tenant.orgs.find((org) => org.id === first.id)!;
    const secondOrg = firstOrg === orgA ? orgB : orgA;

    await expectActiveInSwitcher(page, firstOrg, secondOrg);

    // --- Step 2: switch to the other org → the /edu dashboard --------------
    await switchTo(page, secondOrg);
    await expect(orgTrigger(page), 'the sidebar shows the newly active org').toContainText(
      secondOrg.name,
    );
    await expectActiveInSwitcher(page, secondOrg, firstOrg);

    // --- Step 3: Pytania / Fiszki / Grupy show the new org, only ----------
    await expectOnlyOrgContent(page, secondOrg, firstOrg);

    // --- Step 4: switch back from a content page → /edu again -------------
    await switchTo(page, firstOrg);
    await expectActiveInSwitcher(page, firstOrg, secondOrg);

    await expectOnlyOrgContent(page, firstOrg, secondOrg);

    // The active org is a server cookie: a reload must not fall back to the
    // auto-selected org or show the other org's rows.
    await page.reload();
    await expect(page).toHaveURL(/\/edu\/groups$/);
    for (const group of firstOrg.groups) {
      await expect(visibleName(page, group.name)).toHaveCount(1);
    }
    for (const group of secondOrg.groups) {
      await expect(visibleName(page, group.name)).toHaveCount(0);
    }
    await expect
      .poll(async () => (await memberships(page)).find((org) => org.isActive)?.id)
      .toBe(firstOrg.id);
  });

  test('refuses to switch into an org the teacher does not belong to', async ({ page }) => {
    test.setTimeout(60_000);

    await loginAsTeacher(page);
    const before = await memberships(page);
    const activeBefore = before.find((org) => org.isActive)!;

    // The foreign org exists, but this teacher holds no `org_members` row for it.
    const switched = await page.request.post('/api/v1/me/orgs/switch', {
      data: { orgId: tenant.foreignOrg.id },
    });
    expect(switched.status(), 'switch to a non-member org').toBe(404);

    const after = await memberships(page);
    expect(after.map((org) => org.id).sort()).toEqual(before.map((org) => org.id).sort());
    expect(after.filter((org) => org.isActive).map((org) => org.id)).toEqual([activeBefore.id]);

    // The switcher never offers the foreign org either.
    await openSwitcher(page);
    await expect(page.getByRole('menuitem', { name: tenant.foreignOrg.name })).toHaveCount(0);
  });
});
