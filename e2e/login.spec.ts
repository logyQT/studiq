import { test, expect } from '@playwright/test';
import { t } from './utils';

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
    role: 'sys_admin',
    email: 'admin@dev.local',
    redirectUrl: /\/admin/,
  },
  {
    role: 'university_admin',
    email: 'uadmin@dev.local',
    redirectUrl: /\/manage/,
  },
  {
    role: 'teacher',
    email: 'teacher@dev.local',
    redirectUrl: /\/edu/,
  },
  {
    role: 'student',
    email: 'student@dev.local',
    redirectUrl: /\/app/,
  },
  {
    role: 'premium',
    email: 'premium@dev.local',
    redirectUrl: /\/app/,
  },
  {
    role: 'free',
    email: 'user@dev.local',
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
    await emailInput.fill('admin@dev.local');
    await expect(emailInput).toHaveValue('admin@dev.local');
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
