import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-03 — Menu boczne studenta (`/app`).
 *
 * Prerequisite (reconciled with the tenant seeder): a student signed in to
 * `/app` whose resolved entitlements contain no `ai.chat` — the case's S1 on the
 * free „Base” plan. The legacy manual account (`student1@dev.local`, password
 * `pass`) is never used. Tenant (seeded by the suite runner, one per run):
 *
 *   bun scripts/qa-tenant.ts STU-03 --fresh
 *
 * `qa/tests/profiles/STU-03.json` declares the default `content` profile: one
 * organization (`plan = launch`, whose member role grants `flashcards`, `quiz`
 * and `documents` but no `ai.chat`), the tenant's own manager/teacher, and the
 * `student` account this case logs in as. Every id is `tenantKey` + `tenantId`
 * from the shared e2e helpers, so a fresh run suffix gives a brand-new tenant
 * and nothing global (plan catalogue, feature flags, admin settings, platform
 * stats) is read or written.
 *
 * Acceptance points from the case:
 * 1. Sections and items, in order — Główne (Przegląd), Nauka (Ucz się, Wkuwaj,
 *    Sprawdź się, Na żywo), Treści (Fiszki, Tematy, Pytania, Kartkówki,
 *    Zgłoszenia), Statystyki (Treści, Wyniki, Aktywność).
 * 2. „Asystent Q” is absent for this Base-plan student, because
 *    `/api/v1/features/me` resolves no `ai.chat`; the item is gated, not merely
 *    hidden by CSS.
 * 3. Every item opens its own page, is marked active (`data-active="true"`,
 *    `font-medium`) and the active state also follows subpages — the case's
 *    `/app/flashcards/<id>` example keeps „Fiszki” highlighted.
 * 4. The sidebar rail collapses the menu to icons only: section labels fade out,
 *    each item is a 32px icon button with its text span collapsed to 0px, and
 *    hovering an item shows its label as a tooltip. Expanding restores the
 *    labels.
 *
 * The walk on the shared app confirmed all four; the spec asserts the intended
 * behaviour (no known-failure branches), and never touches another worker's
 * tenant or a shared singleton row.
 */

const CASE = 'STU-03';

const NOT_FOUND_COPY = 'Nie znaleziono strony';

interface NavItem {
  label: string;
  href: string;
}

interface SidebarGroup {
  label: string;
  items: NavItem[];
}

/** The exact menu the case lists for a student on the Base plan. */
const SIDEBAR_GROUPS: SidebarGroup[] = [
  { label: 'Główne', items: [{ label: 'Przegląd', href: '/app' }] },
  {
    label: 'Nauka',
    items: [
      { label: 'Ucz się', href: '/app/study/learn' },
      { label: 'Wkuwaj', href: '/app/study/cram' },
      { label: 'Sprawdź się', href: '/app/study/quiz' },
      { label: 'Na żywo', href: '/app/study/live' },
    ],
  },
  {
    label: 'Treści',
    items: [
      { label: 'Fiszki', href: '/app/flashcards' },
      { label: 'Tematy', href: '/app/topics' },
      { label: 'Pytania', href: '/app/questions' },
      { label: 'Kartkówki', href: '/app/assignments' },
      { label: 'Zgłoszenia', href: '/app/reports' },
    ],
  },
  {
    label: 'Statystyki',
    items: [
      { label: 'Treści', href: '/app/stats/content' },
      { label: 'Wyniki', href: '/app/stats/results' },
      { label: 'Aktywność', href: '/app/stats/activity' },
    ],
  },
];

const NAV_ITEMS = SIDEBAR_GROUPS.flatMap((group) => group.items);

/** The desktop sidebar — the only navigation this case is about. */
function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]');
}

/** Only the navigation anchors; the org switcher and user menu are buttons too. */
function navLinks(page: Page) {
  return sidebar(page).locator('[data-slot="sidebar-menu-item"] a[data-sidebar="menu-button"]');
}

function navLink(page: Page, href: string) {
  return sidebar(page).locator(`[data-slot="sidebar-menu-item"] a[href="${href}"]`).first();
}

/** The single menu entry the sidebar currently marks as active. */
function activeLink(page: Page) {
  return sidebar(page).locator('[data-slot="sidebar-menu-item"] a[data-active="true"]');
}

/** Rendered menu as `[{ label, items: [{ label, href }] }]`, in DOM order. */
async function readSidebar(page: Page): Promise<SidebarGroup[]> {
  const groups = sidebar(page).locator('[data-slot="sidebar-group"]');
  const count = await groups.count();
  const out: SidebarGroup[] = [];
  for (let index = 0; index < count; index++) {
    const group = groups.nth(index);
    const label = (await group.locator('[data-slot="sidebar-group-label"]').innerText()).trim();
    const links = group.locator('[data-slot="sidebar-menu-item"] a');
    const items: NavItem[] = [];
    for (let linkIndex = 0; linkIndex < (await links.count()); linkIndex++) {
      const link = links.nth(linkIndex);
      items.push({
        label: (await link.innerText()).trim(),
        href: (await link.getAttribute('href')) ?? '',
      });
    }
    out.push({ label, items });
  }
  return out;
}

async function expectActive(page: Page, href: string): Promise<void> {
  await expect(activeLink(page), `„${href}” is the only active item`).toHaveCount(1);
  await expect(activeLink(page)).toHaveAttribute('href', href);
  // The highlight is real, not only an attribute: active items use the medium
  // weight (and a non-transparent background) from `data-[active=true]`.
  await expect(activeLink(page)).toHaveCSS('font-weight', '500');
  await expect(activeLink(page)).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
}

test.describe('@case:STU-03 @area:STU @prio:P2 student sidebar', () => {
  test('lists the student sections, opens every item and collapses to icons with tooltips', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');

    const pageErrors: string[] = [];
    const failedDocuments: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.request().resourceType() === 'document' && response.status() >= 400) {
        failedDocuments.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the student lands on /app').toBe('/app');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // 2 (premise). This tenant resolves no `ai.chat`, which is what hides
    //    „Asystent Q”; the assertion below is about the gate, not about copy.
    const featuresResponse = await page.request.get('/api/v1/features/me');
    expect(featuresResponse.status(), 'GET /api/v1/features/me').toBe(200);
    const enabled = ((await featuresResponse.json()) as { data: { features: string[] } }).data
      .features;
    expect(enabled, 'the Base-plan student is not entitled to ai.chat').not.toContain('ai.chat');

    // 1. Sections and items, in the case's order.
    await expect
      .poll(() => readSidebar(page), { timeout: 15_000, message: 'student sidebar menu' })
      .toEqual(SIDEBAR_GROUPS);

    const nav = sidebar(page);
    await expect(
      nav.locator('[data-slot="sidebar-menu-item"] a[href="/app/ai"]'),
      '„Asystent Q” is not rendered without ai.chat',
    ).toHaveCount(0);
    await expect(nav, 'no „Asystent Q” label in the menu').not.toContainText('Asystent Q');

    // Starting state: „Przegląd” is the active entry on the dashboard.
    await expectActive(page, '/app');

    // 3. Click every item: the page it owns opens and the item is highlighted.
    for (const item of NAV_ITEMS) {
      const link = navLink(page, item.href);
      await expect(link, `„${item.label}” is in the menu`).toBeVisible();
      await expect(link, `„${item.label}” points at ${item.href}`).toContainText(item.label);

      await link.click();
      await page.waitForURL((url) => url.pathname === item.href, { timeout: 15_000 });
      await expectActive(page, item.href);
      await expect(
        page.getByText(NOT_FOUND_COPY, { exact: true }),
        `„${item.label}” must open a real page`,
      ).toHaveCount(0);
    }

    // 3 (subpage). `/app/flashcards/<id>` keeps „Fiszki” highlighted.
    const deckResponse = await page.request.post('/api/v1/flashcards/decks', {
      data: { name: `Talia STU-03 ${tenant.runSuffix ?? ''}`.trim() },
    });
    expect(deckResponse.status(), 'POST /api/v1/flashcards/decks').toBe(201);
    const deckId = ((await deckResponse.json()) as { data: { id: string } }).data.id;
    expect(deckId, 'created deck id').toBeTruthy();

    await page.goto(`/app/flashcards/${deckId}`);
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${deckId}$`));
    await expectActive(page, '/app/flashcards');

    // 4. Collapse with the rail: icons only.
    await expect(nav, 'the sidebar starts expanded').toHaveAttribute('data-state', 'expanded');
    await page.locator('[data-slot="sidebar-rail"]').click();
    await expect(nav, 'the rail collapses the sidebar to icons').toHaveAttribute(
      'data-state',
      'collapsed',
    );

    const groupLabels = nav.locator('[data-slot="sidebar-group-label"]');
    await expect(groupLabels).toHaveCount(SIDEBAR_GROUPS.length);
    for (let index = 0; index < SIDEBAR_GROUPS.length; index++) {
      await expect(groupLabels.nth(index), 'section labels fade out when collapsed').toHaveCSS(
        'opacity',
        '0',
      );
    }

    await expect(navLinks(page), 'every menu entry is still present').toHaveCount(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) {
      const link = navLink(page, item.href);
      // 32px = the `size-8` icon button; the label span is squeezed to 0px.
      await expect(link, `„${item.label}” collapses to an icon button`).toHaveCSS('width', '32px');
      await expect(link.locator('span').first(), `„${item.label}” hides its label`).toHaveCSS(
        'width',
        '0px',
      );
      await expect(link.locator('svg').first(), `„${item.label}” keeps its icon`).toBeVisible();
    }

    // The active highlight survives the collapsed state.
    await expectActive(page, '/app/flashcards');

    // Every icon-only entry keeps its tooltip. Matching by text keeps the
    // assertion independent of the previous tooltip's exit animation.
    for (const item of NAV_ITEMS) {
      await navLink(page, item.href).hover();
      const tooltip = page.getByRole('tooltip').filter({ hasText: item.label });
      await expect(tooltip, `„${item.label}” shows a tooltip when collapsed`).toHaveCount(1);
      await expect(tooltip).toHaveText(item.label);
    }

    // Expanding restores the labels and the highlight.
    await page.locator('[data-slot="sidebar-rail"]').click();
    await expect(nav, 'the rail expands the sidebar again').toHaveAttribute(
      'data-state',
      'expanded',
    );
    await expect(navLink(page, '/app/flashcards')).toContainText('Fiszki');
    await expect(groupLabels.first()).toHaveCSS('opacity', '1');
    await expectActive(page, '/app/flashcards');

    expect(failedDocuments, 'no navigation may answer with an error status').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the menu walk').toEqual([]);
  });
});
