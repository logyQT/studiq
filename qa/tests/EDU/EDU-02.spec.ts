import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
} from '#test/helpers/tenant-seed';

/**
 * EDU-02 — Menu boczne nauczyciela (/edu).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator signed in to
 * `/edu` whose entitlements include `group.manage` (the case's „plan Lite”) and
 * `ai.chat` (the case lists „Asystent Q” in the main section). The legacy manual
 * account (`teacher1@dev.local`, password `pass`) is never used.
 *
 * Tenant: `tenantKey('qa/cases/EDU-02.md', 'EDU-02 teacher sidebar', 'qa-shared')::<run suffix>`.
 * One organization (default group `G1`) with an admin, a student and two educator
 * accounts:
 *   - `teacher`  — org role `teacher` → `ai.chat` + `group.manage`;
 *   - `teacher2` — org role `member`  → `ai.chat`, no `group.manage`.
 * The second account is the negative control for the case's „Grupy widoczne tylko
 * gdy plan ma funkcję group.manage”: every organization plan includes
 * `group.manage`, so the absence branch is exercised through the role's resolved
 * feature set, which is exactly what `/api/v1/features/me` returns and what the
 * sidebar filters on.
 *
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`) instead of reading `qa/.tenants/EDU-02.json`
 * because the seeded role/plan shape is case-specific; every id is
 * `tenantId(key, entity)`. The entitlement is applied to this tenant's own
 * organization with `apply_org_plan` (the same RPC the billing webhook calls), so
 * no global plan, flag, setting or platform row is written and no other worker's
 * tenant is touched.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. Three sections with exactly these items: Główne (Przegląd, Asystent Q),
 *    Treści (Talie, Tematy, Pytania, Testy, Kartkówki, Zgłoszenia, Grupy),
 *    Statystyki (Treści, Wyniki, Aktywność).
 * 2. Every item opens its own page, marks itself active and never renders the
 *    404 — including „Asystent Q”, which the case flagged as a KNOWN PROBLEM.
 *    `/edu/ai` exists since #433 and renders the assistant, so the intended
 *    behaviour is a working page, not the predicted 404.
 * 3. The „Klasa”/classroom section stays hidden (commented out in the sidebar).
 * 4. „Grupy” disappears when the resolved feature set has no `group.manage`,
 *    while „Asystent Q” (ai.chat) stays — so the gate is specific.
 */

const CASE = 'EDU-02';
const CASE_FILE = 'qa/cases/EDU-02.md';
const TITLE = 'EDU-02 teacher sidebar';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** The plan whose resolved feature set matches the case's expected menu. */
const PLAN = 'hub';

const NOT_FOUND_COPY = 'Nie znaleziono strony';

interface NavEntry {
  /** Sidebar item label, exactly as the Polish UI renders it. */
  label: string;
  href: string;
  /** Title the page header shows once the item is opened. */
  header: string;
  /** Page-specific marker inside `<main>`, so a working shell is not enough. */
  marker: string;
}

const SIDEBAR_GROUPS = [
  { label: 'Główne', items: ['Przegląd', 'Asystent Q'] },
  {
    label: 'Treści',
    items: ['Talie', 'Tematy', 'Pytania', 'Testy', 'Kartkówki', 'Zgłoszenia', 'Grupy'],
  },
  { label: 'Statystyki', items: ['Treści', 'Wyniki', 'Aktywność'] },
] as const;

/** Same menu for an educator whose resolved features lack `group.manage`. */
const SIDEBAR_WITHOUT_GROUPS = [
  SIDEBAR_GROUPS[0],
  { label: 'Treści', items: ['Talie', 'Tematy', 'Pytania', 'Testy', 'Kartkówki', 'Zgłoszenia'] },
  SIDEBAR_GROUPS[2],
] as const;

const NAV_ITEMS: NavEntry[] = [
  { label: 'Przegląd', href: '/edu', header: 'Panel Nauczyciela', marker: 'Pierwsze kroki' },
  { label: 'Asystent Q', href: '/edu/ai', header: 'Asystent Q', marker: 'Asystent Q' },
  { label: 'Talie', href: '/edu/flashcards', header: 'Talie fiszek', marker: 'Talie fiszek' },
  { label: 'Tematy', href: '/edu/topics', header: 'Tematy fiszek', marker: 'Tematy fiszek' },
  { label: 'Pytania', href: '/edu/questions', header: 'Pytania', marker: 'Pytania' },
  { label: 'Testy', href: '/edu/quizzes', header: 'Quizy', marker: 'Quizy' },
  { label: 'Kartkówki', href: '/edu/assignments', header: 'Kartkówki', marker: 'Kartkówki' },
  { label: 'Zgłoszenia', href: '/edu/reports', header: 'Zgłoszenia', marker: 'Zgłoszenia' },
  { label: 'Grupy', href: '/edu/groups', header: 'Grupy', marker: 'Grupy' },
  { label: 'Treści', href: '/edu/stats/data', header: 'Treści', marker: 'Treści' },
  { label: 'Wyniki', href: '/edu/stats/results', header: 'Wyniki', marker: 'Wyniki' },
  {
    label: 'Aktywność',
    href: '/edu/stats/activity',
    header: 'Aktywność',
    marker: 'Aktywność studentów',
  },
];

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

/** Seed the case's organization: the entitled teacher, the unentitled one, a student. */
async function seedCaseTenant(): Promise<QaTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-edu02-${RUN_SUFFIX}` };
  const group = { id: tenantId(key, 'group:default'), name: 'G1' };

  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const teacher = buildAccount(key, 'teacher', 'educator', {
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });
  const teacher2 = buildAccount(key, 'teacher2', 'educator', {
    name: 'QA teacher 2',
    orgRole: 'member',
  });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { ...group, isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [teacher, student, teacher2],
    ownerOrgRole: 'admin',
  });

  // The case's paid entitlement, applied to this tenant's own organization only.
  const { error } = await db.rpc('apply_org_plan', { p_org_id: org.id, p_plan: PLAN });
  if (error) throw new Error(`seed ${key}: apply_org_plan(${PLAN}) ${error.message}`);

  const account = (seed: (typeof seeded.members)[number]) => ({
    id: seed.id,
    email: seed.email,
    password: seed.password,
  });

  return {
    case: CASE,
    key,
    profile: 'content',
    plan: PLAN,
    runSuffix: RUN_SUFFIX,
    org,
    group,
    users: {
      teacher: account(seeded.members[0]),
      student: account(seeded.members[1]),
      teacher2: account(seeded.members[2]),
    },
  };
}

let tenant: QaTenant;

test.beforeAll(async () => {
  tenant = await seedCaseTenant();
  console.log(`EDU-02 tenant key: ${tenant.key} (org ${tenant.org?.id})`);
});

/** The desktop sidebar — the only navigation this case is about. */
function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]');
}

/** Rendered sidebar menu as `[{ label, items }]`, labels and items trimmed. */
async function readSidebar(page: Page): Promise<{ label: string; items: string[] }[]> {
  const groups = sidebar(page).locator('[data-slot="sidebar-group"]');
  const count = await groups.count();
  const out: { label: string; items: string[] }[] = [];
  for (let index = 0; index < count; index++) {
    const group = groups.nth(index);
    const label = (await group.locator('[data-slot="sidebar-group-label"]').innerText()).trim();
    const items = (await group.locator('[data-slot="sidebar-menu-item"] a').allInnerTexts()).map(
      (text) => text.trim(),
    );
    out.push({ label, items });
  }
  return out;
}

/** A sidebar menu link, scoped to the menu so header/footer anchors never match. */
function navLink(page: Page, href: string) {
  return sidebar(page).locator(`[data-slot="sidebar-menu-item"] a[href="${href}"]`).first();
}

/** Uncaught errors and failed documents for the whole navigation walk. */
function watchPage(page: Page) {
  const pageErrors: string[] = [];
  const failedDocuments: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.request().resourceType() === 'document' && response.status() >= 400) {
      failedDocuments.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  return { pageErrors, failedDocuments };
}

test.describe('@case:EDU-02 @area:EDU @prio:P2 teacher sidebar', () => {
  test('lists every entitled section and each item opens its own page', async ({ page }) => {
    test.setTimeout(180_000);
    const { pageErrors, failedDocuments } = watchPage(page);

    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'teacher lands on /edu').toBe('/edu');

    const features = await page.request.get('/api/v1/features/me');
    expect(features.status(), 'GET /api/v1/features/me').toBe(200);
    const enabled = ((await features.json()) as { data: { features: string[] } }).data.features;
    expect(enabled, 'the teacher is entitled to the menu items under test').toEqual(
      expect.arrayContaining(['ai.chat', 'group.manage']),
    );

    // 1. The three sections and their items, in order. The feature query resolves
    //    after the first paint, so poll until the gated items are in place.
    await expect
      .poll(() => readSidebar(page), { timeout: 15_000, message: 'teacher sidebar menu' })
      .toEqual(SIDEBAR_GROUPS);

    // 3. The „Klasa”/classroom section is not rendered in any form.
    const nav = sidebar(page);
    await expect(
      nav.locator('[data-slot="sidebar-menu-item"] a[href^="/edu/classroom"]'),
    ).toHaveCount(0);
    await expect(nav, 'the classroom section is hidden').not.toContainText('Klasa');

    // 2. Click every item: the page it owns renders, the item is marked active,
    //    and the 404 never appears.
    for (const entry of NAV_ITEMS) {
      const link = navLink(page, entry.href);
      await expect(link, `„${entry.label}” is in the menu`).toBeVisible();
      await expect(link, `„${entry.label}” points at ${entry.href}`).toContainText(entry.label);

      await link.click();
      await expect(page, `„${entry.label}” opens ${entry.href}`).toHaveURL(
        new RegExp(`${entry.href}$`),
      );
      await expect(page.locator('header'), `header after „${entry.label}”`).toContainText(
        entry.header,
      );
      await expect(
        page.locator('main').getByText(entry.marker, { exact: true }).first(),
        `„${entry.label}” renders its own page`,
      ).toBeVisible();
      await expect(
        nav.locator(`[data-slot="sidebar-menu-item"] a[href="${entry.href}"][data-active="true"]`),
        `„${entry.label}” is highlighted while open`,
      ).toHaveCount(1);
      await expect(
        page.getByText(NOT_FOUND_COPY, { exact: true }),
        `„${entry.label}” must not be a 404`,
      ).toHaveCount(0);

      // „Grupy” is a real list for this tenant, not an empty shell.
      if (entry.href === '/edu/groups') {
        await expect(
          page.locator('main').getByText(tenant.group!.name, { exact: true }),
          'the tenant’s own group is listed',
        ).toBeVisible();
      }
    }

    // The case's KNOWN PROBLEM: „Asystent Q” must open the assistant, not a 404.
    // `/edu/ai` was added in #433, so the intended behaviour is the working page.
    await navLink(page, '/edu/ai').click();
    await expect(page).toHaveURL(/\/edu\/ai$/);
    await expect(page.getByRole('heading', { name: /^Cześć/ })).toBeVisible();
    await expect(page.getByText('Jak mogę pomóc Ci w nauce?', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Zapytaj Q')).toBeVisible();
    await expect(page.getByText(NOT_FOUND_COPY, { exact: true })).toHaveCount(0);

    expect(failedDocuments, 'no navigation may answer with an error status').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the menu walk').toEqual([]);
  });

  test('hides „Grupy” when the resolved features lack group.manage', async ({ page }) => {
    test.setTimeout(120_000);
    const { pageErrors } = watchPage(page);

    await loginAs(page, tenant, 'teacher2', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    const features = await page.request.get('/api/v1/features/me');
    expect(features.status(), 'GET /api/v1/features/me').toBe(200);
    const enabled = ((await features.json()) as { data: { features: string[] } }).data.features;
    expect(enabled, 'ai.chat is entitled').toContain('ai.chat');
    expect(enabled, 'group.manage is not entitled').not.toContain('group.manage');

    await expect
      .poll(() => readSidebar(page), { timeout: 15_000, message: 'educator sidebar menu' })
      .toEqual(SIDEBAR_WITHOUT_GROUPS);

    const nav = sidebar(page);
    await expect(
      nav.locator('[data-slot="sidebar-menu-item"] a[href="/edu/groups"]'),
      '„Grupy” is gated by group.manage',
    ).toHaveCount(0);
    // The gate is specific: the ai.chat item stays for the same account.
    await expect(navLink(page, '/edu/ai'), '„Asystent Q” still shows').toBeVisible();
    await expect(nav, 'the classroom section is hidden').not.toContainText('Klasa');

    expect(pageErrors, 'uncaught page errors on the educator dashboard').toEqual([]);
  });
});
