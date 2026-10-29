import { expect, test, type Page, type Response } from '@playwright/test';
import { shortHash } from '#test/e2e/fixtures/ids';
import { waitForMailLinkMatch } from '@qa/fixtures/qa-mail';
import { loadTenant } from '@qa/fixtures/qa-tenant';

/**
 * AUT-12 — Zapomniane hasło: wysłanie linku resetującego.
 *
 * Prerequisite (reconciled with the tenant seeder): no session, and one existing
 * e-mail-confirmed account to reset. The case was written against the legacy
 * manual seed (`student1@dev.local`); the suite version uses the case's own
 * `bare`/`student` tenant (`tenantKey('qa/cases/AUT-12.md', 'AUT-12#<run>',
 * 'qa-shared')`), which is exactly one confirmed account with no organization and
 * no group:
 *
 *   bun scripts/qa-tenant.ts AUT-12 --profile bare --role student --fresh
 *
 * `--fresh` folds a run suffix into the tenant key, so every independent run has
 * a brand-new address (`seed-student-<hash>@dev.local`) that collides with no
 * previous run and with no other case. The spec reads the tenant from
 * `qa/.tenants/AUT-12.json` and never creates accounts itself.
 *
 * Expected behaviour (confirmed in the walk): submitting the address returns
 * HTTP 200 with `SUCCESS_PASSWORD_RESET_REQUESTED`, the form is replaced by the
 * exact Polish confirmation „Instrukcje zostały wysłane. Sprawdź swoją skrzynkę
 * e-mail.”, and the mailbox receives one „StudiQ - Password Reset” message with a
 * recovery link (`/auth/callback?token_hash=…&type=recovery&next=/password/update`).
 * Requesting the link neither signs the visitor in nor changes the password.
 *
 * The locale is pinned to `pl` because the case quotes the Polish copy; otherwise
 * a `NEXT_LOCALE` cookie left by another case would change every string.
 */

const CASE = 'AUT-12';

const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

const COPY = {
  title: 'Zapomniałeś hasła?',
  description: 'Podaj swój adres e-mail, a wyślemy Ci link do zresetowania hasła.',
  emailLabel: 'E-mail',
  submit: 'Wyślij link',
  backToLogin: 'Wróć do logowania',
  success: 'Instrukcje zostały wysłane. Sprawdź swoją skrzynkę e-mail.',
} as const;

const RESET_BODY = { success: true, data: { message: 'SUCCESS_PASSWORD_RESET_REQUESTED' } };

const isResetPost = (response: Response): boolean =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/v1/auth/password/reset';

/** Anonymous visit to the public reset page, in the locale the case quotes. */
async function openResetPage(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);
  await page.goto('/password/reset');

  await expect(page).toHaveURL(/\/password\/reset$/);
  await expect(page.getByText(COPY.title, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.description, { exact: true })).toBeVisible();
  await expect(page.getByLabel(COPY.emailLabel, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: COPY.submit, exact: true })).toBeVisible();
}

/** The caller's session, read from the product's own endpoint. */
async function currentUser(page: Page): Promise<unknown> {
  const response = await page.request.get('/api/v1/auth/me');
  expect(response.ok(), 'GET /api/v1/auth/me').toBe(true);
  const body = (await response.json()) as { data?: { user?: unknown } };
  return body.data?.user ?? null;
}

/** Fill the form and submit it; resolves with the reset request's response. */
async function submitReset(page: Page, email: string): Promise<Response> {
  const emailInput = page.getByLabel(COPY.emailLabel, { exact: true });
  await emailInput.fill(email);
  await expect(emailInput).toHaveValue(email);

  const responsePromise = page.waitForResponse(isResetPost);
  await page.getByRole('button', { name: COPY.submit, exact: true }).click();
  const response = await responsePromise;

  // The form sent exactly what the visitor typed.
  expect(response.request().postDataJSON(), 'reset request body').toEqual({ email });
  return response;
}

/**
 * The confirmation the case expects: the API acknowledged the request, the form
 * is replaced by the success alert and the way back to `/login`, and no technical
 * detail (error code, stack trace) is rendered.
 */
async function expectConfirmation(page: Page, response: Response): Promise<void> {
  expect(response.status(), 'POST /api/v1/auth/password/reset').toBe(200);
  expect(response.headers()['x-error-code']).toBeUndefined();
  expect(await response.json()).toEqual(RESET_BODY);

  await expect(page.getByText(COPY.success, { exact: true })).toBeVisible();
  await expect(page.getByLabel(COPY.emailLabel, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: COPY.submit, exact: true })).toHaveCount(0);

  const backToLogin = page.getByRole('link', { name: COPY.backToLogin, exact: true });
  await expect(backToLogin).toBeVisible();
  await expect(backToLogin).toHaveAttribute('href', '/login');

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toMatch(/ERROR_[A-Z_]+|INTERNAL_SERVER|BAD_REQUEST|stack trace/i);
}

test.describe('AUT-12 forgotten password — send the reset link', () => {
  test('sends the recovery link and shows the confirmation', async ({ page }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
    expect(tenant.org, 'the bare tenant must not own an organization').toBeNull();

    const student = tenant.users.student;
    if (!student) throw new Error(`${CASE} tenant has no seeded student`);

    // --- Step 1: open /password/reset without a session -------------------
    await openResetPage(page);
    expect(await currentUser(page), `${CASE} prerequisite: no session`).toBeNull();

    // --- Step 2: enter the tenant student's address, click „Wyślij link” --
    const response = await submitReset(page, student.email);
    await expectConfirmation(page, response);

    // Requesting a link is an anonymous action: it must not establish a session.
    expect(await currentUser(page), 'the reset request must not sign the visitor in').toBeNull();

    // --- Step 3: the mailbox holds the message with the recovery link -----
    const mail = await waitForMailLinkMatch(
      student.email,
      /https?:\/\/[^"'\s]+\/auth\/callback\?[^"'\s]+/,
      60_000,
    );
    const link = new URL(mail.link);
    expect(link.pathname, 'the link points at the auth callback').toBe('/auth/callback');
    expect(link.searchParams.get('token_hash'), 'token_hash in the recovery link').toBeTruthy();
    expect(link.searchParams.get('type'), 'recovery link type').toBe('recovery');
    expect(link.searchParams.get('next'), 'where the link continues').toBe('/password/update');

    // Sending a reset link leaves the credentials untouched: the seeded
    // password still signs in to the same account (AUT-13 covers changing it).
    const login = await page.request.post('/api/v1/auth/login', {
      data: { email: student.email, password: student.password },
    });
    expect(login.status(), 'login with the unchanged password').toBe(200);
    const session = (await login.json()) as { data?: { user?: { id?: string } } };
    expect(session.data?.user?.id, 'the login belongs to the tenant student').toBe(student.id);
  });

  test('an unknown address gets the same neutral confirmation', async ({ page }) => {
    // Deterministic per run and owned by this tenant: an address that was never
    // registered, so the response must not reveal whether an account exists.
    const tenant = loadTenant(CASE);
    const unknown = `qa+${shortHash(`${tenant.key}:aut12-unknown`)}@test.local`;

    await openResetPage(page);
    expect(await currentUser(page), `${CASE} prerequisite: no session`).toBeNull();

    const response = await submitReset(page, unknown);
    await expectConfirmation(page, response);

    // Still anonymous, exactly like the known-address path.
    expect(await currentUser(page)).toBeNull();
  });
});
