import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-50 — Zmiana nazwy (`/app/account`).
 *
 * Case steps: change the name to „Anna Nowak” and save; refresh and check the
 * sidebar and the dashboard greeting; then try to save „A” and „Anna123”.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-50 --fresh
 *
 * gives the org `qa-stu-50-<suffix>` with a manager, an educator and a student,
 * where every id derives from
 * `tenantKey('qa/cases/STU-50.md', 'STU-50#<suffix>', 'qa-shared')` + `tenantId`.
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row. The spec signs in as the tenant student (the
 * legacy seed's „TS” / `test-student@dev.local` analogue) and only touches that
 * user's own `user_metadata.name`.
 *
 * The case was written against the legacy manual seed (`student1@dev.local`,
 * password `pass`); the suite version uses the tenant student.
 *
 * Acceptance points confirmed on the shared app during the walk (2026-10-29):
 * 1. `/app/account` shows the card „Nazwa” with the input `#name` holding the
 *    stored name and the button „Zapisz”. Saving a valid change shows the toast
 *    „Nazwa zaktualizowana pomyślnie”, updates the input and the sidebar user
 *    menu immediately, and the button becomes disabled (nothing left to save).
 * 2. After a full reload the input, the sidebar user menu and the dashboard
 *    greeting still carry the new name, i.e. it is persisted in
 *    `user_metadata.name` (confirmed through `GET /api/v1/auth/me`), not just a
 *    client cache patch. The greeting uses the **first name only** — „Cześć,
 *    Anna.” for „Anna Nowak” (`AppOverviewPage.hello_greeting`), while the
 *    sidebar shows the full name; the case's „nowa nazwa widoczna w całej
 *    aplikacji” is asserted in both forms.
 * 3. „A” is rejected by the API with 422 `VALIDATION_NAME_TOO_SHORT` and the
 *    page shows the toast „Imię i nazwisko jest za krótkie.”.
 * 4. „Anna123” is rejected with 422 `VALIDATION_NAME_INVALID_FORMAT` and the
 *    toast „Imię i nazwisko zawiera niedozwolone znaki.”.
 * 5. A rejected save never changes the stored name — the API, the sidebar and a
 *    reload still show the last accepted „Anna Nowak”.
 *
 * Retry safety: CI seeds a tenant once and retries against it, so the execution
 * first resets the name to the account's seeded „QA student” through the profile
 * API (a valid, idempotent save) and only then walks the case. The second
 * attempt therefore starts from the same first-run state as the first.
 */

const CASE = 'STU-50';

/** The name the tenant student is seeded with; the reset target of every run. */
const BASE_NAME = 'QA student';

/** The case's valid rename, plus the two invalid values from step 3. */
const NEW_NAME = 'Anna Nowak';
const NEW_FIRST_NAME = 'Anna';
const TOO_SHORT_NAME = 'A';
const INVALID_NAME = 'Anna123';

/** Polish copy from `AccountPage` / `AppOverviewPage` (verified on the app). */
const COPY = {
  title: 'Konto',
  subtitle: 'Zarządzaj ustawieniami konta',
  nameLabel: 'Nazwa',
  save: 'Zapisz',
  saved: 'Nazwa zaktualizowana pomyślnie',
  tooShort: 'Imię i nazwisko jest za krótkie.',
  invalidFormat: 'Imię i nazwisko zawiera niedozwolone znaki.',
} as const;

const PROFILE_URL = '/api/v1/auth/profile';
const ME_URL = '/api/v1/auth/me';

interface ApiUser {
  user_metadata?: { name?: string };
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** The name the API currently stores for the signed-in student. */
async function storedName(page: Page): Promise<string | undefined> {
  const response = await page.request.get(ME_URL);
  expect(response.ok(), `GET ${ME_URL} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<{ user: ApiUser }>;
  expect(body.success, `GET ${ME_URL} success flag`).toBe(true);
  return body.data.user.user_metadata?.name;
}

/** The account page's „Nazwa” input (the only `#name` on the page). */
function nameInput(page: Page): Locator {
  return page.locator('#name');
}

/** The „Nazwa” card's „Zapisz” button (the password card uses „Zaktualizuj hasło”). */
function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: COPY.save, exact: true });
}

/**
 * The sidebar's user-menu trigger — the only place outside the account page that
 * renders the full stored name (`[data-slot="sidebar-footer"]`).
 */
function sidebarUserName(page: Page): Locator {
  return page.locator('[data-slot="sidebar-footer"] button[data-slot="dropdown-menu-trigger"]');
}

/** The sonner toast carrying this text. */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** Sonner keeps a toast for 4 s; wait it out so the next step's toast is the new one. */
async function waitForToastsToClear(page: Page): Promise<void> {
  await expect(page.locator('[data-sonner-toast]'), 'no toast from the previous step').toHaveCount(
    0,
    { timeout: 15_000 },
  );
}

/**
 * Type a name into the account form and click „Zapisz”, returning the profile
 * `PUT` response so the step can assert the validation code, not just the toast.
 */
async function submitName(
  page: Page,
  name: string,
): Promise<{
  status: number;
  body: { issues?: { properties?: Record<string, { errors?: string[] }> } };
}> {
  await nameInput(page).fill(name);
  await expect(saveButton(page), 'the save button is enabled for an edited name').toBeEnabled();
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith(PROFILE_URL) && candidate.request().method() === 'PUT',
    ),
    saveButton(page).click(),
  ]);
  return { status: response.status(), body: await response.json() };
}

/** The first validation code reported for the `name` field. */
function nameErrorCode(body: {
  issues?: { properties?: Record<string, { errors?: string[] }> };
}): string | undefined {
  return body.issues?.properties?.name?.errors?.[0];
}

test.describe('@case:STU-50 @area:STU @prio:P2 account name change', () => {
  test('renames the student, shows it across the app after reload and rejects invalid names', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!student) throw new Error(`${CASE} needs the content tenant profile (student account)`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Tenant prep ─────────────────────────────────────────────────────────
    // A CI retry reuses this tenant, so reset the name to the seeded value before
    // the walk; the full reload below is what makes the AuthProvider pick it up.
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    const reset = await page.request.put(PROFILE_URL, { data: { name: BASE_NAME } });
    expect(
      reset.status(),
      `PUT ${PROFILE_URL} (reset) → ${reset.status()} ${await reset.text()}`,
    ).toBe(200);

    // ── Prerequisite: the account page with the stored name ─────────────────
    await page.goto('/app/account');
    await expect(page).toHaveURL(/\/app\/account$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();
    await expect(page.getByText(COPY.subtitle, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.nameLabel, { exact: true }).first()).toBeVisible();

    await expect(nameInput(page), 'the form starts from the stored name').toHaveValue(BASE_NAME);
    await expect(sidebarUserName(page)).toContainText(BASE_NAME);
    expect(await storedName(page), 'the API starts from the seeded name').toBe(BASE_NAME);

    // ── Step 1: change the name to „Anna Nowak” and save ────────────────────
    const saved = await submitName(page, NEW_NAME);
    expect(saved.status, `PUT ${PROFILE_URL} (${NEW_NAME}) status`).toBe(200);
    await expect(
      toast(page, COPY.saved),
      'the „Nazwa zaktualizowana pomyślnie” toast',
    ).toBeVisible();
    await expect(nameInput(page)).toHaveValue(NEW_NAME);
    await expect(
      sidebarUserName(page),
      'the sidebar user menu shows the new full name without a reload',
    ).toContainText(NEW_NAME);
    await expect(
      saveButton(page),
      'nothing is left to save once the form matches the stored name',
    ).toBeDisabled();
    expect(await storedName(page), 'the new name is persisted for the account').toBe(NEW_NAME);

    // ── Step 2: refresh, then check the sidebar and the dashboard greeting ──
    await page.reload();
    await expect(nameInput(page), 'the reloaded form shows the stored name').toHaveValue(NEW_NAME);
    await expect(sidebarUserName(page), 'the reloaded sidebar shows the full name').toContainText(
      NEW_NAME,
    );

    await page.goto('/app');
    await expect(
      page.getByRole('heading', { level: 1, name: `Cześć, ${NEW_FIRST_NAME}.` }),
      'the dashboard greets the student by their new first name',
    ).toBeVisible();
    await expect(
      sidebarUserName(page),
      'the sidebar keeps the full name on the dashboard',
    ).toContainText(NEW_NAME);

    // ── Step 3: invalid names are rejected and change nothing ───────────────
    await page.goto('/app/account');
    await expect(nameInput(page)).toHaveValue(NEW_NAME);

    await waitForToastsToClear(page);
    const tooShort = await submitName(page, TOO_SHORT_NAME);
    expect(tooShort.status, `PUT ${PROFILE_URL} (${TOO_SHORT_NAME}) is rejected`).toBe(422);
    expect(nameErrorCode(tooShort.body), 'a one-character name is reported as too short').toBe(
      'VALIDATION_NAME_TOO_SHORT',
    );
    await expect(toast(page, COPY.tooShort), 'the „…za krótkie” toast from the case').toBeVisible();
    await expect(nameInput(page), 'the rejected draft stays in the form, unsaved').toHaveValue(
      TOO_SHORT_NAME,
    );
    await expect(
      sidebarUserName(page),
      'the rejected name never reaches the sidebar',
    ).toContainText(NEW_NAME);
    expect(await storedName(page), 'the stored name is unchanged').toBe(NEW_NAME);

    await waitForToastsToClear(page);
    const invalid = await submitName(page, INVALID_NAME);
    expect(invalid.status, `PUT ${PROFILE_URL} (${INVALID_NAME}) is rejected`).toBe(422);
    expect(nameErrorCode(invalid.body), 'a name with digits is reported as invalid format').toBe(
      'VALIDATION_NAME_INVALID_FORMAT',
    );
    await expect(
      toast(page, COPY.invalidFormat),
      'the „…niedozwolone znaki” toast from the case',
    ).toBeVisible();
    await expect(
      sidebarUserName(page),
      'the rejected name never reaches the sidebar',
    ).toContainText(NEW_NAME);
    expect(await storedName(page), 'the stored name is still unchanged').toBe(NEW_NAME);

    // The last accepted name survives a reload, so neither rejection was persisted.
    await page.reload();
    await expect(nameInput(page), 'the reloaded form shows the last accepted name').toHaveValue(
      NEW_NAME,
    );

    expect(pageErrors, 'uncaught page errors on the account page').toEqual([]);
  });
});
