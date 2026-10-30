import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-52 — „Historia płatności” (`/app/account/payments`).
 *
 * Case step: open `/app/account/payments`.
 * Expected: the title „Historia płatności” and the message „Brak płatności” for an
 * account without purchases; after buying a plan (BIL-03) the case asks to note
 * whether an entry appears.
 *
 * Prerequisite (reconciled with the tenant seeder): the legacy „Konto TS”
 * (`test-student@dev.local`, password `pass` — a standalone student on the free
 * Base plan) is never used. The suite version seeds this case's own tenant:
 *
 *   bun scripts/qa-tenant.ts STU-52 --fresh
 *
 * which is `{ profile: "bare", role: "student" }` (`__tests__/qa/profiles/STU-52.json`):
 * one student with no organization and no group, created through
 * `tenantKey('qa/cases/STU-52.md', 'STU-52#<suffix>', 'qa-shared')` + `tenantId`
 * with the `base` personal plan the `handle_new_user` trigger writes. A fresh run
 * suffix means each independent run owns a student who has never bought anything.
 *
 * The purchase is the same call `BIL-03`'s checkout makes (the mock Stripe webhook
 * for `spark`, 9,99 zł/mies.), issued as this tenant's own student: it touches only
 * that student's `profiles.personal_plan_key` and adds one `payments` row for the
 * same user. Nothing global is read or written — no admin setting, feature flag,
 * plan catalogue entry, platform stat, singleton row or foreign tenant.
 *
 * `payments` is append-only by design (RLS: own-row SELECT, no write policy), so
 * the spec resets only this tenant's own student — its `payments` rows and its
 * personal plan back to the seeded `base` — before the walk. That keeps a CI retry
 * on the same seeded tenant (`--retries=2`) in exactly the state of a fresh seed
 * instead of inheriting the previous attempt's purchase.
 *
 * Acceptance points (walked on the shared app :3010, worker qa-env-5, 2026-10-29,
 * Polish UI):
 * - For a purchase-free student the page renders the „Historia płatności” title,
 *   the „Twoje zakończone płatności” subtitle, the „Brak płatności” message and no
 *   table; „Zarządzaj rozliczeniami” links to `/app/billing`.
 * - After the purchase the same page renders the „Plan / Kwota / Data” table with
 *   one row: „StudiQ Spark”, „9,99 zł”, the purchase date (`29 paź 2026` in the
 *   walk) — and „Brak płatności” is gone. `GET /api/v1/me/payments` returns the
 *   same single row.
 * - An anonymous deep link is sent to `/login?next=%2Fapp%2Faccount%2Fpayments` and
 *   the API answers 401 `UNAUTHORIZED`, so the history is never public.
 */

const CASE = 'STU-52';
const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

/** Polish copy from `AccountPage` in `apps/web/src/i18n/messages/pl.json`. */
const UI = {
  title: 'Historia płatności',
  subtitle: 'Twoje zakończone płatności',
  empty: 'Brak płatności',
  manageBilling: 'Zarządzaj rozliczeniami',
  planColumn: 'Plan',
  amountColumn: 'Kwota',
  dateColumn: 'Data',
} as const;

/** The plan BIL-03 buys and the catalogue snapshot the payment row keeps. */
const PURCHASE = {
  planId: 'spark',
  planKey: 'spark',
  planName: 'StudiQ Spark',
  amount: 999,
  currency: 'PLN',
} as const;

interface PaymentHistoryItem {
  id: string;
  planKey: string;
  planName: string;
  amount: number;
  currency: string;
  paidAt: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** `Intl` renders a non-breaking space before the currency; compare normalised. */
function normalise(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The caller's own payment history, straight from the product API. */
async function paymentHistory(page: Page): Promise<PaymentHistoryItem[]> {
  const response = await page.request.get('/api/v1/me/payments');
  expect(response.status(), 'GET /api/v1/me/payments').toBe(200);
  const body = (await response.json()) as ApiEnvelope<PaymentHistoryItem[]>;
  expect(body.success, 'GET /api/v1/me/payments success flag').toBe(true);
  return body.data;
}

/**
 * Put this tenant's own student back into the seeded starting point: no purchases
 * and the free Base plan. Scoped to the tenant's student id only — never another
 * user, never a shared row.
 */
async function resetPurchaseState(studentId: string): Promise<void> {
  const db = createQaSupabase();

  const removed = await db.from('payments').delete().eq('user_id', studentId).select('id');
  expect(
    removed.error,
    `${CASE}: delete the tenant student's own payments rows — ${removed.error?.message ?? ''}`,
  ).toBeNull();

  const plan = await db.from('profiles').update({ personal_plan_key: 'base' }).eq('id', studentId);
  expect(
    plan.error,
    `${CASE}: reset the tenant student to the seeded Base plan — ${plan.error?.message ?? ''}`,
  ).toBeNull();
}

test.describe('@case:STU-52 @area:STU @prio:P3 payment history', () => {
  test('shows the empty state, then the bought plan in the payment history', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
    expect(tenant.org, 'the student under test belongs to no organization').toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns its own purchase-free student',
    ).toBeTruthy();
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // --- Precondition: the case's own student, no purchases, Base plan -----
    await resetPurchaseState(student!.id);

    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    expect(await paymentHistory(page), 'the case starts on an account without purchases').toEqual(
      [],
    );

    // --- Step 1: open /app/account/payments -------------------------------
    await page.goto('/app/account/payments');
    await expect(page).toHaveURL(/\/app\/account\/payments$/);

    await expect(
      page.getByRole('heading', { level: 1, name: UI.title, exact: true }),
      'the page title',
    ).toBeVisible();
    await expect(page.getByText(UI.subtitle, { exact: true }), 'the page subtitle').toBeVisible();
    await expect(
      page.getByText(UI.empty, { exact: true }),
      'the „Brak płatności” message for an account without purchases',
    ).toBeVisible();
    await expect(
      page.locator('table'),
      'no payment table when there is nothing to list',
    ).toHaveCount(0);

    // The one action on the page leads to the student's billing panel.
    const manageBilling = page.getByRole('link', { name: UI.manageBilling, exact: true });
    await expect(manageBilling, 'the „Zarządzaj rozliczeniami” action').toBeVisible();
    await expect(manageBilling).toHaveAttribute('href', '/app/billing');
    await manageBilling.click();
    await expect(page, '„Zarządzaj rozliczeniami” opens /app/billing').toHaveURL(/\/app\/billing$/);

    // Coming back keeps the account's real state: still no payments.
    await page.goto('/app/account/payments');
    await expect(page.getByText(UI.empty, { exact: true })).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);

    // --- The purchase BIL-03 performs (mock Stripe checkout completed) -----
    const sessionId = `${CASE}-${crypto.randomUUID()}`;
    const webhook = await page.request.post('/api/v1/stripe/webhook', {
      data: {
        type: 'checkout.session.completed',
        session_id: sessionId,
        plan_id: PURCHASE.planId,
        user_id: student!.id,
      },
    });
    expect(webhook.status(), 'POST /api/v1/stripe/webhook (spark)').toBe(200);

    const purchased = await paymentHistory(page);
    expect(purchased, 'the completed purchase is recorded once').toHaveLength(1);
    const payment = purchased[0];
    expect(payment).toMatchObject({
      planKey: PURCHASE.planKey,
      planName: PURCHASE.planName,
      amount: PURCHASE.amount,
      currency: PURCHASE.currency,
    });
    expect(Number.isNaN(new Date(payment.paidAt).getTime()), 'a parseable purchase date').toBe(
      false,
    );

    // --- Step 1 again, after the purchase: an entry appears ----------------
    await page.goto('/app/account/payments');
    await expect(page).toHaveURL(/\/app\/account\/payments$/);
    await expect(
      page.getByRole('heading', { level: 1, name: UI.title, exact: true }),
      'the title survives the purchase',
    ).toBeVisible();
    await expect(
      page.getByText(UI.empty, { exact: true }),
      '„Brak płatności” disappears once a payment exists',
    ).toHaveCount(0);

    const table = page.locator('table');
    await expect(table, 'the payment history table').toBeVisible();
    await expect(
      table.getByRole('columnheader'),
      'the table is the payment history (Plan / Kwota / Data)',
    ).toHaveText([UI.planColumn, UI.amountColumn, UI.dateColumn]);

    const rows = table.locator('tbody tr');
    await expect(rows, 'the bought plan is the only entry').toHaveCount(purchased.length);

    const cells = rows.first().locator('td');
    await expect(cells.nth(0), 'the entry names the bought plan').toHaveText(PURCHASE.planName);
    await expect(cells.nth(1), 'the entry shows the price the payment recorded').toHaveText(
      normalise(
        new Intl.NumberFormat('pl', {
          style: 'currency',
          currency: payment.currency,
        }).format(payment.amount / 100),
      ),
    );
    await expect(cells.nth(2), 'the entry shows the purchase date').toHaveText(
      normalise(
        new Intl.DateTimeFormat('pl', { dateStyle: 'medium' }).format(new Date(payment.paidAt)),
      ),
    );

    expect(pageErrors, 'uncaught page errors on the payment history page').toEqual([]);
  });

  test('the payment history is never public', async ({ page }) => {
    // Adjacent regression for the same surface: the page and its API resolve the
    // reader from the session, so an anonymous visitor gets neither.
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);

    await page.goto('/app/account/payments');
    await expect(page, 'an anonymous deep link is sent to /login').toHaveURL(
      /\/login\?next=%2Fapp%2Faccount%2Fpayments$/,
    );
    await expect(
      page.getByRole('heading', { level: 1, name: UI.title, exact: true }),
      'no payment history for an anonymous visitor',
    ).toHaveCount(0);

    const response = await page.request.get('/api/v1/me/payments');
    expect(response.status(), 'GET /api/v1/me/payments without a session').toBe(401);
    expect(response.headers()['x-error-code'], 'the app error code').toBe('UNAUTHORIZED');
    expect(await response.json(), 'the API returns no rows').toEqual({
      success: false,
      error: 'UNAUTHORIZED',
    });
  });
});
