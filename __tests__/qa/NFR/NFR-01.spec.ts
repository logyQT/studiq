import { expect, test, type Browser, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { qaAppUrl } from '#test/helpers/qa-pointer';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * NFR-01 — no missing translations in the Polish UI.
 *
 * Case: walk every screen of the STU, EDU, MGR and BIL modules with the Polish
 * interface and look for raw message keys („RegisterPage.join_title”,
 * „activate_account”, …), the literal „undefined”, foreign-alphabet text and
 * English fragments. Plan names („Free”, „Plus”) and proper nouns are allowed.
 *
 * Tenant: the default `content` profile (no profile file). Every run seeds its
 * own suffix:
 *
 *   bun run env:run -- bun scripts/qa-tenant.ts NFR-01 --fresh
 *
 * The walk uses the tenant's manager, teacher and student; the invitation for
 * `/join` is created through the product API in the same tenant and revoked at
 * the end of the walk, so nothing is left behind and no global row is touched.
 *
 * Walk (2026-11-28, test/qa-NFR-01 @ effc52c58, production build at :3000):
 * every listed screen answers 200 with `<html lang="pl">` and the Polish
 * breadcrumb named below. The sweep found no raw key, no „undefined”/„null”, no
 * foreign alphabet and no English fragment from the denylist. Corrections and
 * exclusions belong to the record:
 * - the student statistics screen is `/app/stats/content`; the `/app/stats/data`
 *   path named in the brief answers 404 (the sidebar links to `/app/stats/content`),
 *   so the real screen is swept;
 * - `/join?token=…` is swept twice: the „Weryfikowanie zaproszenia...” skeleton
 *   (the verification request is held for 2 s with a route delay, the only way
 *   to observe that state) and the settled activation form;
 * - the breadcrumb landmark still carries `aria-label="breadcrumb"` and sonner's
 *   toast region still reads `aria-label="Notifications alt+T"`. Both are known,
 *   out of scope here and need their own change; the denylist below does not
 *   name them, so this spec neither freezes nor blesses them;
 * - `packages/ui` pagination still carries English accessible names („Go to
 *   previous page”). No swept screen renders it with the seeded data, and it is
 *   outside this case's denylist — recorded as an observation, not asserted.
 *
 * Mutation (proves this spec can fail): hard-coding `aria-label="Loading"` on the
 * shared `Spinner` in `packages/ui/src/components/ui/spinner.tsx` (the label
 * #1532 translated) turns the /join verification skeleton red with
 * `/join (verifying): English fragment: aria-label of <output>: Loading`.
 */

const CASE = 'NFR-01';

/** A raw next-intl key that leaked into the UI: `RegisterPage.join_title`, … */
const RAW_KEY = /\b[A-Z][A-Za-z0-9]*\.[a-z][a-z0-9_]{2,}\b/;

/** A value the UI never formatted. */
const UNFORMATTED = /\b(?:undefined|null)\b/;

/** Cyrillic, Greek, Hebrew, Arabic, CJK, Hangul — nothing Polish uses. */
const FOREIGN_ALPHABET =
  /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

/**
 * The English copy this case found and #1532 / #1578 fixed. It is deliberately
 * narrow: a broad English dictionary would flag plan and product names the case
 * allows, and a reviewer could not tell a real leak from an allowed name.
 */
const ENGLISH_FRAGMENTS = [
  'Loading',
  'Close',
  'Toggle Sidebar',
  'Sidebar',
  'Displays the mobile sidebar.',
  'Command Palette',
  'Search for a command to run...',
  'Suggestions',
  'Verifying invitation',
  '/month',
];

interface Screen {
  /** Path relative to the app under test. */
  path: string;
  /** Breadcrumb page that proves the screen loaded, in Polish. */
  crumb: string;
}

/** Screens of the STU module, as the student. */
const STUDENT_SCREENS: Screen[] = [
  { path: '/app', crumb: 'Moja Nauka' },
  { path: '/app/flashcards', crumb: 'Fiszki' },
  { path: '/app/study/learn', crumb: 'Ucz się' },
  { path: '/app/stats/activity', crumb: 'Aktywność' },
  { path: '/app/stats/content', crumb: 'Treści' },
];

/** Screens of the EDU module (and the BIL billing screen it owns), as the teacher. */
const TEACHER_SCREENS: Screen[] = [
  { path: '/edu', crumb: 'Panel Nauczyciela' },
  { path: '/edu/questions', crumb: 'Pytania' },
  { path: '/edu/flashcards', crumb: 'Talie fiszek' },
  { path: '/edu/quizzes/new', crumb: 'Nowy quiz' },
  { path: '/edu/assignments/new', crumb: 'Nowa kartkówka' },
  { path: '/edu/billing', crumb: 'Rozliczenia' },
  { path: '/edu/stats/data', crumb: 'Treści' },
];

/** Screens of the MGR module, as the manager. */
const MANAGER_SCREENS: Screen[] = [
  { path: '/manage', crumb: 'Zarządzanie Uczelnią' },
  { path: '/manage/members', crumb: 'Członkowie' },
];

/** Public screens (PUB/BIL entry points a visitor sees in Polish). */
const PUBLIC_SCREENS: { path: string; heading: string }[] = [
  { path: '/login', heading: 'Witaj ponownie' },
  { path: '/pricing', heading: 'Wybierz swój plan' },
];

/**
 * Everything the user can read, or a screen reader announces: the rendered text
 * (which includes clipped `.sr-only` copy) and the accessible names/attributes of
 * rendered elements. `checkVisibility` keeps the closed-sheet and closed-dialog
 * DOM out, as the accessibility tree does.
 */
async function visibleTextAndNames(page: Page): Promise<{ text: string; names: string[] }> {
  return page.evaluate(() => {
    const names: string[] = [];
    for (const element of document.querySelectorAll('[aria-label],[placeholder],[title],[alt]')) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
        const value = element.getAttribute(attribute);
        if (value) names.push(`${attribute} of <${element.tagName.toLowerCase()}>: ${value}`);
      }
    }
    return { text: document.body.innerText, names };
  });
}

/** Every violation in one screen, as `screen: offending text`, deduplicated. */
async function screenViolations(page: Page, screen: string): Promise<string[]> {
  const { text, names } = await visibleTextAndNames(page);
  const sources = [text, ...names];
  const found = new Set<string>();

  for (const source of sources) {
    for (const line of source.split('\n')) {
      const value = line.trim();
      if (!value) continue;
      const leaks = [
        RAW_KEY.test(value) ? 'raw message key' : null,
        UNFORMATTED.test(value) ? 'unformatted value' : null,
        FOREIGN_ALPHABET.test(value) ? 'foreign alphabet' : null,
        ENGLISH_FRAGMENTS.find((fragment) => value.toLowerCase().includes(fragment.toLowerCase()))
          ? 'English fragment'
          : null,
      ].filter((leak): leak is string => leak !== null);
      for (const leak of leaks) {
        found.add(`${screen}: ${leak}: ${value}`);
      }
    }
  }

  return [...found];
}

/** Walk one page through `screens`: status, language, a Polish breadcrumb, then a scan. */
async function walkScreens(page: Page, screens: Screen[]): Promise<string[]> {
  const violations: string[] = [];
  for (const screen of screens) {
    const response = await page.goto(screen.path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `GET ${screen.path}`).toBe(200);
    await expect(page.locator('html'), `language of ${screen.path}`).toHaveAttribute('lang', 'pl');
    await expect(
      page.locator('[data-slot="breadcrumb-page"]'),
      `breadcrumb of ${screen.path}`,
    ).toHaveText(screen.crumb);
    violations.push(...(await screenViolations(page, screen.path)));
  }
  return violations;
}

/** One role's walk: fresh context, real login, every screen, then a page scan. */
async function sweep(
  browser: Browser,
  tenant: QaTenant,
  role: QaRole,
  screens: Screen[],
): Promise<string[]> {
  const context = await browser.newContext({ baseURL: qaAppUrl() });
  const page = await context.newPage();
  try {
    await loginAs(page, tenant, role, { locale: 'pl' });
    return await walkScreens(page, screens);
  } finally {
    await context.close();
  }
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** One `member` org role, the target of an ordinary organization invitation. */
async function memberRoleId(page: Page): Promise<string> {
  const response = await page.request.get('/api/v1/organization/roles');
  expect(response.status(), 'GET /api/v1/organization/roles').toBe(200);
  const roles = await json<Envelope<{ id: string; name: string }[]>>(response);
  const member = roles.data.find((role) => role.name === 'member');
  if (!member) throw new Error('the tenant org has no default member role');
  return member.id;
}

test.describe('@case:NFR-01 @area:NFR @prio:P2 Polish locale sweep', () => {
  test('no screen shows a raw message key, an unformatted value or an English fragment', async ({
    browser,
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const violations: string[] = [];

    violations.push(...(await sweep(browser, tenant, 'student', STUDENT_SCREENS)));
    violations.push(...(await sweep(browser, tenant, 'teacher', TEACHER_SCREENS)));

    // The manager context stays open: it owns the invitation for `/join`.
    const managerContext = await browser.newContext({ baseURL: qaAppUrl() });
    const manager = await managerContext.newPage();
    try {
      await loginAs(manager, tenant, 'manager', { locale: 'pl' });
      violations.push(...(await walkScreens(manager, MANAGER_SCREENS)));

      const created = await manager.request.post('/api/v1/organization/invites', {
        data: {
          email: `${CASE.toLowerCase()}-${Date.now()}@example.com`,
          targetOrgRoleId: await memberRoleId(manager),
        },
      });
      expect(
        created.status(),
        `POST /api/v1/organization/invites → ${created.status()} ${await created.text()}`,
      ).toBe(201);
      const invitation =
        await json<Envelope<{ invitationId: string; inviteCode: string }>>(created);

      const visitorContext = await browser.newContext({ baseURL: qaAppUrl() });
      const visitor = await visitorContext.newPage();
      try {
        // Hold the token lookup so the verification skeleton is observable; it is
        // the state #1532 fixed („Weryfikowanie zaproszenia...”, not
        // „Verifying invitation...”, and the spinner's „Ładowanie...”, not
        // „Loading”).
        await visitor.route(
          (url) => url.pathname === '/api/v1/organization/invites' && url.searchParams.has('token'),
          async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            await route.continue();
          },
        );
        const response = await visitor.goto(`/join?token=${invitation.data.inviteCode}`, {
          waitUntil: 'domcontentloaded',
        });
        expect(response?.status(), 'GET /join').toBe(200);
        await expect(visitor.locator('html'), 'language of /join').toHaveAttribute('lang', 'pl');
        await expect(visitor.getByText('Weryfikowanie zaproszenia...')).toBeVisible();
        violations.push(...(await screenViolations(visitor, '/join (verifying)')));
        await expect(visitor.getByRole('button', { name: 'Aktywuj konto' })).toBeVisible();
        await expect(visitor.getByText('Dołącz do organizacji')).toBeVisible();
        violations.push(...(await screenViolations(visitor, '/join')));
      } finally {
        await visitorContext.close();
      }

      const revoked = await manager.request.delete(
        `/api/v1/organization/invites/${invitation.data.invitationId}`,
      );
      expect(revoked.status(), `DELETE the /join invitation → ${revoked.status()}`).toBe(200);
    } finally {
      await managerContext.close();
    }

    for (const screen of PUBLIC_SCREENS) {
      const response = await page.goto(screen.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), `GET ${screen.path}`).toBe(200);
      await expect(page.locator('html'), `language of ${screen.path}`).toHaveAttribute(
        'lang',
        'pl',
      );
      await expect(page.getByRole('heading', { level: 1 }), `heading of ${screen.path}`).toHaveText(
        screen.heading,
      );
      violations.push(...(await screenViolations(page, screen.path)));
    }

    // One assertion for the whole sweep: the message carries every hit, as
    // `screen: kind: offending text`, not only the first one.
    expect(violations.join('\n'), 'Polish-locale violations').toBe('');
  });
});
