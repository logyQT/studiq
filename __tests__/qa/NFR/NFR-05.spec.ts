import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * NFR-05 — keyboard operability.
 *
 * Case: walk the login and registration forms with the keyboard only (Tab, Shift+Tab,
 * Enter, Space), open and close a dialog with Esc, and check that focus is visible.
 * Expected: focus order is logical, focus is visible, Enter submits the form, Esc closes
 * dialogs and focus returns to the element that opened them.
 *
 * Tenant (deterministic, `content` profile, one run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts NFR-05 --fresh
 *
 * gives the org `qa-nfr-05-<suffix>` with a manager, an educator and a student
 * (`tenantKey('qa/cases/NFR-05.md', 'NFR-05#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`). The spec reads every credential through
 * `loadTenant('NFR-05')`. Only the student is used, and only to sign in through the
 * login form and to reach `/app/flashcards` for the dialog leg — no row is created,
 * changed or deleted, so a retry against the same seeded tenant is just as green.
 * Nothing global is used: no admin setting, feature flag, plan catalogue, platform
 * stat or singleton row.
 *
 * Acceptance points confirmed on the shared app during the walk:
 * 1. `/login`: Tab reaches e-mail → password → submit → „Zarejestruj się”; Shift+Tab
 *    walks the same order backwards. Every stop draws a 3 px `ring-ring/50` ring (the
 *    trailing link falls back to the browser's 1 px auto outline).
 * 2. Enter in the password field submits the form — a real sign-in, not a
 *    client-only no-op — and lands on the student dashboard.
 * 3. `/register`: Tab reaches name → e-mail → account type → password → submit.
 *    Space opens the account-type listbox, Esc closes it without a selection and
 *    returns focus to the trigger, Space again + ArrowDown + Enter selects an option.
 * 4. Enter in the register form submits it: with empty required fields the browser
 *    renders the three validation messages instead of registering anything.
 * 5. A dialog on `/app/flashcards` opens with Enter from its trigger, moves focus
 *    inside, traps Tab inside it, closes on Esc and returns focus to the trigger with
 *    a visible ring (`useRestoreFocusOnClose`, decision #190).
 *
 * Scope notes from the walk:
 * - The „Nie pamiętasz hasła?” link on `/login` is deliberately removed from the tab
 *   order (`tabIndex={-1}`), so Tab from the e-mail field goes straight to the
 *   password field. The order helper below tolerates one extra stop, so this test
 *   does not encode the link's absence either way. Recorded as an observation for
 *   triage, not asserted.
 * - The dialog's two bare text fields opt out of the ring (`focus-visible:ring-0`,
 *   the focus cue is a 1 px underline colour change), so focus visibility is asserted
 *   on the dialog's buttons and on the trigger, not on those two fields.
 * - The dialog close button carries a hardcoded English `sr-only` „Close” label; the
 *   spec selects it by `[data-slot="dialog-close"]` so it does not depend on that copy.
 */

const CASE = 'NFR-05';
const FLASHCARDS_PATH = '/app/flashcards';

interface FocusStyle {
  tag: string;
  focusVisible: boolean;
  outlineStyle: string;
  outlineWidth: number;
  outlineColor: string;
  boxShadow: string;
}

function user(tenant: QaTenant): { id: string; email: string; password: string } {
  const account = tenant.users.student;
  if (!account) {
    throw new Error(
      `${CASE} tenant has no student user — seed it with: bun scripts/qa-tenant.ts ${CASE} --fresh`,
    );
  }
  return account;
}

/**
 * Tab (or Shift+Tab) until `target` owns the focus. `max` allows one extra tab stop
 * between the expected elements, so a helper link becoming focusable later does not
 * fail the test; it still proves the forward/backward order of the elements we assert.
 */
async function tabTo(
  page: Page,
  target: Locator,
  options: { backwards?: boolean; max?: number; label?: string } = {},
): Promise<number> {
  const { backwards = false, max = 2, label = 'target' } = options;
  const key = backwards ? 'Shift+Tab' : 'Tab';
  for (let pressed = 1; pressed <= max; pressed += 1) {
    await page.keyboard.press(key);
    if (await target.evaluate((element) => element === document.activeElement)) return pressed;
  }
  const active = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element
      ? `${element.tagName}${element.id ? `#${element.id}` : ''} „${(element.innerText ?? '').trim().slice(0, 30)}”`
      : 'none';
  });
  throw new Error(`focus did not reach ${label} after ${max}× ${key} (focused: ${active})`);
}

/** The computed focus styles of whatever currently owns the focus. */
async function focusStyle(page: Page): Promise<FocusStyle | null> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName,
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
    };
  });
}

/** `rgba(0, 0, 0, 0)` / `oklab(… / 0)` — a colour with zero alpha. */
function isTransparent(color: string): boolean {
  return /,\s*0(?:\.\d+)?\)$/.test(color) || /\/\s*0(?:\.\d+)?\)$/.test(color);
}

/**
 * A keyboard user can see where they are: either a real outline or a box-shadow ring
 * with a spread of at least 2 px (the product draws `ring-[3px]` on form controls and
 * buttons, and `focus:ring-2` on the dialog close button).
 */
function hasVisibleFocus(style: FocusStyle): boolean {
  const outline =
    style.outlineStyle !== 'none' && style.outlineWidth >= 1 && !isTransparent(style.outlineColor);

  const ring = style.boxShadow.split(/,(?![^(]*\))/).some((layer) => {
    const lengths = (layer.match(/-?\d*\.?\d+px/g) ?? []).map((value) => Number.parseFloat(value));
    return lengths.length >= 4 && lengths[3] >= 2 && !isTransparent(layer);
  });

  return outline || ring;
}

/**
 * The element that currently has focus matches `:focus-visible` and shows a cue.
 * Polled for a moment because the ring fades in through a CSS transition.
 */
async function expectVisibleFocus(page: Page, label: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const style = await focusStyle(page);
        if (!style) return 'no element has focus';
        if (!style.focusVisible) return `${style.tag} does not match :focus-visible`;
        if (!hasVisibleFocus(style)) {
          return `no cue: outline=${style.outlineStyle}/${style.outlineWidth}/${style.outlineColor} shadow=${style.boxShadow}`;
        }
        return 'ok';
      },
      { message: `${label}: visible focus cue`, timeout: 2_000 },
    )
    .toBe('ok');
}

test.describe('NFR-05 — keyboard operability', () => {
  test('the login form is keyboard operable: logical tab order, visible focus and Enter submits', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const student = user(tenant);

    await page.goto('/login');

    const email = page.locator('input#email');
    const password = page.locator('input#password');
    const submit = page.locator('form button[type="submit"]');

    await expect(email).toBeVisible();

    // First Tab from the document reaches the first field — nothing precedes it.
    await page.keyboard.press('Tab');
    await expect(email).toBeFocused();
    await expectVisibleFocus(page, 'e-mail field');

    await page.keyboard.type(student.email);

    // Tab reaches the next field in the form (an extra helper stop is tolerated).
    expect(await tabTo(page, password, { label: 'password field' })).toBeLessThanOrEqual(2);
    await expect(password).toBeFocused();
    await expectVisibleFocus(page, 'password field');
    await page.keyboard.type(student.password);

    // Shift+Tab walks back to the e-mail field and forward again to the password.
    expect(
      await tabTo(page, email, { backwards: true, label: 'e-mail field (backwards)' }),
    ).toBeLessThanOrEqual(2);
    await expect(email).toBeFocused();
    expect(
      await tabTo(page, password, { label: 'password field (forward again)' }),
    ).toBeLessThanOrEqual(2);
    await expect(password).toBeFocused();
    await expectVisibleFocus(page, 'password field (again)');

    // The submit button is reachable from the last field, and Enter submits the form.
    expect(await tabTo(page, submit, { label: 'submit button' })).toBeLessThanOrEqual(2);
    await expect(submit).toBeFocused();
    await expectVisibleFocus(page, 'submit button');
    await tabTo(page, password, { backwards: true, label: 'password field before submitting' });

    const [login] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login')),
      page.keyboard.press('Enter'),
    ]);
    expect(login.status(), 'Enter in the password field submits the login form').toBe(200);
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  });

  test('the registration form is keyboard operable: field order, Space opens the account-type list, Esc closes it and Enter submits', async ({
    page,
  }) => {
    await page.goto('/register');

    const name = page.locator('input#name');
    const email = page.locator('input#email');
    const password = page.locator('input#password');
    const accountType = page.locator('button[data-slot="select-trigger"]');
    const options = page.getByRole('option');

    await expect(name).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await expectVisibleFocus(page, 'name field');

    expect(await tabTo(page, email, { label: 'e-mail field' })).toBeLessThanOrEqual(2);
    expect(await tabTo(page, accountType, { label: 'account type' })).toBeLessThanOrEqual(2);
    await expect(accountType).toBeFocused();
    await expectVisibleFocus(page, 'account type');

    // Space opens the listbox and moves focus onto the selected/first option.
    await page.keyboard.press('Space');
    await expect(accountType).toHaveAttribute('aria-expanded', 'true');
    await expect(options).toHaveCount(3);
    await expect(options.first()).toBeFocused();

    // Esc closes it without a selection and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(accountType).toHaveAttribute('aria-expanded', 'false');
    await expect(options).toHaveCount(0);
    await expect(accountType).toBeFocused();
    await expectVisibleFocus(page, 'account type after Esc');

    // Space again, ArrowDown + Enter picks the second account type.
    await page.keyboard.press('Space');
    await expect(accountType).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(accountType).toHaveAttribute('aria-expanded', 'false');
    await expect(accountType).toBeFocused();
    // The native select rendered by Radix mirrors the form value: „educator”.
    await expect(page.locator('select')).toHaveValue('educator');

    // Tab reaches the password field; Enter submits the form.
    expect(await tabTo(page, password, { label: 'password field' })).toBeLessThanOrEqual(2);
    await expect(password).toBeFocused();
    await expectVisibleFocus(page, 'password field');

    await page.keyboard.press('Enter');
    const messages = page.locator('[data-slot="form-message"]');
    await expect(messages).toHaveCount(3);
    for (const message of await messages.all()) {
      await expect(message).toBeVisible();
    }
    // Nothing was registered: the empty required fields kept the user on the form.
    await expect(page).toHaveURL(/\/register$/);
  });

  test('a dialog opened from the keyboard traps focus, closes on Esc and returns focus to its trigger', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await page.goto(FLASHCARDS_PATH);

    const trigger = page.getByRole('button', { name: 'Nowa talia' }).first();
    await expect(trigger).toBeVisible();

    // The toolbar trigger is a plain button (no Radix DialogTrigger): focus it and open
    // the dialog the way a keyboard user does.
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    const close = dialog.locator('[data-slot="dialog-close"]');
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
      'focus moved into the dialog',
    ).toBe(true);

    // Focus is trapped inside: Shift+Tab from the first stop wraps to the close button.
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await expectVisibleFocus(page, 'dialog close button');
    await page.keyboard.press('Tab');
    await expect(dialog.locator('input')).toBeFocused();

    // Esc closes the dialog and focus returns to the element that opened it.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectVisibleFocus(page, 'dialog trigger after Esc');
  });
});
