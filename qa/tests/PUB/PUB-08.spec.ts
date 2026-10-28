import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * PUB-08 — 404 inside the panels (student / teacher / manager).
 *
 * Prerequisite (reconciled with the tenant seeder): signed in in turn as S1, T1
 * and M1. The manual accounts are replaced by the case's own isolated tenant,
 * which has the same shape (one org with an admin, a teacher and a member):
 *
 *   bun scripts/qa-tenant.ts PUB-08 --fresh
 *
 * The spec reads credentials from `qa/.tenants/PUB-08.json`
 * (`users.student` / `users.teacher` / `users.manager`, password `Seed4Test!`)
 * and never creates accounts itself. It writes no global admin setting, feature
 * flag, plan, platform row or singleton, so every run only reads its own
 * tenant's org graph.
 *
 * Acceptance criteria, per panel:
 * 1. an unknown sub-path answers `404` and renders the panel-specific
 *    not-found copy (exact Polish title, description and "try these" label);
 * 2. "try these" offers exactly the documented links, in order, with the
 *    documented targets — the teacher panel intentionally has no "Klasa" link
 *    (product decision #292: `/edu/classroom` has no landing page and classroom
 *    management moved to `/manage`);
 * 3. the panel layout (sidebar) stays visible, under the signed-in tenant user.
 *
 * Adjacent regressions on the same surface:
 * - every "try these" link from the 404 screen leads to a real page (clicked,
 *   not just read from the href), so the recovery path cannot rot into another
 *   404;
 * - a nested unknown path (`/…/nie-istnieje/glebiej`) is still owned by the
 *   panel catch-all and keeps the sidebar, instead of falling through to the
 *   bare global 404.
 *
 * The case quotes exact Polish copy, so the spec pins `NEXT_LOCALE=pl` through
 * the tenant fixture instead of inheriting whatever language the context has.
 */

const CASE = 'PUB-08';

interface QuickLink {
  name: string;
  href: string;
}

interface Panel {
  role: QaRole;
  /** The deep link the case opens. */
  url: string;
  /** A deeper unknown path: the panel catch-all must still own this subtree. */
  deepUrl: string;
  /** Panel root the primary "back" CTA and the sidebar point at. */
  root: string;
  /** Breadcrumb / panel label shown in the dashboard header. */
  label: string;
  title: string;
  description: string;
  tryThese: string;
  quickLinks: QuickLink[];
}

const PANELS: Panel[] = [
  {
    role: 'student',
    url: '/app/nie-istnieje',
    deepUrl: '/app/nie-istnieje/glebiej',
    root: '/app',
    label: 'Moja Nauka',
    title: 'No to niezłe combo...',
    description:
      'Ta strona nie istnieje. Może to literówka, a może po prostu eksplorujesz. W obu przypadkach zgubiłeś się.',
    tryThese: 'Albo spróbuj jednego z tych:',
    quickLinks: [
      { name: 'Fiszki', href: '/app/flashcards' },
      { name: 'Quiz', href: '/app/study' },
      { name: 'Statystyki', href: '/app/stats/content' },
    ],
  },
  {
    role: 'teacher',
    url: '/edu/nie-istnieje',
    deepUrl: '/edu/nie-istnieje/glebiej',
    root: '/edu',
    label: 'Panel Nauczyciela',
    title: 'Nie znaleziono strony',
    description: 'Strona, której szukasz, nie istnieje lub została przeniesiona.',
    tryThese: 'Przejdź do:',
    quickLinks: [
      { name: 'Przegląd', href: '/edu' },
      { name: 'Pytania', href: '/edu/questions' },
      { name: 'Fiszki', href: '/edu/flashcards' },
      { name: 'Statystyki', href: '/edu/statistics' },
    ],
  },
  {
    role: 'manager',
    url: '/manage/nie-istnieje',
    deepUrl: '/manage/nie-istnieje/glebiej',
    root: '/manage',
    label: 'Zarządzanie Uczelnią',
    title: 'Nie znaleziono strony',
    description:
      'Żądana strona nie została znaleziona. Sprawdź adres URL lub przejdź do innej sekcji.',
    tryThese: 'Przejdź do:',
    quickLinks: [
      { name: 'Przegląd', href: '/manage' },
      { name: 'Członkowie', href: '/manage/members' },
      { name: 'Zaproszenia', href: '/manage/invites' },
      { name: 'Ustawienia', href: '/manage/settings' },
    ],
  },
];

/** The "try these" block: the links sit next to the label, in one container. */
function quickLinks(page: Page, panel: Panel) {
  return page.getByText(panel.tryThese, { exact: true }).locator('..').getByRole('link');
}

/** Sidebar + header of the panel layout, addressed by their stable slots. */
function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]');
}

/** The panel's own 404 screen: document status, copy and quick links. */
async function expectNotFoundPage(page: Page, panel: Panel): Promise<void> {
  const response = await page.goto(panel.url);
  expect(response, `${panel.url} document response`).not.toBeNull();
  expect(response!.status(), `${panel.url} is a real 404`).toBe(404);

  // The 404 layout, not a redirect to the dashboard.
  await expect(page).toHaveURL(new RegExp(`${panel.url}$`));
  await expect(page.locator('main h1')).toHaveText('404');
  await expect(page.locator('main h2')).toHaveText(panel.title);
  await expect(page.getByText(panel.description, { exact: true })).toBeVisible();

  // Exactly the documented recovery links, in the documented order.
  const links = quickLinks(page, panel);
  await expect(links).toHaveCount(panel.quickLinks.length);
  await expect(links).toHaveText(panel.quickLinks.map((link) => link.name));
  for (const [index, link] of panel.quickLinks.entries()) {
    await expect(links.nth(index)).toHaveAttribute('href', link.href);
  }

  // The primary CTA goes back to the panel root.
  const back = page.locator('main').getByRole('link', { name: 'Wróć do panelu', exact: true });
  await expect(back).toHaveCount(1);
  await expect(back).toHaveAttribute('href', panel.root);
}

/** "Układ panelu (sidebar) pozostaje widoczny" — under the tenant's own user. */
async function expectPanelChrome(page: Page, panel: Panel, tenant: QaTenant): Promise<void> {
  const user = tenant.users[panel.role];
  expect(user, `${CASE} tenant must seed a ${panel.role}`).toBeTruthy();

  const bar = sidebar(page);
  await expect(bar).toHaveCount(1);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(user!.email);
  await expect(bar.locator(`a[href="${panel.root}"]`).first()).toBeVisible();

  // The dashboard header keeps the panel label, so the 404 renders inside the
  // panel shell rather than on a bare page.
  await expect(page.locator('main header')).toContainText(panel.label);
}

/** A navigation that is not the 404 screen any more. */
async function expectLeftNotFound(page: Page, panel: Panel): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: panel.title, exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('main h1', { hasText: /^404$/ })).toHaveCount(0);
}

test.describe('PUB-08 — panel 404 keeps the layout and offers the documented recovery links', () => {
  for (const panel of PANELS) {
    test(`${panel.role}: ${panel.url}`, async ({ page }) => {
      const tenant = loadTenant(CASE);
      expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
      expect(tenant.org, `${CASE} needs the tenant organization`).toBeTruthy();

      await loginAs(page, tenant, panel.role, { locale: 'pl' });

      // Step: open the unknown path inside the panel.
      await expectNotFoundPage(page, panel);
      await expectPanelChrome(page, panel, tenant);

      // Adjacent: every recovery link really answers a page, not another 404.
      for (const [index, link] of panel.quickLinks.entries()) {
        // A click leaves the 404 screen, so come back before the next one.
        if (index > 0) await expectNotFoundPage(page, panel);
        await quickLinks(page, panel).nth(index).click();
        await expect(page).toHaveURL(new RegExp(`${link.href}(/.*)?$`));
        await expectLeftNotFound(page, panel);
      }

      // Adjacent: the panel catch-all owns the whole subtree, so a deeper
      // unknown path keeps the sidebar as well.
      const deep = await page.goto(panel.deepUrl);
      expect(deep, `${panel.deepUrl} document response`).not.toBeNull();
      expect(deep!.status(), `${panel.deepUrl} is a real 404`).toBe(404);
      await expect(page.locator('main h2')).toHaveText(panel.title);
      await expectPanelChrome(page, panel, tenant);
    });
  }
});
