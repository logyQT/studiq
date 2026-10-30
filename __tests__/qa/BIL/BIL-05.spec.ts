import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * BIL-05 — checkout refuses a plan that does not match the account type.
 *
 * The case was written against the legacy manual seed (`student1@dev.local`,
 * password `pass`); the suite version uses this case's own tenant and never the
 * legacy accounts. A `bare`/`student` tenant (`__tests__/qa/profiles/BIL-05.json`) is
 * one student with no organization, no group and the free `base` personal plan
 * that the `handle_new_user` trigger writes — exactly the case's precondition
 * („Zalogowany student1”). Every independent run is seeded with a fresh run
 * suffix, so the student has never bought anything:
 *
 *   bun scripts/qa-tenant.ts BIL-05 --fresh
 *
 * The verdict of the walk (shared app, pl): the concern in the case text — „student
 * może przypisać sobie plan organizacyjny/edukatora” — does not reproduce. The
 * server refuses the purchase (`MockStripeService.assertPlanPurchasable` compares
 * `subscription_plans.for_account_type` with the caller's `ctx.accountType`):
 *
 * - `/checkout?plan_id=campus` (the case's step) renders the Campus summary but no
 *   payment form: a student has no organization, so the page shows the blocking
 *   alert and only „Wróć do planów”;
 * - posting the completed checkout for `campus` (organization plan) or `lite`
 *   (educator plan) answers `403 FORBIDDEN`; neither the personal plan nor the
 *   payment history changes;
 * - the same student's own plan (`spark`) still goes through, so the guard keys on
 *   the plan's account type rather than blocking every purchase.
 *
 * That is the intended behavior the case asks for („odrzucenie zakupu planu
 * niezgodnego z typem konta”), so the spec asserts the rejection and the positive
 * control. Nothing global is mutated: the plan catalogue is only read through the
 * public API, and every write is the tenant student's own `profiles.personal_plan_key`
 * / `payments` row. A fresh tenant per run means the assertions never depend on
 * another test's purchase.
 */

const CASE = 'BIL-05';

const UI = {
  summary: 'Podsumowanie zamówienia',
  total: 'Razem',
  campus: 'StudiQ Campus',
  lite: 'StudiQ Lite',
  plansBack: 'Wróć do planów',
  cardNumber: 'Numer karty',
  expiry: 'MM/RR',
  cvc: 'CVC',
  cardName: 'Imię i nazwisko na karcie',
  pay: /Zapłać/,
  paymentFailed: 'Przetwarzanie płatności nie powiodło się. Spróbuj ponownie.',
  paymentSucceeded: /Płatność udana! Przekierowywanie/,
} as const;

/** The simulated card the case uses (a Stripe test number, never charged). */
const CARD = {
  number: '4242424242424242',
  expiry: '1230',
  cvc: '123',
  name: 'Test Student',
} as const;

interface PersonalPlan {
  key: string;
  name: string;
}

interface PaymentHistoryItem {
  planKey: string;
  planName: string;
  amount: number;
  currency: string;
}

async function personalPlan(page: Page): Promise<PersonalPlan> {
  const res = await page.request.get('/api/v1/me/personal-plan');
  expect(res.status(), 'GET /api/v1/me/personal-plan').toBe(200);
  return (await res.json()).data as PersonalPlan;
}

async function paymentHistory(page: Page): Promise<PaymentHistoryItem[]> {
  const res = await page.request.get('/api/v1/me/payments');
  expect(res.status(), 'GET /api/v1/me/payments').toBe(200);
  return (await res.json()).data as PaymentHistoryItem[];
}

test.describe('BIL-05 — plan must match the account type', () => {
  test('a student cannot buy the organization plan from the checkout deep link', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
    expect(tenant.org, 'the student under test belongs to no organization').toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new, still-Base student',
    ).toBeTruthy();
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();

    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

    const planBefore = await personalPlan(page);
    const paymentsBefore = await paymentHistory(page);

    // --- Step 1: open the organization plan checkout by hand --------------
    await page.goto('/checkout?plan_id=campus');
    await expect(page).toHaveURL(/\/checkout\?plan_id=campus$/);

    await expect(
      page.getByText(UI.summary, { exact: true }),
      'the checkout renders the order summary',
    ).toBeVisible();
    await expect(
      page.getByText(UI.campus, { exact: true }),
      'the summary names the organization plan the deep link asked for',
    ).toBeVisible();
    await expect(page.getByText(UI.total, { exact: true }), 'the summary total').toBeVisible();

    // Expected result: the purchase is refused, so the payment form is never shown.
    await expect(
      page.getByLabel(UI.cardNumber, { exact: true }),
      'no card form for a plan the account cannot buy',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: UI.pay }),
      'no „Zapłać” button for a plan the account cannot buy',
    ).toHaveCount(0);
    await expect(
      page.locator('[data-slot="alert"]'),
      'the checkout explains why it is blocked',
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: UI.plansBack, exact: true }),
      'the only way out is back to the plans',
    ).toBeVisible();

    // --- The server refuses it even when the client is bypassed -----------
    const sessionId = `${CASE}-campus-${crypto.randomUUID()}`;
    const webhook = await page.request.post('/api/v1/stripe/webhook', {
      data: {
        type: 'checkout.session.completed',
        session_id: sessionId,
        plan_id: 'campus',
        user_id: student!.id,
      },
    });
    expect(webhook.status(), 'POST /api/v1/stripe/webhook (campus)').toBe(403);
    expect(webhook.headers()['x-error-code'], 'the app error code').toBe('FORBIDDEN');
    expect(await webhook.json(), 'the webhook refuses the purchase').toEqual({
      success: false,
      error: 'FORBIDDEN',
    });

    const session = await page.request.post('/api/v1/stripe/create-checkout-session', {
      data: { planId: 'campus' },
    });
    expect(session.status(), 'POST /api/v1/stripe/create-checkout-session (campus)').toBe(403);
    expect(session.headers()['x-error-code'], 'the app error code').toBe('FORBIDDEN');

    // Expected result: nothing was granted and nothing was recorded.
    const planAfter = await personalPlan(page);
    expect(planAfter.key, 'the rejected purchase leaves the personal plan untouched').toBe(
      planBefore.key,
    );
    expect(planAfter.name, 'the personal plan name is unchanged').toBe(planBefore.name);
    expect(await paymentHistory(page), 'the rejected purchase leaves no payment row').toEqual(
      paymentsBefore,
    );
  });

  test('the refusal keys on the account type, not on every purchase', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();

    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

    const planBefore = await personalPlan(page);
    const paymentsBefore = await paymentHistory(page);

    // --- An educator plan is refused too (the case's second plan family) --
    const educatorWebhook = await page.request.post('/api/v1/stripe/webhook', {
      data: {
        type: 'checkout.session.completed',
        session_id: `${CASE}-lite-${crypto.randomUUID()}`,
        plan_id: 'lite',
        user_id: student!.id,
      },
    });
    expect(educatorWebhook.status(), 'POST /api/v1/stripe/webhook (lite)').toBe(403);
    expect(educatorWebhook.headers()['x-error-code'], 'the app error code').toBe('FORBIDDEN');

    // The deep link is reachable, but „dokończ płatność” must fail: the checkout
    // posts the same webhook and surfaces the failure instead of a confirmation.
    await page.goto('/checkout?plan_id=lite');
    await expect(page).toHaveURL(/\/checkout\?plan_id=lite$/);
    await expect(
      page.getByText(UI.lite, { exact: true }),
      'the summary names the educator plan',
    ).toBeVisible();

    const cardInput = page.getByLabel(UI.cardNumber, { exact: true });
    const pay = page.getByRole('button', { name: UI.pay });
    await cardInput.fill(CARD.number);
    await page.getByLabel(UI.expiry, { exact: true }).fill(CARD.expiry);
    await page.getByLabel(UI.cvc, { exact: true }).fill(CARD.cvc);
    await page.getByLabel(UI.cardName, { exact: true }).fill(CARD.name);
    await expect(pay, 'the simulated card unlocks „Zapłać”').toBeEnabled();

    const webhookResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/stripe/webhook',
    );
    await pay.click();
    const rejected = await webhookResponse;
    expect(rejected.status(), 'the checkout payment is refused').toBe(403);

    await expect(
      page.getByText(UI.paymentFailed, { exact: true }),
      'the checkout reports the failed payment',
    ).toBeVisible();
    await expect(
      page.getByText(UI.paymentSucceeded),
      'no success confirmation for a refused plan',
    ).toHaveCount(0);
    await expect(page, 'the checkout stays on the unpaid order').toHaveURL(
      /\/checkout\?plan_id=lite$/,
    );

    const planAfterRejection = await personalPlan(page);
    expect(planAfterRejection.key, 'the rejected purchase leaves the personal plan untouched').toBe(
      planBefore.key,
    );
    expect(await paymentHistory(page), 'the rejected purchase leaves no payment row').toEqual(
      paymentsBefore,
    );

    // --- Positive control: the student's own plan still goes through ------
    const ownWebhook = await page.request.post('/api/v1/stripe/webhook', {
      data: {
        type: 'checkout.session.completed',
        session_id: `${CASE}-spark-${crypto.randomUUID()}`,
        plan_id: 'spark',
        user_id: student!.id,
      },
    });
    expect(ownWebhook.status(), 'POST /api/v1/stripe/webhook (spark)').toBe(200);

    const planAfterPurchase = await personalPlan(page);
    expect(planAfterPurchase.key, 'the student plan is granted').toBe('spark');
    expect(planAfterPurchase.name, 'the granted plan is the student plan').toBe('StudiQ Spark');

    const paymentsAfter = await paymentHistory(page);
    expect(paymentsAfter, 'the accepted purchase appends exactly one payment row').toHaveLength(
      paymentsBefore.length + 1,
    );
    expect(
      paymentsAfter.filter((payment) => payment.planKey === 'campus' || payment.planKey === 'lite'),
      'no refused plan was ever recorded',
    ).toHaveLength(0);
    const sparkPayments = paymentsAfter.filter((payment) => payment.planKey === 'spark');
    expect(sparkPayments, 'the accepted purchase is the student plan').toHaveLength(
      paymentsBefore.filter((payment) => payment.planKey === 'spark').length + 1,
    );
    expect(
      sparkPayments[0],
      'the recorded payment carries the catalogue name and price',
    ).toMatchObject({ planName: 'StudiQ Spark', amount: 999, currency: 'PLN' });
  });
});
