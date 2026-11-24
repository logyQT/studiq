import { expect, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, test, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * MGR-02 — Menu boczne managera (`/manage`).
 *
 * Prerequisite: a signed-in organization manager. That is the case's own
 * `content` tenant on the **Hub** plan (`__tests__/qa/profiles/MGR-02.json`
 * declares `{ profile: "content", plan: "hub" }`), seeded with a fresh run
 * suffix before every independent run:
 *
 *   bun scripts/qa-tenant.ts MGR-02 --fresh
 *
 * The tenant gives the manager an `admin` role in `qa-mgr-02-<suffix>`
 * (`tenantKey('qa/cases/MGR-02.md', 'MGR-02#<suffix>', 'qa-shared')` +
 * `tenantId`). The sidebar is driven by the active organization from the
 * `active_org_id` cookie, so the fixture's organization is what the menu and
 * every `/manage/*` page below are scoped to. No global admin setting, feature
 * flag, plan row or another worker's tenant is read or written.
 *
 * The case expected „Asystent Q” as the second entry of „Główne” and flagged the
 * known problem that it points at `/manage/ai`, a route the app never had. That
 * defect is fixed: #134/#433 added `/edu/ai` for educators and **dropped the dead
 * manager link** — no manager AI page exists (the manager AI surface is
 * ADR-0015 phase 6), so a manager has no assistant to link to. The API itself is
 * not persona-gated any more: since phase 5a `POST /api/v1/ai/chat` and
 * `GET /api/v1/ai/usage` require the `ai.chat` entitlement, and this tenant's
 * Hub org carries it, so the manager *may* call the API. The intended manager
 * menu is therefore „Główne: Przegląd” and the seven „Administracja” entries
 * below; the spec pins that absence (and the 404 the case asked about) instead of
 * reproducing the old broken link, plus the positive entitlement path on the
 * API.
 */

const CASE = 'MGR-02';

interface NavItem {
  /** Sidebar label, verbatim from the Polish UI. */
  label: string;
  href: string;
  /** `main` heading the entry must open; the overview renders stat cards instead. */
  heading?: string;
}

interface NavSection {
  /** Group label above the entries, verbatim from the Polish UI. */
  label: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    label: 'Główne',
    items: [{ label: 'Przegląd', href: '/manage' }],
  },
  {
    label: 'Administracja',
    items: [
      { label: 'Członkowie', href: '/manage/members', heading: 'Członkowie' },
      { label: 'Zaproszenia', href: '/manage/invites', heading: 'Zaproszenia' },
      { label: 'Grupy', href: '/manage/groups', heading: 'Grupy' },
      { label: 'Zgłoszenia', href: '/manage/reports', heading: 'Zgłoszenia' },
      { label: 'Role', href: '/manage/roles', heading: 'Role' },
      { label: 'Licencje', href: '/manage/seats', heading: 'Licencje miejsc' },
      { label: 'Ustawienia', href: '/manage/settings', heading: 'Ustawienia' },
    ],
  },
];

const ITEMS = SECTIONS.flatMap((section) => section.items);

/** Copy that identifies the overview dashboard; unlike the others it has no heading. */
const OVERVIEW_COPY = ['Łączna liczba członków', 'Wykładowcy', 'Studenci', 'Szybkie akcje'];

/**
 * The dashboard nests the sidebar-inset `<main>` around the page's own `<main>`,
 * so a bare `main` is ambiguous and the page content is always the inner one.
 */
const CONTENT = 'main main';

/** Shortcuts the 404 page offers below „Przejdź do:”. */
const NOT_FOUND_SHORTCUTS = [
  { label: 'Przegląd', href: '/manage' },
  { label: 'Członkowie', href: '/manage/members' },
  { label: 'Zaproszenia', href: '/manage/invites' },
  { label: 'Ustawienia', href: '/manage/settings' },
];

async function expectPage(page: Page, item: NavItem): Promise<void> {
  await expect
    .poll(() => new URL(page.url()).pathname, { message: `${item.label} opens ${item.href}` })
    .toBe(item.href);

  const main = page.locator(CONTENT);
  await expect(main).toBeVisible();

  // The entry is a real page, not a dead link: the document is served with 200.
  const document = await page.request.get(item.href);
  expect(document.status(), `GET ${item.href}`).toBe(200);

  if (item.heading) {
    await expect(main.getByRole('heading', { name: item.heading, exact: true })).toBeVisible();
  } else {
    for (const copy of OVERVIEW_COPY) {
      await expect(main, `overview shows "${copy}"`).toContainText(copy, { ignoreCase: true });
    }
  }

  // No entry lands on the 404 surface the dead link used to reach.
  await expect(page.getByRole('heading', { name: '404', exact: true })).toHaveCount(0);
}

test('the manager sidebar has two sections whose entries all open their pages', async ({
  page,
}) => {
  const tenant: QaTenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
  expect(tenant.plan, `${CASE} needs its tenant org on Hub (ai.chat)`).toBe('hub');
  const org = tenant.org;
  if (!org) {
    throw new Error(
      `MGR-02 fixture incomplete: run \`bun scripts/qa-tenant.ts MGR-02 --fresh\` first`,
    );
  }

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // --- Prerequisite: the tenant's manager, signed in, on the dashboard ------
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage/ });
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toHaveCount(1);
  // The switcher names this run's organization, so the menu under test belongs
  // to the case's tenant and not to a stale session from another worker.
  await expect(sidebar.getByText(org.name, { exact: true })).toBeVisible();

  // --- Expected result: both sections, in order, with exactly these entries --
  const groups = sidebar.locator('[data-sidebar="group"]');
  await expect(groups).toHaveCount(SECTIONS.length);

  for (const [index, section] of SECTIONS.entries()) {
    const group = groups.nth(index);
    await expect(group.locator('[data-sidebar="group-label"]')).toHaveText(section.label);

    const entries = group.locator('a[data-sidebar="menu-button"]');
    await expect(entries, `entries of "${section.label}"`).toHaveCount(section.items.length);
    expect(
      await entries.evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
      `hrefs of "${section.label}"`,
    ).toEqual(section.items.map((item) => item.href));
    expect(
      await entries.evaluateAll((links) => links.map((link) => link.textContent.trim())),
      `labels of "${section.label}"`,
    ).toEqual(section.items.map((item) => item.label));
  }

  // The fixed „Asystent Q” problem must stay fixed: no entry (and no label)
  // points at the `/manage/ai` route that does not exist. #134/#433 removed it
  // because no manager AI page exists; the API gate is the `ai.chat`
  // entitlement, not the account type.
  const hrefs = await sidebar
    .locator('a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(hrefs, 'the manager sidebar is exactly the two sections').toEqual(
    ITEMS.map((item) => item.href),
  );
  await expect(sidebar.getByText('Asystent Q')).toHaveCount(0);

  // --- Step 1: click every entry -------------------------------------------
  for (const item of ITEMS) {
    const entry = sidebar.locator(`a[href="${item.href}"]`);
    await expect(entry, `sidebar entry "${item.label}"`).toHaveCount(1);
    await entry.click();

    await expectPage(page, item);

    // Exactly the visited entry is highlighted as the current section.
    const active = sidebar.locator('a[data-active="true"]');
    await expect(active, `active entry after opening "${item.label}"`).toHaveCount(1);
    await expect(active).toHaveAttribute('href', item.href);
  }

  // --- The 404 the case asked about ----------------------------------------
  // `/manage/ai` is not part of the app (never was); the catcher renders the
  // manager 404 surface with a way back instead of a crash.
  const deadRoute = await page.request.get('/manage/ai');
  expect(deadRoute.status(), 'GET /manage/ai').toBe(404);

  await page.goto('/manage/ai');
  await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Nie znaleziono strony', exact: true }),
  ).toBeVisible();

  const main = page.locator(CONTENT);
  await expect(main.getByRole('link', { name: 'Wróć do panelu' })).toHaveAttribute(
    'href',
    '/manage',
  );
  for (const shortcut of NOT_FOUND_SHORTCUTS) {
    await expect(
      main.getByRole('link', { name: shortcut.label, exact: true }),
      `404 shortcut "${shortcut.label}"`,
    ).toHaveAttribute('href', shortcut.href);
  }

  // The menu has no assistant entry because no manager AI page exists (that
  // surface is ADR-0015 phase 6) — but the API is entitlement-gated, and this
  // tenant's Hub org carries `ai.chat`, so the manager *may* call it.
  const entitlementsResponse = await page.request.get('/api/v1/me/entitlements');
  expect(entitlementsResponse.status(), 'GET /api/v1/me/entitlements as the manager').toBe(200);
  const entitlementsBody = await json<{ data: { entitlements: string[] } }>(entitlementsResponse);
  expect(entitlementsBody.data.entitlements, 'the Hub org resolves ai.chat').toContain('ai.chat');

  const usage = await page.request.get('/api/v1/ai/usage');
  expect(usage.status(), 'GET /api/v1/ai/usage as the manager on Hub').toBe(200);
  const usageBody = await json<{
    success: boolean;
    data: { plan: string; limit: number };
  }>(usage);
  expect(usageBody.data, 'the usage counter reports the Hub org plan').toMatchObject({
    plan: 'hub',
    limit: 200000,
  });

  // The entitlement gate let the manager through, so the handler's own
  // validation answers — an empty body is a 400 BAD_REQUEST, never a model
  // call.
  const ai = await page.request.post('/api/v1/ai/chat', { data: {} });
  expect(ai.status(), 'POST /api/v1/ai/chat with an empty body as the manager').toBe(400);
  const aiBody = await json<{ success: boolean; error?: string }>(ai);
  expect(aiBody).toMatchObject({ success: false, error: 'BAD_REQUEST' });

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
