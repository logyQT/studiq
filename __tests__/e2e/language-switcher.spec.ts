import { expect, type Page, test } from '@playwright/test';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/**
 * #634 — one app-wide language switcher, #635 — the three-position theme switch.
 *
 * Desktop: a plain select (no search) in the user menus and the footer.
 * Touch: the searchable panel — a drill-in view of the bottom drawer in the
 * dashboard sidebar, inline in the navbar sheet. The unit tests cover
 * `lib/locale.ts` and `lib/language-filter.ts`; everything interactional is
 * proven here — the repo has no DOM test environment.
 */

const STUDENT_EMAIL = 'student1@dev.local';
const PASSWORD = 'pass';

const LANGUAGE = pl.LanguageSwitcher.label; // „Język”
const SEARCH = pl.LanguageSwitcher.search_label;
const ANNOUNCED_EN = pl.LanguageSwitcher.changed.replace('{language}', 'angielski');
const MOBILE = { width: 390, height: 844 };

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/E-mail|Email/i).fill(STUDENT_EMAIL);
  await page.getByLabel(/Hasło|Password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /Zaloguj|Log in|Sign in/i }).click();
  await page.waitForURL(/\/app/);
}

/** A marker that only survives a client-side refresh, not a document reload. */
async function markPage(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __localeMarker?: string }).__localeMarker = 'alive';
  });
}

async function pageMarker(page: Page) {
  return page.evaluate(() => (window as unknown as { __localeMarker?: string }).__localeMarker);
}

test.describe('language switcher — desktop select', () => {
  test('footer: plain select, in-place commit, announcement, persistence', async ({
    page,
    context,
  }) => {
    await page.goto('/pricing');

    const select = page.locator('footer').getByRole('combobox', { name: /Język: Polski/ });
    await expect(select).toBeVisible();
    await markPage(page);

    await select.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    // Desktop has no search field.
    await expect(page.locator('[cmdk-input]')).toHaveCount(0);

    const options = listbox.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText('Polski');
    // Endonym + the name in the UI language, so a language is findable either way.
    await expect(options.nth(1)).toContainText('English');
    await expect(options.nth(1)).toContainText('angielski');
    await expect(listbox.getByRole('option', { name: /Polski/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Endonyms are never machine-translated; flags are decorative only.
    await expect(options.nth(1).locator('[translate="no"][lang="en"]')).toHaveText('English');
    for (const option of await options.all()) {
      await expect(option.locator('[data-slot="locale-flag"][aria-hidden="true"] svg')).toHaveCount(
        1,
      );
    }

    await listbox.getByRole('option', { name: /English/ }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.locator('footer').getByRole('combobox', { name: /Language: English/ }),
    ).toBeFocused();
    // In place: same URL, no document reload.
    expect(page.url()).toContain('/pricing');
    expect(await pageMarker(page)).toBe('alive');
    await expect(page.getByRole('heading', { name: en.PricingPage.title })).toBeVisible();
    // One polite announcement, in the language the user was reading.
    await expect(
      page.locator('[role="status"][aria-live="polite"][aria-atomic="true"]'),
    ).toHaveText(ANNOUNCED_EN);

    const cookie = (await context.cookies()).find((entry) => entry.name === 'NEXT_LOCALE');
    expect(cookie?.value).toBe('en');
    expect(cookie?.path).toBe('/');
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 31_000_000);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText(/LanguageSwitcher\./)).toHaveCount(0);
  });

  test('keyboard only: open, move, commit, focus return', async ({ page }) => {
    await page.goto('/pricing');

    const select = page.locator('footer').getByRole('combobox', { name: /Język: Polski/ });
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();

    // Escape closes without changing anything.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(select).toBeFocused();

    await page.keyboard.press('Enter');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    // Opening highlights the current language; arrows move, Enter commits.
    await expect(listbox.getByRole('option', { name: /Polski/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(listbox.getByRole('option', { name: /English/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.locator('footer').getByRole('combobox', { name: /Language: English/ }),
    ).toBeFocused();
  });

  test('navbar avatar menu: one labelled language row with the select', async ({ page }) => {
    await login(page);
    await page.goto('/pricing');

    await page.getByRole('button', { name: pl.Navbar.user_menu }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Exactly one language control — the two `Polski` / `English` rows are gone.
    await expect(menu.getByRole('combobox', { name: /Język: Polski/ })).toHaveCount(1);
    await expect(menu.getByRole('menuitem', { name: /^Polski$/ })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: /^English$/ })).toHaveCount(0);

    await menu.getByRole('combobox', { name: /Język: Polski/ }).click();
    await page.getByRole('option', { name: /English/ }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // Choosing a language is a setting: the menu stays open until dismissed.
    await expect(menu).toBeVisible();
    await expect(page.getByRole('listbox')).toBeHidden();
    await menu.press('Escape');
    await expect(menu).toBeHidden();
    expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');
  });

  test('deep route: sidebar menu switches the locale without a reload', async ({ page }) => {
    await login(page);
    await page.goto('/app/stats/content');

    await page.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').last().click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('combobox', { name: /Język: Polski/ })).toHaveCount(1);

    await markPage(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await menu.getByRole('combobox', { name: /Język: Polski/ }).click();
    await page.getByRole('option', { name: /English/ }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(page.url()).toContain('/app/stats/content');
    expect(await pageMarker(page)).toBe('alive');
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });
});

test.describe('language switcher — touch panel', () => {
  test.use({ viewport: MOBILE, hasTouch: true });

  test('dashboard: bottom drawer drills into a searchable language view', async ({ page }) => {
    await login(page);
    await page.goto('/app/stats/content');

    await page.locator('[data-sidebar="trigger"]').click();
    await page.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').last().click();

    const drawer = page.locator('[data-slot="drawer-content"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('combobox')).toHaveCount(0);

    const row = drawer.getByRole('button', { name: /Język/ });
    await expect(row).toContainText('Polski');
    await row.click();

    await expect(drawer.getByRole('heading', { name: LANGUAGE })).toBeVisible();
    const input = drawer.getByRole('combobox', { name: SEARCH });
    // The search field must keep focus inside the drawer, which is nested in
    // the modal sidebar sheet (regression: two Radix FocusScope copies fought).
    await input.click();
    await expect(input).toBeFocused();

    const options = drawer.getByRole('option');
    await expect(options).toHaveCount(2);

    // Predictable matching: word prefixes of endonyms, localized names and codes.
    for (const [query, expected] of [
      ['ang', 'English'],
      ['en', 'English'],
      ['pol', 'Polski'],
      ['POL', 'Polski'],
    ] as const) {
      await input.fill(query);
      await expect(options).toHaveCount(1);
      await expect(options.first()).toContainText(expected);
    }

    await input.fill('zzz');
    await expect(options).toHaveCount(0);
    const empty = drawer.locator('[cmdk-empty]');
    await expect(empty.getByRole('status')).toHaveText(pl.LanguageSwitcher.empty_title);
    // The empty state never lives inside `role=listbox`.
    expect(await empty.evaluate((node) => node.closest('[cmdk-list]') !== null)).toBe(false);
    await expect.poll(() => input.getAttribute('aria-activedescendant')).toBeNull();

    // ✕ clears the query and keeps focus in the field.
    await drawer.getByRole('button', { name: pl.LanguageSwitcher.empty_clear }).click();
    await expect(options).toHaveCount(2);
    await expect(input).toBeFocused();

    await markPage(page);
    await drawer.getByRole('option', { name: /English/ }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await pageMarker(page)).toBe('alive');
    // Back on the menu view, drawer still open, showing the new language.
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Language/ })).toContainText('English');
  });

  test('dashboard: the back button returns to the menu without changes', async ({ page }) => {
    await login(page);
    await page.goto('/app');

    await page.locator('[data-sidebar="trigger"]').click();
    await page.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').last().click();
    const drawer = page.locator('[data-slot="drawer-content"]');
    await drawer.getByRole('button', { name: /Język/ }).click();
    await drawer.getByRole('button', { name: pl.LanguageSwitcher.back }).click();

    await expect(drawer.getByRole('button', { name: /Język/ })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  });

  test('navbar sheet: the panel expands inline and returns focus to the row', async ({ page }) => {
    await login(page);
    await page.goto('/pricing');

    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    const row = sheet.getByRole('button', { name: /Język|Language/ });
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(row).not.toHaveAttribute('aria-controls');

    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    const input = sheet.getByRole('combobox', { name: SEARCH });
    await expect(input).toBeVisible();
    await expect(sheet.getByRole('option')).toHaveCount(2);

    // Keyboard commit: the panel unmounts and focus lands back on the row.
    await input.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(sheet).toBeVisible();
    await expect(row).toBeFocused();
    await expect(row).toContainText('English');
  });
});

test.describe('theme switch (#635)', () => {
  test.use({ colorScheme: 'light' });

  test('three positions, explicit state, persistence and a way back to System', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/app');

    await page.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').last().click();
    const menu = page.getByRole('menu');
    const group = menu.getByRole('radiogroup', { name: pl.ThemeSwitch.label });
    await expect(group.getByRole('radio')).toHaveCount(3);

    // First visit follows the OS: System is checked and named after the result.
    const system = group.getByRole('radio', { name: /^System/ });
    await expect(system).toHaveAttribute('aria-checked', 'true');
    await expect(system).toHaveAccessibleName('System (jasny)');
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

    await group.getByRole('radio', { name: pl.ThemeSwitch.dark, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(
      group.getByRole('radio', { name: pl.ThemeSwitch.dark, exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(system).toHaveAttribute('aria-checked', 'false');
    // Choosing a theme is a setting, not an action: the menu stays open.
    await expect(menu).toBeVisible();
    // Every activation is stated, also to assistive tech.
    await expect(group.locator('..').getByRole('status')).toHaveText(pl.ThemeSwitch.dark);

    // Arrow keys move the choice (radiogroup semantics, roving focus).
    await group.getByRole('radio', { name: pl.ThemeSwitch.dark, exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(system).toHaveAttribute('aria-checked', 'true');
    await expect(system).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(
      group.getByRole('radio', { name: pl.ThemeSwitch.light, exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

    // Persisted across a reload; no hydration warnings on the way.
    await group.getByRole('radio', { name: pl.ThemeSwitch.dark, exact: true }).click();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    expect(errors.filter((text) => /hydrat/i.test(text))).toEqual([]);

    // System is reachable again and follows the OS.
    await page.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').last().click();
    await page
      .getByRole('menu')
      .getByRole('radio', { name: /^System/ })
      .click();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  });
});
