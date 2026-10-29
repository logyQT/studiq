import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * BIL-04 — a manager buys the organization plan from `/pricing/org`.
 *
 * The case was written against the legacy manual seed (`manager@dev.local`,
 * organization „WSB Merito”, password `pass`); the suite version uses this
 * case's own tenant and never the legacy accounts. `qa/tests/profiles/BIL-04.json`
 * declares the default `content` profile — an organization on its default
 * `launch` plan, the tenant's manager (org role `admin`), teacher and student,
 * and the default group. No `--plan` override, so the organization starts on the
 * free Launch tier exactly like „WSB Merito (Launch)”. Every id derives from
 * `tenantKey('qa/cases/BIL-04.md', 'BIL-04#<run>', 'qa-shared')` + `tenantId`:
 *
 *   bun scripts/qa-tenant.ts BIL-04 --fresh
 *
 * Walk observation (shared app, pl): the concern the case asks to verify — „the
 * simulated webhook changes only the buyer's personal plan
 * (`profiles.personal_plan_key`), never the organization plan” — does **not**
 * reproduce. For an organization plan the mock webhook requires the caller to be
 * an admin of the target org and calls `apply_org_plan`, which moves
 * `organizations.plan` and re-syncs the feature snapshots; the buyer's personal
 * plan is deliberately left on the free `launch` tier (#228). After buying Hub
 * the organization reads `hub`, `/manage/settings` shows „Wgraj logo” and
 * „Kolor marki” instead of the „Własny branding” lock card, and `/manage/roles`
 * shows „Nowa rola” instead of the „Kreator ról nie jest dostępny w Twoim planie”
 * lock card. That is the behavior the case calls expected, so the spec asserts
 * it.
 *
 * The purchase is a one-way entitlement write on the tenant's own organization,
 * so the assertions capture the state before the checkout and assert the state
 * after it (plan key, features, payment row, personal plan untouched) instead of
 * hard-coding the pre-purchase plan: a CI retry or a repeated run against the
 * same tenant re-buys Hub for an organization that already has it and still
 * holds. Nothing global is written — the plan catalogue (`subscription_plans`,
 * `plan_limits`) is only read, and every write is this tenant's own
 * `organizations`/`payments` row.
 *
 * Polish copy is asserted because the case quotes the Polish UI; the fixture pins
 * `NEXT_LOCALE=pl` so a locale cookie from another case cannot change it.
 */

const CASE = 'BIL-04';

const UI = {
  pricingTitle: 'Wybierz Swój Plan',
  hubName: 'StudiQ Hub',
  hubCta: 'Wybierz Hub',
  currentPlan: 'Obecny Plan',
  summary: 'Podsumowanie zamówienia',
  targetOrg: 'Dla',
  total: 'Razem',
  cardNumber: 'Numer karty',
  expiry: 'MM/RR',
  cvc: 'CVC',
  cardName: 'Imię i nazwisko na karcie',
  pay: /Zapłać/,
  success: /Płatność udana! Przekierowywanie/,
  successPageTitle: 'Zakup udany!',
  brandingLockedTitle: 'Własny branding',
  brandingLockedDesc: 'Ulepsz plan, aby uzyskać dostęp do własnego brandingu',
  uploadLogo: 'Wgraj logo',
  brandColor: 'Kolor marki',
  roleLockedTitle: 'Kreator ról nie jest dostępny w Twoim planie',
  newRole: 'Nowa rola',
  notAdminTitle: 'Tylko administrator organizacji może kupić plan',
  plansBack: 'Wróć do planów',
} as const;

/** The simulated card the case uses (a Stripe test number, never charged). */
const CARD = {
  number: '4242424242424242',
  formatted: '4242 4242 4242 4242',
  expiry: '1230',
  expiryFormatted: '12/30',
  cvc: '123',
  name: 'Test Manager',
} as const;

interface PlanInfo {
  key: string;
  name: string;
  features: string[];
}

interface PaymentItem {
  planKey: string;
  planName: string;
  amount: number;
  currency: string;
}

interface OrganizationDetail {
  id: string;
  name: string;
  plan: string;
}

interface FeaturesResponse {
  features: string[];
}

async function readPlan(page: Page): Promise<PlanInfo> {
  const res = await page.request.get('/api/v1/me/plan');
  expect(res.status(), 'GET /api/v1/me/plan').toBe(200);
  return (await res.json()).data as PlanInfo;
}

async function readPersonalPlan(page: Page): Promise<PlanInfo> {
  const res = await page.request.get('/api/v1/me/personal-plan');
  expect(res.status(), 'GET /api/v1/me/personal-plan').toBe(200);
  return (await res.json()).data as PlanInfo;
}

async function readFeatures(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/v1/features/me');
  expect(res.status(), 'GET /api/v1/features/me').toBe(200);
  return ((await res.json()).data as FeaturesResponse).features;
}

async function readOrganization(page: Page, orgId: string): Promise<OrganizationDetail> {
  const res = await page.request.get(`/api/v1/organization/${orgId}`);
  expect(res.status(), `GET /api/v1/organization/${orgId}`).toBe(200);
  return (await res.json()).data as OrganizationDetail;
}

async function readPayments(page: Page): Promise<PaymentItem[]> {
  const res = await page.request.get('/api/v1/me/payments');
  expect(res.status(), 'GET /api/v1/me/payments').toBe(200);
  return (await res.json()).data as PaymentItem[];
}

test.describe('BIL-04 — organization plan purchase', () => {
  test('buys Hub for the organization and unlocks branding and the role builder', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
    expect(tenant.plan, 'the profile does not pre-upgrade the organization').toBeNull();
    expect(tenant.org, `${CASE} needs the tenant's own organization`).toBeTruthy();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    const manager = tenant.users.manager;
    expect(manager, `${CASE} seeds the manager under test`).toBeTruthy();
    const orgId = tenant.org!.id;

    // --- Precondition: the manager administers the tenant's organization ---
    await loginAs(page, tenant, 'manager', { locale: 'pl' });
    await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });

    const personalPlanBefore = await readPersonalPlan(page);
    const paymentsBefore = await readPayments(page);
    const orgBefore = await readOrganization(page, orgId);
    expect(orgBefore.name, 'the checkout targets the tenant organization').toBe(tenant.org!.name);

    // --- Step 1: pick Hub on /pricing/org --------------------------------
    // The card's CTA sends the *active* organization id, which the page resolves
    // from `/api/v1/me/orgs`; clicking before that query settles would post an
    // empty `orgId` and the checkout would refuse it. Wait for the membership
    // list and for the network to go quiet (the resolved org is rendered into
    // the React tree on the next paint) before clicking.
    const orgsLoaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/me/orgs' && response.status() === 200,
      { timeout: 20_000 },
    );
    await page.goto('/pricing/org');
    await expect(page.getByRole('heading', { name: UI.pricingTitle, exact: true })).toBeVisible();
    await orgsLoaded;
    await page.waitForLoadState('networkidle');

    const hubCard = page.locator('[data-slot="card"]').filter({ hasText: UI.hubName });
    await expect(hubCard, 'one Hub plan card').toHaveCount(1);
    await expect(hubCard, 'the Hub card shows the organization plan name').toContainText(
      UI.hubName,
    );
    await expect(hubCard, 'the Hub card shows the monthly price').toContainText(/19,99/);
    const hubCta = hubCard.getByRole('button', { name: UI.hubCta, exact: true });
    await expect(hubCta, 'the Hub card offers its purchase button').toBeVisible();
    await hubCta.click();

    // --- Step 1 (cont.): the checkout belongs to this organization --------
    await expect(page).toHaveURL(new RegExp(`/checkout\\?.*plan_id=hub.*org_id=${orgId}`), {
      timeout: 20_000,
    });

    const summary = page.locator('[data-slot="card"]').filter({ hasText: UI.summary });
    await expect(summary, 'the checkout renders the order summary').toBeVisible();
    await expect(summary, 'the summary names the target organization').toContainText(
      tenant.org!.name,
    );
    await expect(summary, 'the summary names the bought plan').toContainText(UI.hubName);
    await expect(summary, 'the summary shows the monthly price').toContainText(/19,99/);
    await expect(summary.getByText(UI.total, { exact: true }), 'the summary total').toBeVisible();

    // Expected result: the development-payment warning is on the page.
    await expect(
      page.getByText(
        /Zabezpieczone przez StudiQ Pay.*brak rzeczywistych opłat w trybie deweloperskim/,
      ),
      'the simulated-payment warning',
    ).toBeVisible();

    // --- Step 1 (cont.): pay with the simulated card ----------------------
    const cardInput = page.getByLabel(UI.cardNumber, { exact: true });
    const expiryInput = page.getByLabel(UI.expiry, { exact: true });
    const cvcInput = page.getByLabel(UI.cvc, { exact: true });
    const nameInput = page.getByLabel(UI.cardName, { exact: true });
    const pay = page.getByRole('button', { name: UI.pay });

    await expect(pay, '„Zapłać” starts disabled').toBeDisabled();
    await cardInput.fill(CARD.number);
    await expect(cardInput, 'the card number is grouped in fours').toHaveValue(CARD.formatted);
    await expect(pay, 'card alone does not unlock „Zapłać”').toBeDisabled();
    await expiryInput.fill(CARD.expiry);
    await expect(expiryInput, 'the expiry is formatted as MM/RR').toHaveValue(CARD.expiryFormatted);
    await cvcInput.fill(CARD.cvc);
    await nameInput.fill(CARD.name);
    await expect(pay, 'all four valid fields unlock „Zapłać”').toBeEnabled();

    const webhookResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/stripe/webhook',
    );
    await pay.click();
    const webhook = await webhookResponse;
    expect(webhook.status(), 'POST /api/v1/stripe/webhook (organization plan)').toBe(200);

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
    await expect(page, 'the success page hands over to the manager panel').toHaveURL(/\/manage$/, {
      timeout: 15_000,
    });

    // --- Expected result: the ORGANIZATION is now on Hub ------------------
    const orgAfter = await readOrganization(page, orgId);
    expect(orgAfter.plan, 'the organization moved to Hub').toBe('hub');
    expect(orgAfter.name, 'the same organization was upgraded').toBe(orgBefore.name);

    const planAfter = await readPlan(page);
    expect(planAfter.key, 'the active organization plan is Hub').toBe('hub');
    expect(planAfter.name, 'Hub is the plan the summary showed').toBe(UI.hubName);

    const featuresAfter = await readFeatures(page);
    expect(featuresAfter, 'Hub unlocks branding').toContain('branding');
    expect(featuresAfter, 'Hub unlocks the role builder').toContain('role.builder');

    // The organization purchase must not touch the buyer's personal plan: a
    // manager's personal plan is the free tier and applies only outside an org.
    const personalPlanAfter = await readPersonalPlan(page);
    expect(personalPlanAfter.key, 'the organization purchase leaves the personal plan alone').toBe(
      personalPlanBefore.key,
    );
    expect(personalPlanAfter.name, 'the personal plan name is unchanged').toBe(
      personalPlanBefore.name,
    );
    expect(personalPlanAfter.key, 'the manager did not buy a personal plan').not.toBe('hub');

    // The purchase is recorded once, at the catalogue price, for this tenant.
    const paymentsAfter = await readPayments(page);
    expect(paymentsAfter, 'the accepted purchase appends exactly one payment row').toHaveLength(
      paymentsBefore.length + 1,
    );
    const hubPayments = paymentsAfter.filter((payment) => payment.planKey === 'hub');
    expect(hubPayments, 'the purchase is logged once more as a Hub payment').toHaveLength(
      paymentsBefore.filter((payment) => payment.planKey === 'hub').length + 1,
    );
    expect(
      hubPayments[0],
      'the recorded payment carries the catalogue name and price',
    ).toMatchObject({
      planName: UI.hubName,
      amount: 1999,
      currency: 'PLN',
    });

    // --- Step 2: /manage/settings shows the branding controls -------------
    await page.goto('/manage/settings');
    await expect(
      page.getByText(UI.brandingLockedTitle, { exact: true }),
      'the branding lock card is gone',
    ).toHaveCount(0);
    await expect(
      page.getByText(UI.brandingLockedDesc, { exact: true }),
      'no upgrade prompt for branding',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: UI.uploadLogo, exact: true }),
      'the logo upload is available',
    ).toBeVisible();
    await expect(
      page.getByText(UI.brandColor, { exact: true }),
      'the brand colour picker is available',
    ).toBeVisible();
    await expect(
      page.getByText(UI.hubName, { exact: true }),
      'the subscription shows Hub',
    ).toBeVisible();

    // --- Step 2 (cont.): /manage/roles shows the role builder -------------
    await page.goto('/manage/roles');
    await expect(
      page.getByText(UI.roleLockedTitle, { exact: true }),
      'the role-builder lock card is gone',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: UI.newRole, exact: true }),
      'the role builder offers „Nowa rola”',
    ).toBeVisible();
    // The list itself was always readable; the system roles are still there.
    await expect(
      page.getByRole('row', { name: /admin/ }).first(),
      'the system roles stay listed',
    ).toBeVisible();
  });

  test('a non-admin member cannot buy the organization plan', async ({ page }) => {
    // Adjacent regression for the same surface: the organization checkout is an
    // admin-only action, both in the UI and in the webhook that grants it.
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.org, `${CASE} needs the tenant's own organization`).toBeTruthy();
    const orgId = tenant.org!.id;
    const teacher = tenant.users.teacher;
    expect(teacher, `${CASE} seeds the teacher`).toBeTruthy();

    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    await expect(page).toHaveURL(/\/(edu|app|manage)/, { timeout: 20_000 });

    const orgBefore = await readOrganization(page, orgId);
    const planBefore = orgBefore.plan;

    await page.goto(`/checkout?plan_id=hub&org_id=${orgId}`);
    await expect(page).toHaveURL(new RegExp(`/checkout\\?plan_id=hub&org_id=${orgId}$`));

    await expect(
      page.getByText(UI.summary, { exact: true }),
      'the checkout still shows what was asked for',
    ).toBeVisible();
    await expect(
      page.getByText(UI.notAdminTitle, { exact: true }),
      'a teacher is told only an admin can buy the plan',
    ).toBeVisible();
    await expect(
      page.getByLabel(UI.cardNumber, { exact: true }),
      'no card form for a non-admin',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: UI.pay }),
      'no „Zapłać” button for a non-admin',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: UI.plansBack, exact: true }),
      'the only way out is back to the plans',
    ).toBeVisible();

    // The server refuses it even when the client is bypassed.
    const webhook = await page.request.post('/api/v1/stripe/webhook', {
      data: {
        type: 'checkout.session.completed',
        session_id: `${CASE}-teacher-${crypto.randomUUID()}`,
        plan_id: 'hub',
        user_id: teacher!.id,
        org_id: orgId,
      },
    });
    expect(webhook.status(), 'POST /api/v1/stripe/webhook (hub) as a teacher').toBe(403);
    expect(webhook.headers()['x-error-code'], 'the app error code').toBe('FORBIDDEN');

    const orgAfter = await readOrganization(page, orgId);
    expect(orgAfter.plan, 'the refused purchase leaves the organization plan untouched').toBe(
      planBefore,
    );
  });
});
