import { expect, test } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * BIL-03 — Zakup planu studenta, ścieżka poprawna.
 *
 * A standalone student on the free `base` plan buys Spark (9,99 zł/mies.) from
 * `/pricing/student`: the checkout summary shows the plan, its price and
 * „Razem”, the card fields format themselves, the „Zapłać” button unlocks only
 * when every field is valid, the simulated payment shows
 * „Płatność udana! Przekierowywanie...”, then „Zakup udany!” and finally the
 * student panel, and the personal plan becomes Spark with its 500/200/50 limits.
 *
 * The legacy manual account (`test-student@dev.local`, password `pass`) is
 * replaced by this case's own tenant, seeded with a fresh run suffix before
 * every independent run:
 *
 *   bun scripts/qa-tenant.ts BIL-03 --profile bare --role student --fresh
 *
 * `bare`/`student` is the case's exact shape: one student, no organization and no
 * group, freshly created through `tenantKey('qa/cases/BIL-03.md', 'BIL-03#<run>',
 * 'qa-shared')` + `tenantId`, with the default `base` personal plan set by the
 * `handle_new_user` trigger. `--fresh` makes each run own a new account, so the
 * purchase never starts from an already-upgraded plan.
 *
 * Nothing global is mutated: the plan catalogue (`subscription_plans`,
 * `plan_limits`) is only read through the public API, and the purchase writes the
 * tenant student's own `profiles.personal_plan_key` plus a `payments` row for that
 * same user. No admin setting, feature flag, platform row or foreign tenant is
 * touched.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the context
 * pins `NEXT_LOCALE=pl` so a locale cookie from another case cannot change the
 * strings.
 */

const CASE = 'BIL-03';
const HOST = new URL(process.env.QA_APP_URL ?? 'http://localhost:3010').hostname;

const UI = {
  loginTitle: 'Witaj ponownie',
  pricingTitle: 'Wybierz Swój Plan',
  sparkName: 'StudiQ Spark',
  sparkCta: 'Przejdź na Spark',
  summary: 'Podsumowanie zamówienia',
  total: 'Razem',
  cardNumber: 'Numer karty',
  expiry: 'MM/RR',
  cvc: 'CVC',
  cardName: 'Imię i nazwisko na karcie',
  pay: /Zapłać/,
  success: /Płatność udana! Przekierowywanie/,
  successPageTitle: 'Zakup udany!',
  currentPlan: 'Obecny Plan',
} as const;

/** The simulated card the case uses (a Stripe test number, never charged). */
const CARD = {
  number: '4242424242424242',
  formatted: '4242 4242 4242 4242',
  expiry: '1230',
  expiryFormatted: '12/30',
  cvc: '123',
  name: 'Test Student',
} as const;

interface PlanResponse {
  key: string;
  name: string;
  limits: Record<string, number>;
}

test.describe('BIL-03 — student plan purchase', () => {
  test('buys Spark from /pricing/student and lands on the upgraded panel', async ({ page }) => {
    test.setTimeout(180_000);

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

    // --- Precondition: a standalone student on the Base plan -------------
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

    const planBefore = await page.request.get('/api/v1/me/personal-plan');
    expect(planBefore.status(), 'GET /api/v1/me/personal-plan before the purchase').toBe(200);
    const basePlan = (await planBefore.json()).data as PlanResponse;
    expect(basePlan.key, 'the case starts on the free Base plan').toBe('base');

    // --- Step 1: pick Spark on /pricing/student -------------------------
    await page.goto('/pricing/student');
    await expect(page.getByRole('heading', { name: UI.pricingTitle, exact: true })).toBeVisible();

    const sparkCard = page.locator('[data-slot="card"]').filter({ hasText: UI.sparkName });
    await expect(sparkCard, 'one Spark plan card').toHaveCount(1);
    await expect(sparkCard, 'the Spark card shows the plan name').toContainText(UI.sparkName);
    await expect(sparkCard, 'the Spark card shows the monthly price').toContainText(/9,99/);
    const sparkCta = sparkCard.getByRole('button', { name: UI.sparkCta, exact: true });
    await expect(sparkCta, 'the Spark card offers its purchase button').toBeVisible();
    await sparkCta.click();

    // --- Step 2: order summary on /checkout ------------------------------
    await expect(page).toHaveURL(/\/checkout\?.*plan_id=spark/, { timeout: 20_000 });

    const summary = page.locator('[data-slot="card"]').filter({ hasText: UI.summary });
    await expect(summary, 'the checkout renders the order summary').toBeVisible();
    await expect(summary, 'the summary names the bought plan').toContainText(UI.sparkName);
    await expect(summary, 'the summary shows the monthly price').toContainText(/9,99/);
    await expect(summary.getByText(UI.total, { exact: true }), 'the summary total').toBeVisible();

    // Expected result: the development-payment warning is on the page.
    await expect(
      page.getByText(
        /Zabezpieczone przez StudiQ Pay.*brak rzeczywistych opłat w trybie deweloperskim/,
      ),
      'the simulated-payment warning',
    ).toBeVisible();

    // --- Step 3: card fields format and gate the pay button --------------
    const cardInput = page.getByLabel(UI.cardNumber, { exact: true });
    const expiryInput = page.getByLabel(UI.expiry, { exact: true });
    const cvcInput = page.getByLabel(UI.cvc, { exact: true });
    const nameInput = page.getByLabel(UI.cardName, { exact: true });
    const pay = page.getByRole('button', { name: UI.pay });

    await expect(pay, '„Zapłać” starts disabled').toBeDisabled();

    // Spaces every four digits.
    await cardInput.fill('4242');
    await expect(cardInput).toHaveValue('4242');
    await cardInput.fill(CARD.number);
    await expect(cardInput, 'the card number is grouped in fours').toHaveValue(CARD.formatted);
    // The field stops at 16 digits instead of accepting a longer number.
    await cardInput.fill(`${CARD.number}${CARD.number.slice(0, 4)}`);
    await expect(cardInput, 'the card number is capped at 16 digits').toHaveValue(CARD.formatted);
    await expect(pay, 'card alone does not unlock „Zapłać”').toBeDisabled();

    // MM/RR with the slash inserted automatically.
    await expiryInput.fill(CARD.expiry);
    await expect(expiryInput, 'the expiry is formatted as MM/RR').toHaveValue(CARD.expiryFormatted);
    await expect(pay, 'card + expiry still leave „Zapłać” disabled').toBeDisabled();

    // Three digits, nothing more.
    await cvcInput.fill(`${CARD.cvc}45`);
    await expect(cvcInput, 'the CVC is capped at three digits').toHaveValue(CARD.cvc);
    await expect(pay, 'a missing name keeps „Zapłać” disabled').toBeDisabled();

    // The gate reacts to edits, not just to the first render.
    await nameInput.fill(CARD.name);
    await expect(nameInput).toHaveValue(CARD.name);
    await expect(pay, 'all four valid fields unlock „Zapłać”').toBeEnabled();
    await cvcInput.clear();
    await expect(pay, 'clearing a field locks „Zapłać” again').toBeDisabled();
    await cvcInput.fill(CARD.cvc);
    await expect(pay, 'refilling the field unlocks it again').toBeEnabled();

    // --- Step 4: pay ------------------------------------------------------
    const webhookResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/stripe/webhook',
    );
    await pay.click();
    const webhook = await webhookResponse;
    expect(webhook.status(), 'POST /api/v1/stripe/webhook').toBe(200);

    // Expected result: confirmation, then the success page, then the panel.
    await expect(page.getByText(UI.success), 'the payment confirmation message').toBeVisible();
    await expect(page, 'the success page follows the confirmation').toHaveURL(
      /\/billing\/success(\?|$)/,
      { timeout: 10_000 },
    );
    await expect(
      page.getByText(UI.successPageTitle, { exact: true }),
      'the success page greets the buyer',
    ).toBeVisible();
    await expect(page, 'the success page hands over to the student panel').toHaveURL(/\/app$/, {
      timeout: 15_000,
    });

    // Expected result: the personal plan is now Spark, with its limits.
    const planAfter = await page.request.get('/api/v1/me/personal-plan');
    expect(planAfter.status(), 'GET /api/v1/me/personal-plan after the purchase').toBe(200);
    const sparkPlan = (await planAfter.json()).data as PlanResponse;
    expect(sparkPlan.key, 'the student is on Spark').toBe('spark');
    expect(sparkPlan.name, 'Spark is the plan the summary showed').toBe(UI.sparkName);
    expect(sparkPlan.limits, 'the Spark limits from BIL-01').toMatchObject({
      max_flashcards: 500,
      max_questions: 200,
      max_decks: 50,
    });

    // The upgrade page, where the case could also enter, marks Spark as current.
    await page.goto('/app/upgrade');
    const upgradedCard = page.locator('[data-slot="card"]').filter({ hasText: UI.sparkName });
    await expect(
      upgradedCard.getByText(UI.currentPlan, { exact: true }),
      'the Spark card is now the current plan',
    ).toBeVisible();
    const baseCard = page.locator('[data-slot="card"]').filter({ hasText: 'StudiQ Base' });
    await expect(
      baseCard.getByText(UI.currentPlan, { exact: true }),
      'Base is no longer marked as current',
    ).toHaveCount(0);
  });

  test('checkout and upgrade require a session', async ({ page }) => {
    // Adjacent regression for the same surface: the checkout resolves the buyer
    // from the session, so it must not render to an anonymous visitor.
    await page
      .context()
      .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: HOST, path: '/' }]);

    await page.goto('/checkout?plan_id=spark&session_id=qa-bil-03-anonymous');
    await expect(page, 'an anonymous checkout deep link is sent to /login').toHaveURL(
      /\/login\?next=%2Fcheckout%3Fplan_id%3Dspark%26session_id%3Dqa-bil-03-anonymous$/,
    );
    await expect(page.getByText(UI.loginTitle, { exact: true })).toBeVisible();
    await expect(
      page.getByLabel(UI.cardNumber),
      'no payment form to anonymous visitors',
    ).toHaveCount(0);

    await page.goto('/app/upgrade');
    await expect(page, 'an anonymous upgrade link is sent to /login').toHaveURL(
      /\/login\?next=%2Fapp%2Fupgrade$/,
    );
  });
});
