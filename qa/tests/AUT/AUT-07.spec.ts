import { expect, test, type Page } from '@playwright/test';
import { loadTenant, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-07 — every account type signs in and lands on its own dashboard.
 *
 * The case signs in as a manager, a teacher and a student in turn, notes the
 * landing URL, logs out, and checks the sidebar menu and the user menu (name +
 * e-mail) at the bottom of the sidebar for each role.
 *
 * The legacy accounts from the manual seed (`manager@dev.local`,
 * `teacher1@dev.local`, `student1@dev.local`, password `pass`) are replaced by
 * the case's own `content` tenant, seeded with a fresh run suffix before every
 * independent run:
 *
 *   bun scripts/qa-tenant.ts AUT-07 --profile content --fresh
 *
 * That tenant owns one organization, its admin (manager), one educator and one
 * student, all deriving from
 * `tenantKey('qa/cases/AUT-07.md', 'AUT-07#<run>', 'qa-shared')` + `tenantId`.
 * The spec only reads its own tenant: no global admin setting, feature flag,
 * plan row, platform stat or another worker's tenant is read or written.
 *
 * Nothing here is plan- or flag-gated: the menu entries asserted below are the
 * static ones from `app-sidebar.tsx` (the `ai.chat` / `group.manage` entries are
 * deliberately not pinned), so a plan or flag change elsewhere cannot turn this
 * test red.
 *
 * Polish copy is asserted because the case quotes the Polish UI; `NEXT_LOCALE=pl`
 * is pinned so a locale cookie from another case cannot change the strings.
 */

const CASE = 'AUT-07';
const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

/** Account-type metadata the login must have produced for the role. */
type AccountType = 'manager' | 'educator' | 'student';

interface MenuEntry {
  /** Sidebar label, verbatim from the Polish UI. */
  label: string;
  href: string;
}

interface RoleCase {
  role: 'manager' | 'teacher' | 'student';
  accountType: AccountType;
  /** Dashboard the role must land on after login. */
  dashboard: string;
  /** Breadcrumb page title rendered in the dashboard header. */
  title: string;
  /** Role-specific sidebar section the entries live under. */
  section: string;
  entries: MenuEntry[];
  /** Links of the other roles that must not appear in this sidebar. */
  foreign: string[];
}

const ROLES: RoleCase[] = [
  {
    role: 'manager',
    accountType: 'manager',
    dashboard: '/manage',
    title: 'Zarządzanie Uczelnią',
    section: 'Administracja',
    entries: [
      { label: 'Przegląd', href: '/manage' },
      { label: 'Członkowie', href: '/manage/members' },
      { label: 'Zaproszenia', href: '/manage/invites' },
      { label: 'Grupy', href: '/manage/groups' },
      { label: 'Role', href: '/manage/roles' },
      { label: 'Licencje', href: '/manage/seats' },
      { label: 'Ustawienia', href: '/manage/settings' },
    ],
    foreign: ['/edu/quizzes', '/app/study/learn'],
  },
  {
    role: 'teacher',
    accountType: 'educator',
    dashboard: '/edu',
    title: 'Panel Nauczyciela',
    section: 'Treści',
    entries: [
      { label: 'Przegląd', href: '/edu' },
      { label: 'Talie', href: '/edu/flashcards' },
      { label: 'Tematy', href: '/edu/topics' },
      { label: 'Pytania', href: '/edu/questions' },
      { label: 'Testy', href: '/edu/quizzes' },
      { label: 'Kartkówki', href: '/edu/assignments' },
      { label: 'Zgłoszenia', href: '/edu/reports' },
    ],
    foreign: ['/manage/members', '/manage/seats', '/app/study/learn'],
  },
  {
    role: 'student',
    accountType: 'student',
    dashboard: '/app',
    title: 'Moja Nauka',
    section: 'Nauka',
    entries: [
      { label: 'Przegląd', href: '/app' },
      { label: 'Ucz się', href: '/app/study/learn' },
      { label: 'Wkuwaj', href: '/app/study/cram' },
      { label: 'Sprawdź się', href: '/app/study/quiz' },
      { label: 'Fiszki', href: '/app/flashcards' },
      { label: 'Tematy', href: '/app/topics' },
      { label: 'Pytania', href: '/app/questions' },
      { label: 'Kartkówki', href: '/app/assignments' },
    ],
    foreign: ['/manage/members', '/manage/seats', '/edu/quizzes'],
  },
];

const UI = {
  loginTitle: 'Witaj ponownie',
  emailLabel: 'Adres e-mail',
  passwordLabel: 'Hasło',
  loginButton: 'Zaloguj się',
  logout: 'Wyloguj się',
} as const;

/** Sidebar footer user menu trigger (bottom of the sidebar). */
const USER_MENU = '[data-sidebar="footer"] button';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sign the seeded user in through the real login form (the surface under test). */
async function signIn(page: Page, tenant: QaTenant, role: RoleCase['role']): Promise<void> {
  const user = tenant.users[role];
  if (!user) {
    throw new Error(
      `AUT-07 fixture incomplete: tenant ${tenant.case} has no ${role}; ` +
        'run `bun scripts/qa-tenant.ts AUT-07 --profile content --fresh` first',
    );
  }

  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(UI.loginTitle, { exact: true })).toBeVisible();

  await page.getByLabel(UI.emailLabel, { exact: true }).fill(user.email);
  await page.getByLabel(UI.passwordLabel, { exact: true }).fill(user.password);
  await page.getByRole('button', { name: UI.loginButton, exact: true }).click();
}

/** Log out through the user menu at the bottom of the sidebar (case step „Wyloguj”). */
async function signOut(page: Page): Promise<void> {
  await page.locator(USER_MENU).click();
  await page.getByRole('menuitem', { name: UI.logout, exact: true }).click();
  await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 20_000 });
  await expect(page.getByText(UI.loginTitle, { exact: true })).toBeVisible();
}

test.describe('AUT-07 — login for every account type', () => {
  test('manager, teacher and student each land on their dashboard, then log out', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(tenant.org, 'the content tenant owns its organization').not.toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();

    // The case quotes the Polish UI; pin the cookie a returning browser keeps.
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);

    for (const role of ROLES) {
      const user = tenant.users[role.role];
      expect(user, `${CASE} seeds a ${role.role}`).toBeTruthy();

      // --- Step 1/2/3: sign in through the login form ---------------------
      await signIn(page, tenant, role.role);

      // Expected result 1: the account type decides the landing page.
      await expect(page, `${role.role} lands on ${role.dashboard}`).toHaveURL(
        new RegExp(`${escapeRegExp(role.dashboard)}$`),
        { timeout: 20_000 },
      );
      await expect(
        page.locator('[data-slot="breadcrumb-page"]', { hasText: role.title }),
        `dashboard header for ${role.role}`,
      ).toBeVisible();

      // The session really belongs to this tenant's user of this account type.
      const meResponse = await page.request.get('/api/v1/auth/me');
      expect(meResponse.ok(), 'GET /api/v1/auth/me').toBe(true);
      const me = (await meResponse.json()) as {
        data?: {
          user?: {
            email?: string;
            user_metadata?: { name?: string };
            app_metadata?: { account_type?: string };
          } | null;
        };
      };
      const signedIn = me.data?.user;
      expect(signedIn?.email, 'the session belongs to the tenant user').toBe(user!.email);
      expect(signedIn?.app_metadata?.account_type, 'account type of the signed-in user').toBe(
        role.accountType,
      );
      const displayName = signedIn?.user_metadata?.name;
      expect(displayName, 'the profile has a display name').toBeTruthy();

      // --- Expected result 2: the role's sidebar menu ----------------------
      const sidebar = page.locator('[data-slot="sidebar"]');
      await expect(sidebar, 'one desktop sidebar').toHaveCount(1);
      // The switcher names this run's organization, so the menu belongs to the
      // case's tenant rather than to a stale session from another worker.
      await expect(sidebar.getByText(tenant.org!.name, { exact: true })).toBeVisible();
      await expect(
        sidebar.locator('[data-sidebar="group-label"]', { hasText: role.section }),
        `sidebar section "${role.section}"`,
      ).toBeVisible();

      for (const entry of role.entries) {
        const link = sidebar.locator(`a[href="${entry.href}"]`);
        await expect(link, `sidebar entry "${entry.label}"`).toHaveCount(1);
        await expect(link, `label of ${entry.href}`).toHaveText(entry.label);
      }

      // A different role's menu must not leak into this sidebar.
      for (const href of role.foreign) {
        await expect(
          sidebar.locator(`a[href="${href}"]`),
          `a ${role.role} must not see ${href}`,
        ).toHaveCount(0);
      }

      // --- Expected result 3: name and e-mail in the user menu -------------
      const userMenu = page.locator(USER_MENU);
      await expect(userMenu, 'user menu at the bottom of the sidebar').toBeVisible();
      await expect(userMenu, 'user menu shows the display name').toContainText(displayName!);
      await expect(userMenu, 'user menu shows the e-mail').toContainText(user!.email);
      await expect(page.getByText(/ERROR_/)).toHaveCount(0);

      // --- Step „Wyloguj”: the user menu ends the session ------------------
      await signOut(page);

      // The dashboard is protected again: the same URL now asks for a login.
      await page.goto(role.dashboard);
      await expect(page).toHaveURL(
        new RegExp(`/login\\?next=${encodeURIComponent(role.dashboard)}`),
        { timeout: 20_000 },
      );
      await expect(page.getByText(UI.loginTitle, { exact: true })).toBeVisible();
    }
  });
});
