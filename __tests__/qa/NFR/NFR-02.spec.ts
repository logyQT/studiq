import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * NFR-02 — language switch PL ⇄ EN.
 *
 * Case: an authenticated user picks „English”, then „Polski”, in the user menu;
 * the same switch is repeated on a public page; the language must survive a
 * logout and a new sign-in.
 *
 * Tenant (deterministic, `content` profile, one run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts NFR-02 --fresh
 *
 * gives the org `qa-nfr-02-<suffix>` with a manager, an educator and a student
 * (`tenantKey('qa/cases/NFR-02.md', 'NFR-02#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`). The spec reads every id/credential through
 * `loadTenant('NFR-02')`; the student owns the three decks the plural check
 * needs, so no other tenant's rows are read or written. Nothing global is used:
 * no admin setting, feature flag, plan catalogue, platform stat or singleton row.
 *
 * Acceptance points confirmed on the shared app during the walk:
 * 1. The user menu has one labelled language control (#634): a „Język” row with
 *    a select showing the current language — no separate „Polski”/„English”
 *    entries — and the theme row is a three-position switch (#635).
 * 2. Choosing a language switches the page in place (`router.refresh()`, no
 *    document reload: `document.lang`, nav, breadcrumb, headings, menu copy)
 *    and stores `NEXT_LOCALE` for 365 days.
 * 3. The public footer select switches the landing page copy both ways (also
 *    in place, so the URL stays `/`).
 * 4. `flashcards_count` inflects for 1 / 2 / 5: „1 fiszka”, „2 fiszki”,
 *    „5 fiszek” vs „1 flashcard”, „2 flashcards”, „5 flashcards”.
 * 5. The choice survives a logout and a new form sign-in.
 *
 * Scope notes from the walk:
 * - `apps/admin` has no language switcher at all (its i18n only reads the
 *   cookie), so step 2's „panel admina (jeśli dostępny przełącznik)” leg is N/A
 *   in the web app; the shared suite app is `:3010` and the admin panel is a
 *   separate `:4010` app.
 * - The „no foreign fragments” bullet is asserted on translated chrome: sidebar
 *   groups/links, breadcrumb, dashboard heading, user-menu items, landing
 *   footer/hero and the login form. Data values (org name, org role display
 *   name such as „Member”, user name, deck names) and the language names
 *   themselves are excluded — they are data, not locale copy.
 * - The seeded org role display name is English in the database; the polish page
 *   renders it verbatim. Recorded as an observation, not asserted here.
 */

const CASE = 'NFR-02';
const DECKS_URL = '/api/v1/flashcards/decks';
const BULK_CREATE_URL = '/api/v1/flashcards/batch/create';

type Locale = 'pl' | 'en';

const OTHER: Record<Locale, Locale> = { pl: 'en', en: 'pl' };

/** Translated chrome that must follow the active locale, per locale. */
const CHROME: Record<
  Locale,
  {
    groups: string[];
    links: string[];
    dashboardBreadcrumb: string;
    flashcardsBreadcrumb: string[];
    greeting: string;
  }
> = {
  pl: {
    groups: ['Główne', 'Nauka', 'Treści', 'Statystyki'],
    links: ['Przegląd', 'Fiszki', 'Tematy', 'Pytania', 'Wyniki', 'Aktywność'],
    dashboardBreadcrumb: 'Moja Nauka',
    flashcardsBreadcrumb: ['Moja Nauka', 'Fiszki'],
    greeting: 'Cześć,',
  },
  en: {
    groups: ['Main', 'Study', 'Content', 'Statistics'],
    links: ['Overview', 'Flashcards', 'Topics', 'Questions', 'Results', 'Activity'],
    dashboardBreadcrumb: 'My Learning',
    flashcardsBreadcrumb: ['My Learning', 'Flashcards'],
    greeting: 'Hello,',
  },
};

/** User-menu actions. Language and theme are setting rows (a select / a switch), not items. */
const MENU: Record<Locale, string[]> = {
  pl: ['Wybierz plan', 'Konto', 'Płatności', 'Wyloguj się'],
  en: ['Upgrade', 'Account', 'Billing', 'Logout'],
};

/** Accessible names of the setting rows: „<label>: <current endonym>” and the theme group. */
const SETTINGS: Record<Locale, { language: string; theme: string }> = {
  pl: { language: 'Język: Polski', theme: 'Motyw' },
  en: { language: 'Language: English', theme: 'Theme' },
};

const LOGIN_COPY: Record<
  Locale,
  { title: string; subtitle: string; email: string; submit: string }
> = {
  pl: {
    title: 'Witaj ponownie',
    subtitle: 'Zaloguj się, aby kontynuować naukę',
    email: 'Adres e-mail',
    submit: 'Zaloguj się',
  },
  en: {
    title: 'Welcome back',
    subtitle: 'Log in to continue learning',
    email: 'Email address',
    submit: 'Log in',
  },
};

/** Public landing page: hero heading and the footer link row. */
const LANDING: Record<Locale, { hero: string; footer: string[] }> = {
  pl: {
    hero: 'Tylko to, co musisz umieć.',
    footer: ['StudiQ', 'Funkcje', 'Cennik', 'Kontakt', 'Polityka Prywatności', 'Regulamin'],
  },
  en: {
    hero: 'Learn Smarter, Not Harder',
    footer: ['StudiQ', 'Features', 'Pricing', 'Contact', 'Privacy Policy', 'Terms of Service'],
  },
};

/** `AppFlashcardDecksPage.flashcards_count` plural forms for the counts under test. */
const COUNT_LABEL: Record<Locale, (count: number) => string> = {
  pl: (count) =>
    `${count} ${count === 1 ? 'fiszka' : count >= 2 && count <= 4 ? 'fiszki' : 'fiszek'}`,
  en: (count) => `${count} ${count === 1 ? 'flashcard' : 'flashcards'}`,
};

/** Decks the spec owns inside its own tenant; reset on every run for determinism. */
const DECKS = [
  { name: `${CASE} A`, count: 1 },
  { name: `${CASE} B`, count: 2 },
  { name: `${CASE} C`, count: 5 },
] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface Deck {
  id: string;
  name: string;
}

function user(tenant: QaTenant, role: 'student'): { id: string; email: string; password: string } {
  const account = tenant.users[role];
  if (!account) {
    throw new Error(
      `${CASE} tenant has no ${role} user — seed it with: bun scripts/qa-tenant.ts ${CASE} --fresh`,
    );
  }
  return account;
}

/**
 * `NEXT_LOCALE` as the browser stores it. The cookie is written by client code
 * (`document.cookie` + `max-age=31536000`), so the context — not `document.cookie`
 * — is the only place its expiry is visible.
 */
async function localeCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === 'NEXT_LOCALE');
}

/** The stored choice has the requested value, path-wide. */
async function expectLocaleValue(page: Page, locale: Locale): Promise<void> {
  const cookie = await localeCookie(page);
  expect(cookie, 'NEXT_LOCALE is stored').toBeTruthy();
  expect(cookie!.value, 'NEXT_LOCALE value').toBe(locale);
  expect(cookie!.path, 'NEXT_LOCALE path').toBe('/');
}

/**
 * The language chosen in the product is persisted for a year. `loginAs` seeds the
 * cookie as a session cookie (the app's own default for a returning user, which
 * the case does not prescribe), so the 365-day lifetime is only asserted after a
 * switch the product itself performed.
 */
async function expectLocaleCookie(page: Page, locale: Locale): Promise<void> {
  await expectLocaleValue(page, locale);
  const cookie = (await localeCookie(page))!;
  const days = (cookie.expires - Date.now() / 1000) / 86_400;
  expect(days, `NEXT_LOCALE lifetime (${days.toFixed(1)} days)`).toBeGreaterThan(364);
  expect(days, `NEXT_LOCALE lifetime (${days.toFixed(1)} days)`).toBeLessThan(366);
}

/** A sidebar link whose exact label is `label`. */
function navLink(page: Page, label: string): Locator {
  return page
    .locator('a[data-sidebar="menu-button"]')
    .filter({ has: page.getByText(label, { exact: true }) });
}

/** A sidebar section heading („Główne”, „Nauka”, …) whose exact text is `label`. */
function navGroup(page: Page, label: string): Locator {
  return page
    .locator('[data-sidebar="group-label"]')
    .filter({ has: page.getByText(label, { exact: true }) });
}

/** Sidebar chrome is in `locale` and carries none of the other locale's labels. */
async function expectNavLocale(page: Page, locale: Locale): Promise<void> {
  for (const label of CHROME[locale].groups) {
    await expect(navGroup(page, label), `group „${label}” (${locale})`).toHaveCount(1);
  }
  for (const label of CHROME[locale].links) {
    await expect(navLink(page, label), `link „${label}” (${locale})`).toHaveCount(1);
  }
  for (const label of CHROME[OTHER[locale]].groups) {
    await expect(navGroup(page, label), `no „${label}” group in ${locale}`).toHaveCount(0);
  }
  for (const label of CHROME[OTHER[locale]].links) {
    await expect(navLink(page, label), `no „${label}” link in ${locale}`).toHaveCount(0);
  }
}

/** The dashboard (`/app`) in the given locale: sidebar, breadcrumb and greeting. */
async function expectDashboardLocale(page: Page, locale: Locale): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expectNavLocale(page, locale);
  await expect(page.locator('[data-slot="breadcrumb"]')).toHaveText(
    CHROME[locale].dashboardBreadcrumb,
  );
  await expect(page.getByRole('heading', { level: 1 })).toContainText(CHROME[locale].greeting);
}

/** The user menu trigger is the sidebar button that carries the account e-mail. */
async function openUserMenu(page: Page, email: string): Promise<void> {
  const trigger = page
    .locator('button[data-slot="dropdown-menu-trigger"]')
    .filter({ hasText: email });
  // Radix toggles on click: clicking an already-open trigger closes the menu (and
  // the popper layer swallows the click), so only click when it is closed.
  if ((await trigger.getAttribute('data-state')) !== 'open') {
    await trigger.click();
  }
  await expect(page.getByRole('menu')).toBeVisible();
}

/** The open user menu is fully in `locale`, with one language select showing the active language. */
async function expectMenuLocale(page: Page, locale: Locale): Promise<void> {
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(MENU[locale]);
  // One labelled language control (#634) — the old „Polski”/„English” entries are gone.
  await expect(menu.getByRole('combobox', { name: SETTINGS[locale].language })).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: /^(Polski|English)$/ })).toHaveCount(0);
  // The theme row is the three-position switch (#635).
  await expect(menu.getByRole('radiogroup', { name: SETTINGS[locale].theme })).toHaveCount(1);
}

/**
 * Pick a language in the user menu the way a tester does: open the menu, open
 * the language select, choose the option. The switch is in place
 * (`router.refresh()`); the menu stays open (it is a setting), so close it.
 */
async function switchLanguage(
  page: Page,
  email: string,
  target: 'Polski' | 'English',
): Promise<void> {
  await openUserMenu(page, email);
  await page
    .getByRole('menu')
    .getByRole('combobox', { name: /^(Język|Language):/ })
    .click();
  await page.getByRole('option', { name: new RegExp(target) }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', target === 'Polski' ? 'pl' : 'en');
  // Let the select finish closing, then dismiss the menu itself.
  await expect(page.getByRole('listbox')).toBeHidden();
  await page.getByRole('menu').press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
}

/** The public footer select (in place — `router.refresh()`). */
async function switchFooterLanguage(page: Page, target: 'Polski' | 'English'): Promise<void> {
  await page
    .locator('footer')
    .getByRole('combobox', { name: /^(Język|Language):/ })
    .click();
  await page.getByRole('option', { name: new RegExp(target) }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', target === 'Polski' ? 'pl' : 'en');
}

/** Card of the deck called `name` (its title is the card heading). */
function deckCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/** Every prepared deck shows its counter in `locale`'s plural form. */
async function expectDeckCounts(page: Page, locale: Locale): Promise<void> {
  for (const deck of DECKS) {
    const card = deckCard(page, deck.name);
    await expect(card, `card of „${deck.name}”`).toHaveCount(1);
    await expect(
      card.getByText(COUNT_LABEL[locale](deck.count), { exact: true }).filter({ visible: true }),
      `„${deck.name}” counter in ${locale}`,
    ).toHaveCount(1);
  }
}

/**
 * Recreate one deck with exactly `count` flashcards through the product API.
 * Deleting first makes a re-run on an already-seeded tenant deterministic (the
 * CI seeds one tenant per spec without a fresh suffix) and keeps the student's
 * Base limits untouched: three decks, eight cards.
 */
async function resetDeck(page: Page, name: string, count: number): Promise<void> {
  const listResponse = await page.request.get(`${DECKS_URL}?limit=100`);
  expect(listResponse.ok(), `GET ${DECKS_URL} → ${listResponse.status()}`).toBe(true);
  const list = (await listResponse.json()) as ApiEnvelope<{ items: Deck[] }>;
  const existing = list.data.items.find((deck) => deck.name === name);
  if (existing) {
    const deleted = await page.request.delete(`${DECKS_URL}/${existing.id}`);
    expect(deleted.ok(), `DELETE ${DECKS_URL}/${existing.id} → ${deleted.status()}`).toBe(true);
  }

  const created = await page.request.post(DECKS_URL, {
    data: { name, visibility: 'personal' },
  });
  expect(created.status(), `POST ${DECKS_URL} (${name})`).toBe(201);
  const deck = ((await created.json()) as ApiEnvelope<Deck>).data;

  const cards = Array.from({ length: count }, (_, index) => ({
    front: `${name} front ${index + 1}`,
    back: `${name} back ${index + 1}`,
  }));
  const bulk = await page.request.post(BULK_CREATE_URL, { data: { deckId: deck.id, cards } });
  expect(bulk.status(), `POST ${BULK_CREATE_URL} (${name}, ${count} cards)`).toBe(201);
}

/** The login form is in `locale`, both labels and the submit action included. */
async function expectLoginLocale(page: Page, locale: Locale): Promise<void> {
  const copy = LOGIN_COPY[locale];
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.getByText(copy.title, { exact: true })).toBeVisible();
  await expect(page.getByText(copy.subtitle, { exact: true })).toBeVisible();
  await expect(page.getByText(copy.email, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: copy.submit, exact: true })).toBeVisible();

  const other = LOGIN_COPY[OTHER[locale]];
  await expect(page.getByText(other.title, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: other.submit, exact: true })).toHaveCount(0);
}

test.describe('NFR-02 — language switch PL ⇄ EN', () => {
  test('the user menu switches the panel in place to the chosen language and stores it for a year', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const student = user(tenant, 'student');

    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/);
    await expectDashboardLocale(page, 'pl');
    await expectLocaleValue(page, 'pl');

    await openUserMenu(page, student.email);
    await expectMenuLocale(page, 'pl');

    await page.evaluate(() => {
      (window as unknown as { __localeMarker?: string }).__localeMarker = 'alive';
    });
    await switchLanguage(page, student.email, 'English');
    // The switch is in place (`router.refresh()`), not a document reload.
    expect(
      await page.evaluate(() => (window as unknown as { __localeMarker?: string }).__localeMarker),
      'the user-menu switch keeps the document (no reload)',
    ).toBe('alive');

    await expectDashboardLocale(page, 'en');
    await expectLocaleCookie(page, 'en');
    await openUserMenu(page, student.email);
    await expectMenuLocale(page, 'en');

    await switchLanguage(page, student.email, 'Polski');
    await expectDashboardLocale(page, 'pl');
    await expectLocaleCookie(page, 'pl');
  });

  test('the public footer select switches the landing page copy both ways', async ({ page }) => {
    // A visitor: no session, no locale cookie, so the app serves its `pl` default.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    expect(await localeCookie(page), 'no language cookie on a first visit').toBeUndefined();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LANDING.pl.hero);
    await expect(page.locator('footer a')).toHaveText(LANDING.pl.footer);

    await switchFooterLanguage(page, 'English');
    // `router.refresh()` — the visitor stays on the landing page.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LANDING.en.hero);
    await expect(page.locator('footer a')).toHaveText(LANDING.en.footer);
    await expectLocaleCookie(page, 'en');

    await switchFooterLanguage(page, 'Polski');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LANDING.pl.hero);
    await expect(page.locator('footer a')).toHaveText(LANDING.pl.footer);
    await expectLocaleCookie(page, 'pl');
  });

  test('flashcard counters inflect in the active locale on the deck list', async ({ page }) => {
    const tenant = loadTenant(CASE);
    const student = user(tenant, 'student');

    await loginAs(page, tenant, 'student', { locale: 'pl' });
    for (const deck of DECKS) {
      await resetDeck(page, deck.name, deck.count);
    }

    await page.goto('/app/flashcards');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    for (const crumb of CHROME.pl.flashcardsBreadcrumb) {
      await expect(page.locator('[data-slot="breadcrumb"]')).toContainText(crumb);
    }
    await expectDeckCounts(page, 'pl');

    await switchLanguage(page, student.email, 'English');
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    await expectNavLocale(page, 'en');
    for (const crumb of CHROME.en.flashcardsBreadcrumb) {
      await expect(page.locator('[data-slot="breadcrumb"]')).toContainText(crumb);
    }
    await expectDeckCounts(page, 'en');

    await switchLanguage(page, student.email, 'Polski');
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    await expectDeckCounts(page, 'pl');
  });

  test('the chosen language survives a logout and a new sign-in', async ({ page }) => {
    const tenant = loadTenant(CASE);
    const student = user(tenant, 'student');

    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await switchLanguage(page, student.email, 'English');
    await expectDashboardLocale(page, 'en');

    // Log out through the user menu — the same path a tester takes.
    await openUserMenu(page, student.email);
    await page.getByRole('menuitem', { name: 'Logout', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
    await expectLoginLocale(page, 'en');
    await expectLocaleCookie(page, 'en');

    // A fresh sign-in through the form, not the API helper.
    await page.locator('input[name=email]').fill(student.email);
    await page.locator('input[name=password]').fill(student.password);
    await page.getByRole('button', { name: LOGIN_COPY.en.submit, exact: true }).click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });

    await expectDashboardLocale(page, 'en');
    await expectLocaleCookie(page, 'en');

    // The cookie is the whole state: a reload keeps the language too.
    await page.reload();
    await expectDashboardLocale(page, 'en');
  });
});
