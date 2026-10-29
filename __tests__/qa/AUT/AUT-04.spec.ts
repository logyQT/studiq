import { expect, test, type Page, type Request } from '@playwright/test';
import { shortHash, tenantKey } from '#test/e2e/fixtures/ids';
import { randomTag } from '#test/helpers/tenant-seed';

/**
 * AUT-04 — Walidacja imienia i nazwiska (registration form, `/register`).
 *
 * Prerequisite (reconciled with the tenant seeder): no session. The register page
 * is public, so the spec runs in an empty storage state and never signs in. The
 * case's identity anchor is still its own tenant
 * (`tenantKey('qa/cases/AUT-04.md', <title>, 'qa-shared')::<run suffix>`): every
 * registration address is derived from it with `shortHash`, so each independent
 * run gets fresh, deterministic addresses and no other case (or a previous run)
 * can collide with them. No tenant rows are needed — the case
 * asserts the anonymous form only — and nothing global is read or written: no
 * settings, feature flags, plans or platform rows.
 *
 * The case's two negative points map to the shared `NameSchema`:
 * - „A” → `.min(2)` → „Imię i nazwisko jest za krótkie.”
 * - „Jan123” → charset regex → „Imię i nazwisko zawiera niedozwolone znaki.”
 * Both are client-side: the form must not send `POST /api/v1/auth/register`.
 *
 * „Łukasz Żółć” (Polish diacritics) is accepted. The case asks to *record* the
 * behaviour for „Anna-Maria Nowak” and „Jan O'Brien” and flags the hyphen and
 * apostrophe as a possible problem for double-barrelled / Irish surnames; that
 * note is resolved in the product — `NameSchema` explicitly allows both
 * separators (#302) — so the intended behaviour asserted here is acceptance,
 * matching the shared e2e contract (`__tests__/e2e/register.spec.ts`).
 *
 * Locale is pinned to `pl` because the case quotes the Polish copy; otherwise a
 * `NEXT_LOCALE` cookie left by another case would change every string.
 */

const CASE_FILE = 'qa/cases/AUT-04.md';
const TITLE = 'AUT-04 registration full-name validation';
const PROJECT = 'qa-shared';
/** A fresh suffix per independent run; pin `QA_RUN_SUFFIX` to replay one run. */
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}${randomTag(4)}`;
const KEY = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;

const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

const COPY = {
  header: 'Utwórz konto',
  nameLabel: 'Imię i Nazwisko',
  emailLabel: 'Adres e-mail',
  passwordLabel: 'Hasło',
  accountType: 'Uczniem',
  submit: 'Zarejestruj się',
  successHeader: 'Konto zostało utworzone',
  activationSent: 'Link aktywacyjny został wysłany. Sprawdź swoją skrzynkę e-mail.',
  tooShort: 'Imię i nazwisko jest za krótkie.',
  invalidChars: 'Imię i nazwisko zawiera niedozwolone znaki.',
} as const;

const PASSWORD = 'Seed4Test!';

/** One deterministic address per registration slot of this run. */
function emailFor(slot: 'short' | 'digits' | 'hyphen' | 'apostrophe'): string {
  return `qa+${shortHash(`${KEY}:${slot}`)}+aut04@test.local`;
}

/** The name field's own form item, so an error toast can never satisfy the assertion. */
const nameItem = (page: Page) =>
  page.locator('[data-slot="form-item"]').filter({ has: page.locator('label[for="name"]') });

const isRegisterPost = (request: Request) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/auth/register';

/** Anonymous visit with the Polish locale the case quotes. */
async function openRegister(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);
  await page.goto('/register');

  expect(
    ((await (await page.request.get('/api/v1/auth/me')).json()) as { data?: { user?: unknown } })
      .data?.user ?? null,
    'AUT-04 prerequisite: no session',
  ).toBeNull();
  await expect(page.getByText(COPY.header, { exact: true })).toBeVisible();
}

/** Fill every field except the name and pick the student account type. */
async function fillRest(page: Page, email: string): Promise<void> {
  await page.getByLabel(COPY.emailLabel).fill(email);
  await page.getByLabel(COPY.passwordLabel).fill(PASSWORD);
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: COPY.accountType }).click();
}

/** Count register POSTs while a client-side-only submission is attempted. */
async function submitWithoutRequest(page: Page, name: string): Promise<void> {
  const posts: string[] = [];
  const record = (request: Request) => {
    if (isRegisterPost(request)) posts.push(request.url());
  };
  page.on('request', record);
  try {
    await page.getByLabel(COPY.nameLabel).fill(name);
    await page.getByRole('button', { name: COPY.submit }).click();
    // Give a request that should never happen a chance to appear.
    await page.waitForTimeout(500);
  } finally {
    page.off('request', record);
  }
  expect(posts, `a name rejected by the form must not reach the API („${name}”)`).toHaveLength(0);
}

/**
 * Submit the form with a valid name and assert the registration was accepted:
 * the API answers 202 with the same name the form validated, then the success
 * card replaces the form.
 */
async function submitAndWait(page: Page, name: string) {
  await page.getByLabel(COPY.nameLabel).fill(name);
  const responsePromise = page.waitForResponse((response) => isRegisterPost(response.request()));
  await page.getByRole('button', { name: COPY.submit }).click();
  const response = await responsePromise;
  expect(response.status(), `POST /api/v1/auth/register for „${name}”`).toBe(202);
  expect((response.request().postDataJSON() as { name?: string }).name).toBe(name);
  await expect(page.getByText(COPY.successHeader, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.activationSent, { exact: true })).toBeVisible();
  await expect(page.getByLabel(COPY.nameLabel)).not.toBeVisible();
}

test.describe('AUT-04 full-name validation on registration', () => {
  test('a one-letter name is too short, then a Polish name is accepted', async ({ page }) => {
    await openRegister(page);
    const email = emailFor('short');
    await fillRest(page, email);

    await submitWithoutRequest(page, 'A');
    await expect(nameItem(page)).toContainText(COPY.tooShort);
    await expect(nameItem(page)).not.toContainText(COPY.invalidChars);
    await expect(page).toHaveURL(/\/register$/);

    // Correcting the name clears the error and registers „Łukasz Żółć”.
    await submitAndWait(page, 'Łukasz Żółć');
    await expect(page).toHaveURL(/\/register$/);
  });

  test('a name containing digits is rejected as invalid characters', async ({ page }) => {
    await openRegister(page);
    await fillRest(page, emailFor('digits'));

    await submitWithoutRequest(page, 'Jan123');
    await expect(nameItem(page)).toContainText(COPY.invalidChars);
    await expect(nameItem(page)).not.toContainText(COPY.tooShort);
    await expect(page).toHaveURL(/\/register$/);
  });

  test('a hyphenated double-barrelled name is accepted', async ({ page }) => {
    await openRegister(page);
    await fillRest(page, emailFor('hyphen'));
    await submitAndWait(page, 'Anna-Maria Nowak');
  });

  test('a name with an apostrophe is accepted', async ({ page }) => {
    await openRegister(page);
    await fillRest(page, emailFor('apostrophe'));
    await submitAndWait(page, "Jan O'Brien");
  });
});
