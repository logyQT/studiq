/**
 * PUB-08 — 404 inside the dashboards (student / educator / manager).
 *
 * Case: `qa/cases/PUB-08.md`. Each dashboard renders its own not-found boundary
 * inside the dashboard shell, so the sidebar stays visible and the page offers
 * role-specific shortcuts:
 *
 *   /app/nie-istnieje     → „No to niezłe combo…” + Fiszki / Quiz / Statystyki
 *   /edu/nie-istnieje     → „Nie znaleziono strony” + Przegląd / Pytania / Fiszki / Statystyki
 *   /manage/nie-istnieje  → „Nie znaleziono strony” + Przegląd / Członkowie / Zaproszenia / Ustawienia
 *
 * `/edu/nie-istnieje` intentionally has no „Klasa” shortcut (product decision
 * #292: `/edu/classroom` has no landing page; member/group management lives in
 * the manager panel), so the test pins its absence.
 *
 * The case is read-only, but the suite still runs on its own tenant: the org and
 * accounts come from the same `tenantKey`/`tenantId` primitives as
 * `scripts/qa-tenant.ts` (key: `PUB-08.md::PUB-08::qa-shared`). Every run drops
 * and re-seeds that graph, so a run never inherits another run's state.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';
import type { Database } from '@studiq/server/types/database';

const CASE_ID = 'PUB-08';
const PROJECT = 'qa-shared';
const LOCALE = 'pl';

type Role = 'manager' | 'teacher' | 'student';

interface RunTenant {
  key: string;
  run: string;
  org: { id: string; name: string };
  users: Record<Role, SeedAccount>;
}

/** Local runs reuse the shared slot's URLs; CI supplies the env explicitly. */
function supabaseConfig(): { url: string; serviceKey: string } {
  const fromEnvFile = (file: string, name: string): string | undefined => {
    try {
      for (const line of readFileSync(join(process.cwd(), file), 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0 && line.slice(0, i).trim() === name) return line.slice(i + 1).trim();
      }
    } catch {
      /* no env file */
    }
    return undefined;
  };

  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!url) {
    try {
      const qaEnv = JSON.parse(readFileSync(join(process.cwd(), 'qa/env.json'), 'utf8')) as {
        supabaseUrl?: string;
      };
      url = qaEnv.supabaseUrl;
    } catch {
      /* no slot env */
    }
  }
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    fromEnvFile('apps/web/.env', 'SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !serviceKey) {
    throw new Error(
      'PUB-08 needs NEXT_PUBLIC_SUPABASE_URL (or qa/env.json) and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return { url, serviceKey };
}

/** Reset + seed this case's tenant, so each run starts from the same clean graph. */
async function seedFreshTenant(): Promise<RunTenant> {
  const key = tenantKey(`qa/cases/${CASE_ID}.md`, CASE_ID, PROJECT);
  const { url, serviceKey } = supabaseConfig();
  const db = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const org = { id: tenantId(key, 'org'), name: `qa-${CASE_ID.toLowerCase()}` };
  const group = { id: tenantId(key, 'group:default'), name: 'G1', isDefault: true };
  const users: Record<Role, SeedAccount> = {
    manager: buildAccount(key, 'manager', 'manager', { name: 'QA manager' }),
    teacher: buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' }),
    student: buildAccount(key, 'student', 'student', { name: 'QA student' }),
  };

  // Same deterministic ids as scripts/qa-tenant.ts; dropping first (rather than
  // upserting) means no run inherits memberships or leftovers from the previous one.
  await db.from('organizations').delete().eq('id', org.id);
  for (const account of Object.values(users)) {
    await db.auth.admin.deleteUser(account.id);
  }

  await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: group,
    extraGroups: [],
    owner: users.manager,
    members: [users.teacher, users.student],
    ownerOrgRole: 'admin',
  });

  return { key, run: randomUUID().slice(0, 8), org, users };
}

async function signInAs(page: Page, tenant: RunTenant, role: Role, baseURL: string): Promise<void> {
  const user = tenant.users[role];
  const res = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  expect(
    res.ok(),
    `login ${role} (${user.email}) failed: ${res.status()} ${await res.text()}`,
  ).toBe(true);

  // The tenant graph is inserted directly, so the app never wrote these hints:
  // pin the locale and the active org the same way a returning user would have.
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: LOCALE, url: baseURL },
    { name: 'active_org_id', value: tenant.org.id, url: baseURL, httpOnly: true },
  ]);
}

async function expectShortcut(page: Page, name: string, href: string): Promise<void> {
  const link = page.locator('main').getByRole('link', { name, exact: true });
  await expect(link).toHaveAttribute('href', href);
}

const dashboardShell = (page: Page) => page.locator('[data-sidebar="sidebar"]').first();

test.describe('PUB-08 — 404 inside the dashboards', () => {
  let tenant: RunTenant;

  test.beforeAll(async () => {
    tenant = await seedFreshTenant();
    console.log(
      `[PUB-08] tenant=${tenant.key} run=${tenant.run} org=${tenant.org.id} users=${Object.values(
        tenant.users,
      )
        .map((user) => user.email)
        .join(',')}`,
    );
  });

  test.beforeEach(async ({}, testInfo) => {
    testInfo.annotations.push(
      { type: 'tenant', description: tenant.key },
      { type: 'run', description: tenant.run },
    );
  });

  test('student: /app/nie-istnieje shows the student 404 inside the dashboard', async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, tenant, 'student', baseURL!);

    const response = await page.goto('/app/nie-istnieje');
    expect(response?.status()).toBe(404);

    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'No to niezłe combo...' }),
    ).toBeVisible();

    await expectShortcut(page, 'Fiszki', '/app/flashcards');
    await expectShortcut(page, 'Quiz', '/app/study');
    await expectShortcut(page, 'Statystyki', '/app/stats/content');
    await expect(page.locator('main a')).toHaveText([
      'Wróć do panelu',
      'Fiszki',
      'Quiz',
      'Statystyki',
    ]);

    // The panel layout survives the 404 (sidebar + its student navigation).
    await expect(dashboardShell(page)).toBeVisible();
    await expect(dashboardShell(page).locator('a[href="/app"]')).toBeVisible();
    await expect(dashboardShell(page).locator('a[href="/app/study/learn"]')).toBeVisible();
  });

  test('teacher: /edu/nie-istnieje shows the educator 404 inside the dashboard', async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, tenant, 'teacher', baseURL!);

    const response = await page.goto('/edu/nie-istnieje');
    expect(response?.status()).toBe(404);

    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nie znaleziono strony' }),
    ).toBeVisible();

    await expectShortcut(page, 'Przegląd', '/edu');
    await expectShortcut(page, 'Pytania', '/edu/questions');
    await expectShortcut(page, 'Fiszki', '/edu/flashcards');
    await expectShortcut(page, 'Statystyki', '/edu/statistics');
    await expect(page.locator('main a')).toHaveText([
      'Wróć do panelu',
      'Przegląd',
      'Pytania',
      'Fiszki',
      'Statystyki',
    ]);
    // Product decision #292: the classroom section is not offered in the 404.
    await expect(
      page.locator('main').getByRole('link', { name: 'Klasa', exact: true }),
    ).toHaveCount(0);

    await expect(dashboardShell(page)).toBeVisible();
    await expect(dashboardShell(page).locator('a[href="/edu"]')).toBeVisible();
    await expect(dashboardShell(page).locator('a[href="/edu/questions"]')).toBeVisible();
  });

  test('manager: /manage/nie-istnieje shows the organisation 404 inside the dashboard', async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, tenant, 'manager', baseURL!);

    const response = await page.goto('/manage/nie-istnieje');
    expect(response?.status()).toBe(404);

    await expect(page.getByRole('heading', { level: 1, name: '404' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Nie znaleziono strony' }),
    ).toBeVisible();

    await expectShortcut(page, 'Przegląd', '/manage');
    await expectShortcut(page, 'Członkowie', '/manage/members');
    await expectShortcut(page, 'Zaproszenia', '/manage/invites');
    await expectShortcut(page, 'Ustawienia', '/manage/settings');
    await expect(page.locator('main a')).toHaveText([
      'Wróć do panelu',
      'Przegląd',
      'Członkowie',
      'Zaproszenia',
      'Ustawienia',
    ]);

    await expect(dashboardShell(page)).toBeVisible();
    await expect(dashboardShell(page).locator('a[href="/manage"]')).toBeVisible();
    await expect(dashboardShell(page).locator('a[href="/manage/members"]')).toBeVisible();
  });
});
