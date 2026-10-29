import { expect, test, type Page } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-03 — Walidacja hasła – reguły (rejestracja, brak sesji).
 *
 * The case's prerequisite is "Brak sesji": `/register` is public, so every test
 * starts in a fresh browser context with no session. The case tenant
 * (`tenantKey('qa/cases/AUT-03.md', 'AUT-03', 'qa-shared')`, seeded with
 * `bun scripts/qa-tenant.ts AUT-03`) is bookkeeping only — the spec consumes no
 * seeded user, org or content id. It only uses the tenant key to derive a
 * deterministic, run-unique e-mail for the form, so the registration attempt of
 * one run can never collide with another run or another worker.
 *
 * Each invalid password is rejected client-side by `RegisterSchema`
 * (`packages/server/src/models/auth.model.ts`) before any network call, and the
 * message is rendered under the password field by `FormMessage`. A valid boundary
 * password (8 and 128 characters) must pass validation — those two tests
 * intercept `POST /api/v1/auth/register`, so the boundary is proven without
 * creating an account or mutating any tenant row.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the spec pins
 * `NEXT_LOCALE=pl`, so a locale left behind by another visitor cannot change the
 * strings under test. Nothing global or singleton is read or written.
 */

const CASE = 'AUT-03';

const COPY = {
  header: 'Utwórz konto',
  submit: 'Zarejestruj się',
  successHeader: 'Konto zostało utworzone',
  tooShort: 'Hasło musi mieć co najmniej 8 znaków.',
  tooLong: 'Hasło nie może przekraczać 128 znaków.',
  missingUppercase: 'Hasło musi zawierać co najmniej jedną wielką literę.',
  missingNumber: 'Hasło musi zawierać co najmniej jedną cyfrę.',
} as const;

/** Step 1 of the case: 129 characters ("Aa1…") — one over the 128 limit. */
const OVER_MAX_LENGTH = 'Aa1'.repeat(43);
/** The allowed maximum: 128 characters, uppercase and digit included. */
const MAX_LENGTH_VALID = `${'Aa1'.repeat(42)}Z9`;
/** The allowed minimum: 8 characters, uppercase and digit included. */
const MIN_LENGTH_VALID = 'Abcdefg1';

const INVALID_PASSWORDS = [
  { password: 'abc', expected: COPY.tooShort },
  // The case accepts "and/or": zodResolver reports the first failing rule, so the
  // missing-uppercase message is the one the user sees.
  { password: 'abcdefgh', expected: COPY.missingUppercase },
  { password: 'Abcdefgh', expected: COPY.missingNumber },
  { password: 'abcdefg1', expected: COPY.missingUppercase },
  { password: OVER_MAX_LENGTH, expected: COPY.tooLong },
] as const;

/** Deterministic per-run address; never an existing tenant user. */
function registrationEmail(): string {
  const tenant = loadTenant(CASE);
  return `qa+${shortHash(tenant.key)}+register@test.local`;
}

/** Open the public form in Polish with no session, as the case's prerequisite requires. */
async function openRegister(page: Page): Promise<void> {
  const host = new URL(test.info().project.use.baseURL ?? 'http://localhost:3010').hostname;
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: host, path: '/' }]);
  await page.goto('/register');
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.header);
}

/** Step 1: correct name, e-mail and account type (student). */
async function fillIdentity(page: Page): Promise<void> {
  await page.locator('#name').fill('Jan Kowalski');
  await page.locator('#email').fill(registrationEmail());
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: /Uczniem/ }).click();
  await expect(page.getByRole('combobox')).toContainText('Uczniem');
}

/** The validation message that belongs to the password field (not a toast). */
function passwordMessage(page: Page) {
  return page
    .locator('[data-slot="form-item"]')
    .filter({ has: page.locator('#password') })
    .locator('[data-slot="form-message"]');
}

test('rejects every password that breaks a rule and never calls the register API', async ({
  page,
}) => {
  await openRegister(page);
  await fillIdentity(page);

  // Any request would mean the client accepted the password and tried to register.
  const registerRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/auth/register')) registerRequests.push(request.url());
  });

  // Step 2: click "Zarejestruj się" after each password and read the message.
  for (const { password, expected } of INVALID_PASSWORDS) {
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: COPY.submit }).click();

    await expect(
      passwordMessage(page),
      `password of length ${password.length} reports its failing rule`,
    ).toHaveText(expected);

    // Rejection happens in the form: the URL stays and no account is attempted.
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.header);
    expect(
      registerRequests,
      `no registration request for an invalid password (${password.length} chars)`,
    ).toEqual([]);
  }
});

test('accepts the 8-character minimum when it has an uppercase letter and a digit', async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route('**/api/v1/auth/register', async (route) => {
    bodies.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { message: 'SUCCESS_REGISTER' } }),
    });
  });

  await openRegister(page);
  await fillIdentity(page);
  await page.locator('#password').fill(MIN_LENGTH_VALID);
  await page.getByRole('button', { name: COPY.submit }).click();

  // Passing validation is observable as the submitted request and the absence of
  // a password error; the request is intercepted, so no account is created.
  await expect.poll(() => bodies.length, { message: 'form submits a valid password' }).toBe(1);
  expect(JSON.parse(bodies[0]).password).toBe(MIN_LENGTH_VALID);
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.successHeader);
  await expect(passwordMessage(page)).toHaveCount(0);
});

test('accepts the 128-character maximum', async ({ page }) => {
  const bodies: string[] = [];
  await page.route('**/api/v1/auth/register', async (route) => {
    bodies.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { message: 'SUCCESS_REGISTER' } }),
    });
  });

  await openRegister(page);
  await fillIdentity(page);
  await page.locator('#password').fill(MAX_LENGTH_VALID);
  await page.getByRole('button', { name: COPY.submit }).click();

  await expect.poll(() => bodies.length, { message: 'form submits 128 characters' }).toBe(1);
  expect(JSON.parse(bodies[0]).password).toBe(MAX_LENGTH_VALID);
  await expect(page.locator('[data-slot="card-title"]')).toHaveText(COPY.successHeader);
  await expect(passwordMessage(page)).toHaveCount(0);
});
