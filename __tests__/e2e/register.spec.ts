import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const heading = t('RegisterPage.header');
const nameLabel = t('RegisterPage.name_label');
const emailLabel = t('RegisterPage.email_label');
const passwordLabel = t('RegisterPage.password_label');
const submitButton = t('RegisterPage.register_button');

const successHeading = t('RegisterPage.success_header');
const successDesc = t('RegisterPage.success_description');
const activationHint = t('RegisterPage.activation_instructions');

const errNameRequired = t('Errors.ERROR_NAME_REQUIRED');
const errEmailRequired = t('Errors.ERROR_EMAIL_REQUIRED');
const errEmailInvalid = t('Errors.ERROR_EMAIL_INVALID');
const errPassRequired = t('Errors.ERROR_PASSWORD_REQUIRED');
const errPassShort = t('Errors.ERROR_PASSWORD_TOO_SHORT');
const errPassUppercase = t('Errors.ERROR_PASSWORD_MISSING_UPPERCASE');
const errPassNumber = t('Errors.ERROR_PASSWORD_MISSING_NUMBER');
const errNameInvalid = t('Errors.ERROR_NAME_INVALID_FORMAT');

test.describe('Registration Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText(heading).first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // POSITIVE
  // -------------------------------------------------------------------------

  test('Positive: valid submission shows activation-email confirmation', async ({ page }) => {
    const uniqueEmail = `testuser_${Date.now()}@example.com`;

    const nameInput = page.getByLabel(nameLabel);
    await nameInput.click();
    await nameInput.fill('Jan Kowalski');
    await expect(nameInput).toHaveValue('Jan Kowalski');
    await page.getByLabel(emailLabel).fill(uniqueEmail);
    await page.getByLabel(passwordLabel).fill('StrongPassword1');

    await page.getByRole('button', { name: submitButton }).click();

    // The card flips to a success state – URL stays on /register
    await expect(page.getByText(successHeading)).toBeVisible();
    await expect(page.getByText(successDesc)).toBeVisible();
    await expect(page.getByText(activationHint)).toBeVisible();

    // Registration form inputs must no longer be visible
    await expect(page.getByLabel(nameLabel)).not.toBeVisible();
  });

  // #300 / AUT-05: a duplicate address is answered with the same neutral 202 as
  // a fresh registration — no 500, no account-enumeration signal, no error toast.
  test('Positive: existing e-mail shows the neutral activation message, not an error', async ({
    page,
  }) => {
    const nameInput = page.getByLabel(nameLabel);
    await nameInput.click();
    await nameInput.fill('Jan Testowy');
    await expect(nameInput).toHaveValue('Jan Testowy');
    await page.getByLabel(emailLabel).fill('student1@dev.local');
    await page.getByLabel(passwordLabel).fill('Passw0rd123!');

    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(successHeading)).toBeVisible();
    await expect(page.getByText(activationHint)).toBeVisible();
    await expect(page.getByText(/INTERNAL_SERVER/)).toHaveCount(0);
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – empty submission
  // -------------------------------------------------------------------------

  test('Negative: empty form submission shows all required-field errors', async ({ page }) => {
    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errNameRequired)).toBeVisible();
    await expect(page.getByText(errEmailRequired)).toBeVisible();
    await expect(page.getByText(errPassRequired)).toBeVisible();

    // Page must not navigate away
    await expect(page).toHaveURL(/\/register/);
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – invalid e-mail format
  // -------------------------------------------------------------------------

  test('Negative: malformed email shows invalid-email error', async ({ page }) => {
    const nameInput = page.getByLabel(nameLabel);
    await nameInput.click();
    await nameInput.fill('Jan Kowalski');
    await expect(nameInput).toHaveValue('Jan Kowalski');
    await page.getByLabel(emailLabel).fill('not-an-email');
    await page.getByLabel(passwordLabel).fill('StrongPassword1');

    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errNameRequired)).not.toBeVisible();
    await expect(page.getByText(errEmailInvalid)).toBeVisible();
    await expect(page.getByText(errPassRequired)).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – password too short
  // -------------------------------------------------------------------------

  test('Negative: password shorter than 8 characters shows length error', async ({ page }) => {
    const nameInput = page.getByLabel(nameLabel);
    await nameInput.click();
    await nameInput.fill('Jan Kowalski');
    await expect(nameInput).toHaveValue('Jan Kowalski');
    await page.getByLabel(emailLabel).fill('test@example.com');
    await page.getByLabel(passwordLabel).fill('Ab1');

    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errPassShort)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – password missing uppercase letter
  // -------------------------------------------------------------------------

  test('Negative: password without uppercase shows missing-uppercase error', async ({ page }) => {
    const nameInput = page.getByLabel(nameLabel);
    await nameInput.click();
    await nameInput.fill('Jan Kowalski');
    await expect(nameInput).toHaveValue('Jan Kowalski');
    await page.getByLabel(emailLabel).fill('test@example.com');
    await page.getByLabel(passwordLabel).fill('nouppercase1');

    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errPassUppercase)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – password missing a digit
  // -------------------------------------------------------------------------

  test('Negative: password without a digit shows missing-number error', async ({ page }) => {
    const nameInput = page.getByLabel(nameLabel);
    await nameInput.click();
    await nameInput.fill('Jan Kowalski');
    await expect(nameInput).toHaveValue('Jan Kowalski');
    await page.getByLabel(emailLabel).fill('test@example.com');
    await page.getByLabel(passwordLabel).fill('NoDigitPassword');

    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errPassNumber)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – invalid characters in name
  // -------------------------------------------------------------------------

  test('Negative: name with invalid characters shows format error', async ({ page }) => {
    const nameInput = page.getByLabel(nameLabel);
    await nameInput.click();
    await nameInput.fill('J4n K0w4lski!!');
    await expect(nameInput).toHaveValue('J4n K0w4lski!!');
    await page.getByLabel(emailLabel).fill('test@example.com');
    await page.getByLabel(passwordLabel).fill('StrongPassword1');

    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errNameInvalid)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // NEGATIVE – whitespace-only name (#303 / AUT-04)
  // -------------------------------------------------------------------------

  // The shared `NameSchema` is the form resolver, so a blank-looking name must
  // fail client-side and never reach the API.
  test('Negative: whitespace-only name is blocked and sends no request', async ({ page }) => {
    let registerCalls = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/v1/auth/register'))
        registerCalls += 1;
    });

    const nameInput = page.getByLabel(nameLabel);
    await nameInput.click();
    await nameInput.fill('   ');
    await expect(nameInput).toHaveValue('   ');
    await page.getByLabel(emailLabel).fill('ws@example.com');
    await page.getByLabel(passwordLabel).fill('StrongPassword1');

    await page.getByRole('button', { name: submitButton }).click();

    await expect(page.getByText(errNameRequired)).toBeVisible();
    await expect(page).toHaveURL(/\/register/);
    expect(registerCalls).toBe(0);
  });
});
