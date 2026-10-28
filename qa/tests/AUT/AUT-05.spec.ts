import { expect, test, type Page, type Response } from '@playwright/test';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-05 — Rejestracja na istniejący e-mail.
 *
 * Prerequisite (reconciled with the tenant seeder): one account already exists.
 * The case was written against the legacy manual seed (`student1@dev.local`);
 * the suite version uses the case's own `content` tenant
 * (`tenantKey('qa/cases/AUT-05.md', 'AUT-05'[, '#<run>'], 'qa-shared')`), whose
 * student is created through the Supabase Admin API with `email_confirm: true` —
 * the state GoTrue rejects as `user_already_exists`:
 *
 *   bun scripts/qa-tenant.ts AUT-05 --fresh
 *
 * The register page is public, so the visitor is anonymous: the spec checks
 * `GET /api/v1/auth/me` is empty, then submits the form as a visitor would. The
 * tenant student is signed in only in the last assertion, to prove the original
 * account is untouched. Nothing global is read or written — the spec exercises
 * the public registration endpoint, the tenant student's own login, and one
 * fresh address derived from the tenant key.
 *
 * Locale is pinned to `pl` because the case quotes the Polish copy; otherwise a
 * `NEXT_LOCALE` cookie left by another case would change every string.
 *
 * Expected behaviour (confirmed in the walk, #300): a duplicate address is
 * answered exactly like a fresh one — HTTP 202 with
 * `SUCCESS_ACTIVATION_LINK_SENT`, the neutral "account created / activation link
 * sent" card, no account-enumeration signal and no technical detail.
 */

const TENANT = loadTenant('AUT-05');
const STUDENT = TENANT.users.student;
if (!STUDENT) throw new Error('AUT-05 tenant has no seeded student');

const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

const COPY = {
  nameLabel: 'Imię i Nazwisko',
  emailLabel: 'Adres e-mail',
  passwordLabel: 'Hasło',
  submit: 'Zarejestruj się',
  accountTypePlaceholder: 'Powiedz nam, kim jesteś',
  studentOption: 'Uczniem',
  successHeading: 'Konto zostało utworzone',
  successDescription: 'Prawie gotowe! Brakuje jeszcze tylko jednego kroku.',
  activationSent: 'Link aktywacyjny został wysłany. Sprawdź swoją skrzynkę e-mail.',
  activationInstructions:
    'Aby aktywować konto, kliknij w link przesłany w wiadomości e-mail. Jeśli nie widzisz wiadomości, sprawdź folder SPAM.',
  backToLogin: 'Przejdź do logowania',
} as const;

const NEUTRAL_BODY = { success: true, data: { message: 'SUCCESS_ACTIVATION_LINK_SENT' } };

interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  accountType: 'student' | 'educator' | 'manager';
}

/** Anonymous visit with the Polish locale the case quotes. */
async function openRegister(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);
  await page.goto('/register');

  expect(
    ((await (await page.request.get('/api/v1/auth/me')).json()) as { data?: { user?: unknown } })
      .data?.user ?? null,
    'AUT-05 prerequisite: no session',
  ).toBeNull();

  await expect(page.getByLabel(COPY.nameLabel)).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.submit })).toBeVisible();
}

/** Fill and submit the real form; resolves with the register response. */
async function submitRegistration(page: Page, payload: RegisterPayload): Promise<Response> {
  await page.getByLabel(COPY.nameLabel).fill(payload.name);
  await page.getByLabel(COPY.emailLabel).fill(payload.email);
  await page.getByLabel(COPY.passwordLabel).fill(payload.password);

  // Account type is required by the shared `RegisterSchema`; the combobox has no
  // default value, so without this the form never reaches the API.
  await expect(page.getByRole('combobox')).toContainText(COPY.accountTypePlaceholder);
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: COPY.studentOption }).click();

  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === 'POST' &&
      new URL(candidate.url()).pathname === '/api/v1/auth/register',
  );
  await page.getByRole('button', { name: COPY.submit }).click();
  return response;
}

/** The neutral confirmation both a duplicate and a fresh address must receive. */
async function expectNeutralResponse(response: Response): Promise<void> {
  expect(response.status(), 'registration status').toBe(202);
  expect(response.headers()['x-error-code']).toBeUndefined();
  expect(await response.json()).toEqual(NEUTRAL_BODY);
}

/**
 * The success card replaces the form: same heading, same activation message and
 * no technical detail (error code, stack trace, database text) anywhere on the
 * page. The duplicate must be indistinguishable from a fresh registration.
 */
async function expectNeutralActivationCard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByText(COPY.successHeading, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.successDescription, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.activationSent, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.activationInstructions, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: COPY.backToLogin })).toBeVisible();

  // The form is gone — there is nothing left that would let the visitor retry
  // the same submission or read the previous input back.
  await expect(page.getByLabel(COPY.emailLabel)).toHaveCount(0);
  await expect(page.getByRole('button', { name: COPY.submit })).toHaveCount(0);

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/INTERNAL_SERVER|UNPROCESSABLE_ENTITY|ERROR_[A-Z_]+|stack trace/i);
}

test.describe('AUT-05 registration with an existing e-mail', () => {
  test('shows the neutral activation confirmation instead of an error', async ({ page }) => {
    await openRegister(page);

    // A different password proves the form is really submitting; the duplicate
    // must not change the existing account's credentials (asserted below).
    const response = await submitRegistration(page, {
      name: 'Jan Testowy',
      email: STUDENT.email,
      password: 'OtherPass456!',
      accountType: 'student',
    });

    await expectNeutralResponse(response);
    await expectNeutralActivationCard(page);
  });

  test('creates no duplicate account and leaves the existing one usable', async ({ page }) => {
    const submittedPassword = 'OtherPass456!';
    await openRegister(page);
    const response = await submitRegistration(page, {
      name: 'Duplicate Student',
      email: STUDENT.email,
      password: submittedPassword,
      accountType: 'student',
    });
    await expectNeutralResponse(response);
    await expectNeutralActivationCard(page);

    // The original credentials still work: the duplicate submission did not
    // replace the account, its password, or its account type.
    const login = await page.request.post('/api/v1/auth/login', {
      data: { email: STUDENT.email, password: STUDENT.password },
    });
    expect(login.status(), 'login with the original password').toBe(200);
    const body = (await login.json()) as {
      data: { user: { id: string; email: string; user_metadata?: { account_type?: string } } };
    };
    expect(body.data.user.id, 'the original user id').toBe(STUDENT.id);
    expect(body.data.user.email).toBe(STUDENT.email);
    expect(body.data.user.user_metadata?.account_type).toBe('student');

    // The password typed into the duplicate form never became valid: no second
    // account was created with it, and the existing account's password was not
    // overwritten. Together with the unchanged id above, that is the observable
    // form of "no duplicate was created".
    const submitted = await page.request.post('/api/v1/auth/login', {
      data: { email: STUDENT.email, password: submittedPassword },
    });
    expect(submitted.status(), 'the submitted password is not a valid credential').toBe(401);
    expect(await submitted.json()).toMatchObject({ success: false, error: 'UNAUTHORIZED' });
  });

  test('an unrelated address gets the same neutral 202, so accounts cannot be enumerated', async ({
    page,
  }) => {
    // Deterministic per run: the tenant key carries the run suffix, so a fresh
    // seed produces a new address and a re-run of the same seed is idempotent.
    // The local part is deliberately not a tenant user — it is data this spec
    // creates and never reads back.
    const slug = TENANT.key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(-24);
    const freshEmail = `aut05-${slug}@test.local`;

    const duplicate = await page.request.post('/api/v1/auth/register', {
      data: {
        name: 'Duplicate Student',
        email: STUDENT.email,
        password: 'OtherPass456!',
        accountType: 'student',
      },
    });
    const fresh = await page.request.post('/api/v1/auth/register', {
      data: {
        name: 'Nowy Student',
        email: freshEmail,
        password: 'Seed4Test!',
        accountType: 'student',
      },
    });

    expect(duplicate.status()).toBe(202);
    expect(fresh.status()).toBe(202);
    const duplicateBody = await duplicate.json();
    const freshBody = await fresh.json();
    expect(duplicateBody).toEqual(NEUTRAL_BODY);
    expect(freshBody).toEqual(NEUTRAL_BODY);
    // Identical status and body: the response carries no hint whether the
    // address was already registered.
    expect(duplicateBody).toEqual(freshBody);
    expect(duplicate.headers()['x-error-code']).toBeUndefined();
    expect(fresh.headers()['x-error-code']).toBeUndefined();
  });
});
