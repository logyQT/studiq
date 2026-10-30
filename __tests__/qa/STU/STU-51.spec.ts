import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-51 — changing the password on the student account page (`/app/account`).
 *
 * Case: in the „Zmień hasło” card enter the current password, a new one and a
 * different confirmation; fix the confirmation; then try a wrong current
 * password; finally log out, log in with the new password and restore the old one.
 *
 * Tenant (deterministic, `bare` profile with a student role, fresh run suffix per
 * independent run):
 *
 *   bun scripts/qa-tenant.ts STU-51 --fresh
 *
 * gives one student with no organization and no group — the equivalent of the
 * case's „Konto TS” — whose ids derive from
 * `tenantKey('qa/cases/STU-51.md', 'STU-51#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`. The legacy `test-student@dev.local` / `pass` account is
 * never used, and nothing global (admin setting, feature flag, plan, platform stat,
 * singleton row) is read or written.
 *
 * The case's literal „Nowe1234” is derived from the tenant key
 * (`Nowe1234<shortHash>`) so a repeat run never hits Supabase `same_password`
 * (422) while the mismatched confirmation stays different. The account page is
 * account-scoped, so the run needs no org, group or content.
 *
 * CI seeds a tenant once and Playwright retries reuse it. Two guards keep the
 * password state deterministic for a retry/`--repeat-each` pass:
 * 1. the walk ends by restoring the tenant's seeded password (`Seed4Test!`, which
 *    satisfies the product's rules) through the same card — this is the automated
 *    equivalent of the case's „PRZYWRÓĆ «pass»”;
 * 2. before the walk the spec normalises the account to the seeded password: if a
 *    crashed attempt left the deterministic run password behind, it logs in with
 *    that one and changes it back. Only this case's own tenant is touched.
 *
 * Acceptance points (walked on the shared app :3010, Polish UI, 2026-10-29):
 * 1. Mismatched confirmation → toast „Hasła nie są zgodne” and no request at all
 *    to `POST /api/v1/auth/password/update` (the check is client-side).
 * 2. Correct confirmation → 200 + toast „Hasło zaktualizowane pomyślnie”, fields
 *    cleared.
 * 3. Wrong current password → 400 `INVALID_CURRENT_PASSWORD` + toast „Obecne hasło
 *    jest nieprawidłowe.”; the password is not changed.
 * 4. A new password that breaks the rules → 422 whose `issues.properties.password`
 *    carries the short/missing-uppercase/missing-digit codes, surfaced as one toast
 *    listing the three rules; still no change.
 * 5. Log out, log in with the new password → `/app`; the old password is rejected
 *    with 401 `UNAUTHORIZED`.
 *
 * Polish copy is asserted because the case quotes the Polish UI; `NEXT_LOCALE=pl`
 * is pinned by `loginAs` so a locale cookie from another case cannot change it.
 */

const CASE = 'STU-51';

/** Tenant-seed default password — the automated equivalent of the case's „pass”. */
const SEEDED_PASSWORD = 'Seed4Test!';

const LOGIN_PATH = '/api/v1/auth/login';
const LOGOUT_PATH = '/api/v1/auth/logout';
const UPDATE_PASSWORD_PATH = '/api/v1/auth/password/update';

/** Polish copy from `AccountPage` / `LoginPage` (pl.json), as confirmed in the walk. */
const COPY = {
  title: 'Konto',
  subtitle: 'Zarządzaj ustawieniami konta',
  passwordSection: 'Zmień hasło',
  currentLabel: 'Obecne hasło',
  newLabel: 'Nowe hasło',
  confirmLabel: 'Potwierdź hasło',
  requirements: 'Hasło musi mieć co najmniej 8 znaków, zawierać wielką literę i cyfrę.',
  updateButton: 'Zaktualizuj hasło',
  mismatch: 'Hasła nie są zgodne',
  updated: 'Hasło zaktualizowane pomyślnie',
  invalidCurrent: 'Obecne hasło jest nieprawidłowe.',
  tooShort: 'Hasło musi mieć co najmniej 8 znaków.',
  missingUppercase: 'Hasło musi zawierać co najmniej jedną wielką literę.',
  missingNumber: 'Hasło musi zawierać co najmniej jedną cyfrę.',
  loginTitle: 'Witaj ponownie',
  loginButton: 'Zaloguj się',
} as const;

/** The weak password of the rules step; it breaks all three rules at once. */
const WEAK_PASSWORD = 'slabe';

/** A password the account does not have — the wrong-current attempt. */
const WRONG_CURRENT_PASSWORD = 'ZleHaslo123';

/** The new-password field of that attempt; it must differ from the client's
 * same-password guard would otherwise block the request before it reaches the API. */
const OTHER_PASSWORD = 'Zmiana1234';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  issues?: { errors: unknown[]; properties?: Record<string, { errors: string[] }> };
}

function studentOf(tenant: QaTenant): NonNullable<QaTenant['users']['student']> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} needs the bare tenant profile (student account)`);
  return student;
}

/** The newest sonner toast carrying this text. */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).last();
}

const isPasswordUpdate = (response: Response) =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === UPDATE_PASSWORD_PATH;

/** Fill the „Zmień hasło” card. */
async function fillPasswordChange(
  page: Page,
  current: string,
  next: string,
  confirm: string,
): Promise<void> {
  await page.locator('#currentPassword').fill(current);
  await page.locator('#newPassword').fill(next);
  await page.locator('#confirmPassword').fill(confirm);
  await expect(
    page.getByRole('button', { name: COPY.updateButton, exact: true }),
    '„Zaktualizuj hasło” is enabled once all three fields are filled',
  ).toBeEnabled();
}

/**
 * Press „Zaktualizuj hasło” and return the promise of the update request — the
 * listener is armed before the click so a fast answer cannot be missed.
 */
function clickUpdate(page: Page): Promise<Response> {
  const pending = page.waitForResponse(isPasswordUpdate);
  const clicked = page.getByRole('button', { name: COPY.updateButton, exact: true }).click();
  return clicked.then(() => pending);
}

/**
 * Retry safety. CI seeds the case tenant once and retries reuse it: if an earlier
 * attempt died after the successful change but before the restore, the seeded
 * password no longer works and the deterministic run password does. Bring the
 * account back to the seeded password and leave no session behind.
 */
async function normalisePassword(page: Page, tenant: QaTenant, newPassword: string): Promise<void> {
  const { email } = studentOf(tenant);

  await page.request.post(LOGOUT_PATH);

  const seeded = await page.request.post(LOGIN_PATH, {
    data: { email, password: SEEDED_PASSWORD },
  });
  if (seeded.ok()) {
    await page.request.post(LOGOUT_PATH);
    return;
  }
  expect(seeded.status(), 'the seeded password is rejected only after a changed run').toBe(401);

  const changed = await page.request.post(LOGIN_PATH, {
    data: { email, password: newPassword },
  });
  expect(
    changed.ok(),
    `the account is reachable with the seeded or the deterministic run password (${changed.status()})`,
  ).toBe(true);

  const restored = await page.request.post(UPDATE_PASSWORD_PATH, {
    data: {
      currentPassword: newPassword,
      password: SEEDED_PASSWORD,
      confirmPassword: SEEDED_PASSWORD,
    },
  });
  expect(restored.status(), 'restore the seeded password').toBe(200);

  await page.request.post(LOGOUT_PATH);
}

/**
 * Last-resort restore after a failed assertion — best effort, never masking the
 * original failure. The next run's `normalisePassword` repairs whatever is left.
 */
async function restoreSeedPassword(
  page: Page,
  tenant: QaTenant,
  newPassword: string,
): Promise<void> {
  const { email } = studentOf(tenant);

  try {
    await page.request.post(LOGOUT_PATH);
    const seeded = await page.request.post(LOGIN_PATH, {
      data: { email, password: SEEDED_PASSWORD },
    });
    if (seeded.ok()) {
      await page.request.post(LOGOUT_PATH);
      return;
    }
    const changed = await page.request.post(LOGIN_PATH, {
      data: { email, password: newPassword },
    });
    if (!changed.ok()) return;
    await page.request.post(UPDATE_PASSWORD_PATH, {
      data: {
        currentPassword: newPassword,
        password: SEEDED_PASSWORD,
        confirmPassword: SEEDED_PASSWORD,
      },
    });
    await page.request.post(LOGOUT_PATH);
  } catch {
    // Nothing to add: the run already failed and the next normalisation restores it.
  }
}

test.describe('@case:STU-51 @area:STU @prio:P2 account password change', () => {
  test('rejects a mismatch, changes the password, rejects a wrong current one and logs in with the new one', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student account`).toBe('student');
    expect(tenant.org, 'the bare tenant owns no organization').toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new account',
    ).toBeTruthy();

    const student = studentOf(tenant);
    expect(student.password, 'the seeded password under test').toBe(SEEDED_PASSWORD);

    const suffix = shortHash(tenant.key).slice(0, 4);
    const newPassword = `Nowe1234${suffix}`;
    const mismatch = `Inne1234${suffix}`;

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // Every response of the update endpoint, so a client-side rejection can be
    // proven not to have reached the server.
    const updateStatuses: number[] = [];
    page.on('response', (response) => {
      if (isPasswordUpdate(response)) updateStatuses.push(response.status());
    });

    let restored = false;
    try {
      // ── Prerequisite: the tenant account on its seeded password ───────────
      await normalisePassword(page, tenant, newPassword);
      await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
      await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

      // ── Step 0: open the account page and its password card ──────────────
      const response = await page.goto('/app/account');
      expect(response?.status(), 'GET /app/account').toBe(200);
      await expect(page).toHaveURL(/\/app\/account$/);
      await expect(page.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();
      await expect(page.getByText(COPY.subtitle, { exact: true })).toBeVisible();

      const card = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByText(COPY.passwordSection, { exact: true }) });
      await expect(card, 'the „Zmień hasło” card').toHaveCount(1);
      for (const label of [COPY.currentLabel, COPY.newLabel, COPY.confirmLabel]) {
        await expect(card.getByText(label, { exact: true }), `the „${label}” label`).toBeVisible();
      }
      await expect(card.getByText(COPY.requirements, { exact: true })).toBeVisible();
      await expect(page.locator('#currentPassword')).toHaveAttribute('type', 'password');
      await expect(page.locator('#newPassword')).toHaveAttribute('type', 'password');
      await expect(page.locator('#confirmPassword')).toHaveAttribute('type', 'password');

      // ── Step 1: current + new „Nowe1234” + a different confirmation ──────
      await fillPasswordChange(page, SEEDED_PASSWORD, newPassword, mismatch);
      await page.getByRole('button', { name: COPY.updateButton, exact: true }).click();

      // Expected result: „Hasła nie są zgodne”, and nothing is sent or changed.
      await expect(toast(page, COPY.mismatch), 'the „Hasła nie są zgodne” toast').toBeVisible();
      await expect(page).toHaveURL(/\/app\/account$/);
      expect(
        updateStatuses,
        'a mismatched confirmation must not reach POST /api/v1/auth/password/update',
      ).toEqual([]);
      await expect(
        page.getByText(COPY.updated, { exact: true }),
        'no success message for a mismatched confirmation',
      ).toHaveCount(0);

      // ── Step 2: fix the confirmation and save ────────────────────────────
      await page.locator('#confirmPassword').fill(newPassword);
      const updated = toast(page, COPY.updated);
      const saved = await clickUpdate(page);

      // Start the toast wait before the request settles: sonner keeps it for 4 s
      // and the shared box answers in a couple of seconds.
      await expect(updated, 'the „Hasło zaktualizowane pomyślnie” toast').toBeVisible({
        timeout: 30_000,
      });
      expect(saved.status(), `POST ${UPDATE_PASSWORD_PATH}`).toBe(200);
      expect(saved.headers()['x-error-code'], 'no error code on success').toBeUndefined();
      expect(await saved.json()).toMatchObject({ success: true });

      // The card clears all three fields after a successful change.
      for (const id of ['#currentPassword', '#newPassword', '#confirmPassword']) {
        await expect(page.locator(id), `${id} is cleared`).toHaveValue('');
      }
      expect(updateStatuses, 'exactly one update request so far').toEqual([200]);

      // ── Step 3: a wrong current password is rejected ──────────────────────
      await fillPasswordChange(page, WRONG_CURRENT_PASSWORD, OTHER_PASSWORD, OTHER_PASSWORD);
      const invalid = await clickUpdate(page);

      expect(invalid.status(), 'a wrong current password is refused').toBe(400);
      expect(invalid.headers()['x-error-code'], 'the API names the rejected check').toBe(
        'INVALID_CURRENT_PASSWORD',
      );
      expect(((await invalid.json()) as ApiEnvelope<never>).error).toBe('INVALID_CURRENT_PASSWORD');
      // Expected result: a message (the case asks to note its copy).
      await expect(
        toast(page, COPY.invalidCurrent),
        'the „Obecne hasło jest nieprawidłowe.” toast',
      ).toBeVisible();

      // ── Expected result: the new password must meet the rules ─────────────
      await fillPasswordChange(page, newPassword, WEAK_PASSWORD, WEAK_PASSWORD);
      const weak = await clickUpdate(page);

      expect(weak.status(), 'a weak new password is refused').toBe(422);
      const weakBody = (await weak.json()) as ApiEnvelope<never>;
      expect(weakBody.error).toBe('UNPROCESSABLE_ENTITY');
      expect(weakBody.issues?.properties?.password?.errors, 'the violated password rules').toEqual([
        'VALIDATION_PASSWORD_TOO_SHORT',
        'VALIDATION_PASSWORD_MISSING_UPPERCASE',
        'VALIDATION_PASSWORD_MISSING_NUMBER',
      ]);
      const rulesToast = toast(page, COPY.tooShort);
      await expect(rulesToast, 'the rules toast lists the violated rules').toBeVisible();
      await expect(rulesToast).toContainText(COPY.missingUppercase);
      await expect(rulesToast).toContainText(COPY.missingNumber);

      // ── Step 4: log out, then log in with the new password ────────────────
      const logout = await page.request.post(LOGOUT_PATH);
      expect(logout.status(), 'POST /api/v1/auth/logout').toBe(200);
      const anon = await page.request.get('/api/v1/auth/me');
      expect(anon.status(), 'GET /api/v1/auth/me after logout').toBe(200);
      expect(
        ((await anon.json()) as { data: { user: unknown } }).data.user,
        'no authenticated user after logout',
      ).toBeNull();

      await page.goto('/login');
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText(COPY.loginTitle, { exact: true })).toBeVisible();
      await page.locator('input[name=email]').fill(student.email);
      await page.locator('input[name=password]').fill(newPassword);
      const loginResponse = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          new URL(candidate.url()).pathname === LOGIN_PATH,
      );
      await page
        .locator('form')
        .getByRole('button', { name: COPY.loginButton, exact: true })
        .click();
      const signedIn = await loginResponse;
      expect(signedIn.status(), 'log in with the new password').toBe(200);
      await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Cześć');

      // The old password is gone (the case's „PRZYWRÓĆ «pass»” note is about the
      // manual seed account; this tenant is the run's own).
      const oldLogin = await page.request.post(LOGIN_PATH, {
        data: { email: student.email, password: SEEDED_PASSWORD },
      });
      expect(oldLogin.status(), 'the previous password is rejected').toBe(401);
      expect(oldLogin.headers()['x-error-code']).toBe('UNAUTHORIZED');

      // ── Restore the tenant's seeded password (retry safety) ───────────────
      await page.goto('/app/account');
      await expect(page).toHaveURL(/\/app\/account$/);
      await fillPasswordChange(page, newPassword, SEEDED_PASSWORD, SEEDED_PASSWORD);
      const restoredToast = toast(page, COPY.updated);
      const restoredResponse = await clickUpdate(page);
      await expect(restoredToast, 'the restore reports success').toBeVisible({
        timeout: 30_000,
      });
      expect(restoredResponse.status(), 'restore the seeded password').toBe(200);
      restored = true;

      expect(pageErrors, 'the account walk raises no uncaught errors').toEqual([]);
    } finally {
      if (!restored) await restoreSeedPassword(page, tenant, newPassword);
    }
  });
});
