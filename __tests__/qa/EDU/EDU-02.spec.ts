import type { Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { expect, loadTenant, loginAs, test } from '#test/qa/fixtures/tenant';

/**
 * EDU-02 — Menu boczne nauczyciela (/edu).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator signed in to
 * `/edu` whose org role carries the `group.manage` permission and whose
 * entitlements include `ai.chat` (the case lists „Asystent Q” in the main
 * section). The legacy manual account (`teacher1@dev.local`, password `pass`)
 * is never used.
 *
 * Tenant: `__tests__/qa/profiles/EDU-02.json`, seeded once before Playwright starts
 * (`bun scripts/qa-tenant.ts EDU-02 --fresh`) and read through `loadTenant(CASE)`
 * — the spec never seeds at runtime. The profile is the `content` shape with a
 * declarative roster and the case's `hub` entitlement:
 *   - `manager`  — org role `admin`;
 *   - `teacher`  — org role `teacher` → `ai.chat` + the `group.manage` permission;
 *   - `teacher2` — org role `member`  → `ai.chat`, no `group.manage` permission;
 *   - `student`  — org role `member`, member of the default group `G1`.
 * The second educator is the negative control for the case's „Grupy widoczne
 * tylko gdy rola ma `group.manage`”: since 2b-7 `group.manage` exists only as
 * a permission, so the absence branch is exercised through the role's
 * permission map — exactly what `/api/v1/permissions/me` returns.
 *
 * The `hub` plan is applied to this tenant's own organization by the seeder with
 * `apply_org_plan` (the same RPC the billing webhook calls), so no global plan,
 * flag, setting or platform row is written and no other worker's tenant is
 * touched.
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
 * 4. „Grupy” follows `group.read` (the key the class routes enforce), not a plan
 *    feature: a `member` role keeps the entry and reaches a read-only list,
 *    while „Asystent Q” (ai.chat) stays for the same account — so neither gate
 *    is a persona check.
 */

const CASE = 'EDU-02';

/** The tenant declared in `__tests__/qa/profiles/EDU-02.json` and seeded before the suite. */
const tenant = loadTenant(CASE);

const NOT_FOUND_COPY = 'Nie znaleziono strony';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

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
    const enabled = (await json<{ data: { features: string[] } }>(features)).data.features;
    expect(enabled, 'the teacher is entitled to the menu items under test').toEqual(
      expect.arrayContaining(['ai.chat', 'branding']),
    );

    // `group.manage` is a permission since 2b-7 (the entitlement marker is
    // gone): the org `teacher` role holds it at `group` scope, which is what
    // renders the class list's write controls.
    const permissions = await page.request.get('/api/v1/permissions/me');
    expect(permissions.status(), 'GET /api/v1/permissions/me').toBe(200);
    const scopes = (await json<ApiEnvelope<{ permissions: Record<string, string> }>>(permissions))
      .data.permissions;
    expect(Object.keys(scopes), 'the teacher may manage classes').toContain('group.manage');
    expect(scopes['group.manage'], 'at the group scope').toBe('group');

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

  test('keeps „Grupy” for a group.read holder and hides the manage controls', async ({ page }) => {
    test.setTimeout(120_000);
    const { pageErrors } = watchPage(page);

    await loginAs(page, tenant, 'teacher2', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'educator lands on /edu').toBe('/edu');

    const features = await page.request.get('/api/v1/features/me');
    expect(features.status(), 'GET /api/v1/features/me').toBe(200);
    const enabled = (await json<{ data: { features: string[] } }>(features)).data.features;
    expect(enabled, 'ai.chat is entitled').toContain('ai.chat');

    // The negative half since 2b-7 reads the permission map: the org `member`
    // role holds `group.read` but no `group.manage` at any scope.
    const permissions = await page.request.get('/api/v1/permissions/me');
    expect(permissions.status(), 'GET /api/v1/permissions/me').toBe(200);
    const scopes = (await json<ApiEnvelope<{ permissions: Record<string, string> }>>(permissions))
      .data.permissions;
    expect(Object.keys(scopes), 'the member role holds group.read').toContain('group.read');
    expect(Object.keys(scopes), 'the member role holds no group.manage').not.toContain(
      'group.manage',
    );

    // The entry follows `group.read` (what the class routes ask for), not a
    // plan feature: a `member` role may read the class list it cannot edit,
    // and the link must not lie about that.
    await expect
      .poll(() => readSidebar(page), { timeout: 15_000, message: 'educator sidebar menu' })
      .toEqual(SIDEBAR_GROUPS);

    const nav = sidebar(page);
    await expect(
      nav.locator('[data-slot="sidebar-menu-item"] a[href="/edu/groups"]'),
      '„Grupy” follows group.read',
    ).toHaveCount(1);
    // The gate is specific: the ai.chat item stays for the same account.
    await expect(navLink(page, '/edu/ai'), '„Asystent Q” still shows').toBeVisible();
    await expect(nav, 'the classroom section is hidden').not.toContainText('Klasa');

    // Reading is not editing: the list opens, and every write control a
    // `group.manage` permission holder would see is absent for this role.
    await navLink(page, '/edu/groups').click();
    await expect(page).toHaveURL(/\/edu\/groups$/);
    await expect(page.getByRole('button', { name: 'Nowa grupa' })).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors on the educator dashboard').toEqual([]);
  });
});
