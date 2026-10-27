import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const heading = t('LoginPage.header');
const emailLabel = t('LoginPage.email_label');
const passwordLabel = t('LoginPage.password_label');
const submitButton = t('LoginPage.login_button');

const errEmailRequired = t('Errors.ERROR_EMAIL_REQUIRED');
const errEmailInvalid = t('Errors.ERROR_EMAIL_INVALID');
const errPassRequired = t('Errors.ERROR_PASSWORD_REQUIRED');
const errInvalidCreds = t('Errors.ERROR_INVALID_CREDENTIALS');

// ---------------------------------------------------------------------------
// Seeded test accounts (supabase/seed.sql) — password is the same for all
// ---------------------------------------------------------------------------
const PASSWORD = 'pass';

const USERS = [
  {
    role: 'manager',
    email: 'manager@dev.local',
    redirectUrl: /\/manage/,
  },
  {
    role: 'educator',
    email: 'teacher1@dev.local',
    redirectUrl: /\/edu/,
  },
  {
    role: 'student',
    email: 'student1@dev.local',
    redirectUrl: /\/app/,
  },
] as const;

// ---------------------------------------------------------------------------

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(heading).first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // POSITIVE – each seeded role logs in and lands on the correct route
  // -------------------------------------------------------------------------

  for (const user of USERS) {
    test(`Positive [${user.role}]: successful login redirects to correct page`, async ({
      page,
    }) => {
      const emailInput = page.getByLabel(emailLabel);
      await emailInput.click();
      await emailInput.fill(user.email);
      await expect(emailInput).toHaveValue(user.email);
      await page.getByLabel(passwordLabel).fill(PASSWORD);
      await page.getByRole('button', { name: submitButton }).click();

      await expect(page).toHaveURL(user.redirectUrl);

      // Login page heading must be gone — confirms we left the login page.
      // We intentionally don't check for email labels on the destination page
      // since those may legitimately exist there (e.g. admin invite forms).
      await expect(page.getByText(heading).first()).not.toBeVisible();
    });
  }

  // -------------------------------------------------------------------------
  // NEGATIVE – empty form
  // -------------------------------------------------------------------------

  test('Negative: empty form submission shows all required-field errors', async ({ page }) => {
    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errEmailRequired)).toBeVisible();
    await expect(page.getByText(errPassRequired)).toBeVisible();

    await expect(page.getByText(heading).first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – malformed email
  // -------------------------------------------------------------------------

  test('Negative: malformed email shows invalid-email error', async ({ page }) => {
    const emailInput = page.getByLabel(emailLabel);
    await emailInput.click();
    await emailInput.fill('not-an-email');
    await expect(emailInput).toHaveValue('not-an-email');
    await page.getByLabel(passwordLabel).fill(PASSWORD);
    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errEmailInvalid)).toBeVisible();
    await expect(page.getByText(errPassRequired)).not.toBeVisible();

    await expect(page.getByText(heading).first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – wrong password
  // -------------------------------------------------------------------------

  test('Negative: correct email with wrong password shows invalid-credentials error', async ({
    page,
  }) => {
    const emailInput = page.getByLabel(emailLabel);
    await emailInput.click();
    await emailInput.fill('teacher1@dev.local');
    await expect(emailInput).toHaveValue('teacher1@dev.local');
    await page.getByLabel(passwordLabel).fill('WrongPassword1');
    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errInvalidCreds)).toBeVisible();

    await expect(page.getByText(heading).first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – non-existent account
  // -------------------------------------------------------------------------

  test('Negative: unknown email shows invalid-credentials error', async ({ page }) => {
    const emailInput = page.getByLabel(emailLabel);
    await emailInput.click();
    await emailInput.fill('ghost@dev.local');
    await expect(emailInput).toHaveValue('ghost@dev.local');
    await page.getByLabel(passwordLabel).fill(PASSWORD);
    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errInvalidCreds)).toBeVisible();

    await expect(page.getByText(heading).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// #458 — deep-link login
//
// No shared `beforeEach`: the listeners below must be armed before the very
// first page load so the pre-auth phase is observed too.
// ---------------------------------------------------------------------------

/** Student with a classroom org, so `useOrgs` auto-selects after login. */
const DEEP_LINK_EMAIL = 'student-classroom@dev.local';
const DEEP_LINK_PATH = '/app/study/quiz';

test.describe('Login deep link (#458)', () => {
  test('lands on ?next= with the quiz gate enabled and no stale 401', async ({ page, context }) => {
    test.setTimeout(120_000);

    // Every user-scoped fetch that used to 401 pre-auth and poison the cache.
    const userScoped: { path: string; status: number }[] = [];
    const USER_SCOPED_PATHS = ['/api/v1/features/me', '/api/v1/me/orgs', '/api/v1/permissions/me'];
    page.on('response', (res) => {
      const pathname = new URL(res.url()).pathname;
      if (USER_SCOPED_PATHS.includes(pathname)) {
        userScoped.push({ path: pathname, status: res.status() });
      }
    });

    // Arm before submitting: the dashboard's `useOrgs` auto-select fires as soon
    // as `/auth/me` resolves. Defensive: if `/auth/login` ever starts setting
    // `active_org_id` the switch never happens, and this must not hang for 60 s
    // — the URL assertion below is the real guard.
    const orgSwitch = page
      .waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          new URL(res.url()).pathname === '/api/v1/me/orgs/switch',
        { timeout: 15_000 },
      )
      .catch(() => null);

    await page.goto(`/login?next=${DEEP_LINK_PATH}`);
    await expect(page.getByText(heading).first()).toBeVisible();

    await page.getByLabel(emailLabel).click();
    await page.getByLabel(emailLabel).fill(DEEP_LINK_EMAIL);
    await expect(page.getByLabel(emailLabel)).toHaveValue(DEEP_LINK_EMAIL);
    await page.getByLabel(passwordLabel).fill(PASSWORD);
    await page.getByRole('button', { name: submitButton }).click();

    await page.waitForURL(new RegExp(`${DEEP_LINK_PATH}$`), { timeout: 30_000 });

    // `/auth/login` does not set `active_org_id`; the auto-select must settle
    // WITHOUT pushing `/app` over the deep link (that bounce was #458's cause 1b).
    const switchResponse = await orgSwitch;
    if (switchResponse) expect(switchResponse.status()).toBe(200);
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === 'active_org_id'), {
        timeout: 5_000,
      })
      .toBe(true);

    // Give a late `onSuccess` bounce time to land, then re-assert: it would
    // send us to `/app`.
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(new RegExp(`${DEEP_LINK_PATH}$`));

    // Acceptance bullet 2: the feature state was fetched with a session — no
    // pre-auth 401 survived the login (acceptance bullet 1 is the gate below).
    expect(userScoped.filter((r) => r.status === 401)).toEqual([]);
    expect(
      userScoped.filter((r) => r.path === '/api/v1/features/me' && r.status === 200),
    ).not.toEqual([]);

    // Acceptance bullet 1: the gate is on without a manual reload.
    const openOnly = page.locator('#quiz-type-open');
    await expect(openOnly).toBeVisible();
    await openOnly.click();
    await expect(openOnly).toHaveAttribute('aria-checked', 'true');

    const generate = page.getByRole('button', { name: t('AppFlashcardStudyPage.generate_quiz') });
    await expect(generate).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /^Upgrade$/ })).toHaveCount(0);

    // Re-opening the login deep link as a signed-in user keeps the target
    // (the proxy used to drop `?next=` and send the user to `/app`).
    await page.goto(`/login?next=${DEEP_LINK_PATH}`);
    await expect(page).toHaveURL(new RegExp(`${DEEP_LINK_PATH}$`));
    await expect(page.locator('#quiz-type-open')).toBeVisible();
  });
});
