import { expect, test } from '@playwright/test';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';

/**
 * #634 — one app-wide language switcher: a labelled expandable select (cmdk
 * combobox inside a Radix popover, or inline in the mobile sheet) shared by the
 * footer, the navbar avatar menu, the dashboard sidebar and the mobile sheet.
 *
 * The unit tests cover `lib/locale.ts`; everything interactional (combobox
 * semantics, the menu → popover handoff, the single commit path and the polite
 * announcement) is proven here — the repo has no DOM test environment.
 */

const STUDENT_EMAIL = 'student1@dev.local';
const PASSWORD = 'pass';

const SWITCHER_LABEL = pl.LanguageSwitcher.label; // „Język” (the default locale)
const CURRENT_MARKER = pl.LanguageSwitcher.current; // „bieżący”
const ANNOUNCED_EN = pl.LanguageSwitcher.changed.replace('{language}', 'angielski');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/E-mail|Email/i).fill(STUDENT_EMAIL);
  await page.getByLabel(/Hasło|Password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /Zaloguj|Log in|Sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test.describe('language switcher', () => {
  test('footer: labelled trigger, one panel, in-place commit, persistence', async ({
    page,
    context,
  }) => {
    await page.goto('/pricing');

    const trigger = page.getByRole('button', { name: /Język: Polski/ });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // A page marker that only survives a client-side refresh, not a reload.
    await page.evaluate(() => {
      (window as unknown as { __localeMarker?: string }).__localeMarker = 'alive';
    });

    await trigger.click();

    const dialog = page.getByRole('dialog', { name: SWITCHER_LABEL });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Same combobox name in every surface, flags decorative, current locale marked.
    await expect(
      page.getByRole('combobox', { name: pl.LanguageSwitcher.search_label }),
    ).toBeFocused();
    await expect(page.getByRole('listbox', { name: SWITCHER_LABEL })).toBeVisible();
    const options = page.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options).toHaveText([/Polski/, /English/]);

    const current = page.locator('[cmdk-item][data-current="true"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('Polski');
    await expect(current.locator('.sr-only')).toHaveText(CURRENT_MARKER);
    // `aria-selected` follows cmdk's highlight, which starts on the current locale.
    await expect(current).toHaveAttribute('aria-selected', 'true');
    // The flag is decorative only — the endonym is always the label.
    for (const option of await options.all()) {
      await expect(option.locator('span[aria-hidden="true"]')).toHaveCount(1);
      await expect(option.locator('span[aria-hidden="true"] svg')).toHaveCount(1);
    }

    // Opening announces the current option as the combobox's active descendant.
    const input = page.getByRole('combobox', { name: pl.LanguageSwitcher.search_label });
    expect(await input.getAttribute('aria-activedescendant')).toBe(
      await current.getAttribute('id'),
    );

    await page.getByRole('option', { name: 'English' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: /Language: English/ })).toBeFocused();

    // In-place refresh: same URL, no document reload, no scroll reset.
    expect(page.url()).toContain('/pricing');
    expect(
      await page.evaluate(() => (window as unknown as { __localeMarker?: string }).__localeMarker),
    ).toBe('alive');
    await expect(page.getByRole('heading', { name: en.PricingPage.title })).toBeVisible();

    // Exactly one polite announcement, in the language the user was reading.
    await expect(page.locator('[role="status"][aria-live="polite"]')).toHaveText(ANNOUNCED_EN);

    const cookie = (await context.cookies()).find((entry) => entry.name === 'NEXT_LOCALE');
    expect(cookie?.value).toBe('en');
    expect(cookie?.path).toBe('/');
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 31_000_000);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: /Language: English/ })).toBeVisible();
  });

  test('search: fuzzy filter and the empty state outside the listbox', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: /Język: Polski/ }).click();

    const input = page.getByRole('combobox', { name: pl.LanguageSwitcher.search_label });
    const options = page.getByRole('option');

    for (const query of ['eng', 'english', 'en']) {
      await input.fill(query);
      await expect(options).toHaveCount(1);
      await expect(options.first()).toContainText('English');
    }

    for (const query of ['pl', 'polski']) {
      await input.fill(query);
      await expect(options).toHaveCount(1);
      await expect(options.first()).toContainText('Polski');
    }

    await input.fill('zzz');
    await expect(options).toHaveCount(0);

    const empty = page.getByRole('dialog', { name: SWITCHER_LABEL }).locator('[cmdk-empty]');
    await expect(empty).toBeVisible();
    await expect(empty.getByRole('status')).toHaveText(pl.LanguageSwitcher.empty_title);
    await expect(empty).toContainText(pl.LanguageSwitcher.empty_hint);
    // A button must not live inside `role=listbox`.
    expect(await empty.evaluate((node) => node.closest('[cmdk-list]') !== null)).toBe(false);

    await empty.getByRole('button', { name: pl.LanguageSwitcher.empty_clear }).click();
    await expect(options).toHaveCount(2);
    await expect(input).toBeFocused();

    // Never render a raw message key.
    await expect(page.getByText(/LanguageSwitcher\./)).toHaveCount(0);
  });

  test('keyboard only: open, move, commit, focus return', async ({ page }) => {
    await page.goto('/pricing');

    const trigger = page.getByRole('button', { name: /Język: Polski/ });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const input = page.getByRole('combobox', { name: pl.LanguageSwitcher.search_label });
    await expect(input).toBeFocused();

    // Enter without typing keeps the current locale (the current option is first).
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();

    const selected = page.locator('[cmdk-item][aria-selected="true"]');
    await expect(selected).toContainText('Polski');
    await page.keyboard.press('ArrowDown');
    await expect(selected).toContainText('English');
    await page.keyboard.press('Home');
    await expect(selected).toContainText('Polski');
    await page.keyboard.press('End');
    await expect(selected).toContainText('English');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: SWITCHER_LABEL })).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await page.keyboard.press('End');
    await expect(selected).toContainText('English');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: /Language: English/ })).toBeFocused();
  });

  test('user menu: one language row hands off to the same panel', async ({ page }) => {
    await login(page);
    await page.goto('/pricing');

    const avatar = page.getByRole('button', { name: pl.Navbar.user_menu });
    // Read the box before opening: the modal menu marks the rest of the page
    // `aria-hidden`, so the avatar stops resolving by role while it is open.
    const avatarBox = await avatar.boundingBox();
    await avatar.click();

    // Exactly one language entry — the two `Polski`/`English` rows are gone.
    await expect(page.getByRole('menuitem', { name: /Język|Language/ })).toHaveCount(1);
    await expect(page.getByRole('menuitem', { name: /^Polski$/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^English$/ })).toHaveCount(0);

    await page.getByRole('menuitem', { name: /Język|Language/ }).click();

    const dialog = page.getByRole('dialog', { name: SWITCHER_LABEL });
    await expect(dialog).toBeVisible();
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await expect(
      page.getByRole('combobox', { name: pl.LanguageSwitcher.search_label }),
    ).toBeFocused();

    // The handoff must land outside `aria-hidden` and off the menu's pointer lock.
    expect(await dialog.evaluate((node) => node.closest('[aria-hidden="true"]') !== null)).toBe(
      false,
    );
    expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');

    // Anchored to the menu trigger, not at 0,0.
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox && avatarBox).toBeTruthy();
    if (dialogBox && avatarBox) {
      expect(
        Math.abs(dialogBox.x + dialogBox.width - (avatarBox.x + avatarBox.width)),
      ).toBeLessThan(16);
      expect(dialogBox.y).toBeGreaterThan(avatarBox.y);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(avatar).toBeFocused();
  });

  test('deep route: sidebar row switches the locale without a reload', async ({ page }) => {
    await login(page);
    await page.goto('/app/stats/content');

    const trigger = page.locator('[data-sidebar="menu-button"][aria-haspopup="menu"]').last();
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: /Język|Language/ })).toHaveCount(1);
    await page.getByRole('menuitem', { name: /Język|Language/ }).click();

    const dialog = page.getByRole('dialog', { name: SWITCHER_LABEL });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: pl.LanguageSwitcher.search_label }),
    ).toBeFocused();

    await page.evaluate(() => {
      (window as unknown as { __localeMarker?: string }).__localeMarker = 'alive';
    });
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await page.getByRole('option', { name: 'English' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(page.url()).toContain('/app/stats/content');
    expect(
      await page.evaluate(() => (window as unknown as { __localeMarker?: string }).__localeMarker),
    ).toBe('alive');
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');
  });

  test('mobile sheet: the panel expands inline and keeps the sheet open', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/pricing');

    await page.getByRole('button', { name: 'Menu', exact: true }).click();

    const sheet = page.locator('[data-slot="sheet-content"]');
    const row = sheet.getByRole('button', { name: /Język|Language/ });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('aria-expanded', 'false');

    await row.click();

    // Inline, not a second layer: the sheet is still the only dialog.
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await expect(
      sheet.getByRole('combobox', { name: pl.LanguageSwitcher.search_label }),
    ).toBeVisible();
    await expect(sheet.getByRole('option')).toHaveCount(2);

    await sheet.getByRole('option', { name: 'English' }).click();

    // The sheet stays open so the labels flip in place.
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[cmdk-input]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(sheet.getByRole('button', { name: /Language/ })).toContainText('English');
  });
});
