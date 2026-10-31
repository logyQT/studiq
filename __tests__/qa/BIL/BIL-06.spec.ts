import type { APIRequestContext, Browser } from '@playwright/test';
import { expect, loadTenant, test, type QaRole, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * BIL-06 — Płatność bez zalogowania.
 *
 * Prerequisite (reconciled with the tenant seeder): no session. The case is a
 * security check on the simulated checkout and its mock webhook, so the only
 * fixtures it needs are the case's own tenant accounts — never the legacy manual
 * seed (`student1@dev.local` / `pass`).
 *
 * Tenant: the `content` profile of this case
 * (`tenantKey('qa/cases/BIL-06.md', 'BIL-06#<run>', 'qa-shared')` plus a fresh run
 * suffix, written to `qa/.tenants/BIL-06.json` by
 * `bun scripts/qa-tenant.ts BIL-06 --fresh`). The seeder owns the org, the
 * manager/teacher/student accounts and the default group; no id is hard-coded.
 *
 * The case's expected result is the *intended* behavior, not a defect report:
 * an anonymous visitor cannot finish a checkout, and the mock webhook — which is
 * excluded from the proxy's catch-all auth rule because a real Stripe webhook is
 * unauthenticated — authenticates the caller itself. It therefore must reject an
 * anonymous call and must never act on a `user_id` other than the caller's.
 *
 * Acceptance points confirmed during the walk on the shared app:
 * 1. `GET /checkout?plan_id=spark` without a session redirects to
 *    `/login?next=/checkout?plan_id=spark` (the deep link survives the login).
 * 2. `POST /api/v1/stripe/create-checkout-session` without a session answers 401
 *    `UNAUTHORIZED` — there is no way to start or finish a payment signed out.
 * 3. `POST /api/v1/stripe/webhook` without a session answers 401 `UNAUTHORIZED`
 *    and changes nobody's plan (case: “Dokończenie bez sesji nie zmienia żadnego
 *    planu”), so the documented escalation („każdy może nadać dowolny plan
 *    dowolnemu użytkownikowi”) does not reproduce.
 * 4. Signing in through that login form returns to the same checkout and renders
 *    it for the case's plan.
 * 5. A signed-in caller cannot buy a plan for someone else: a `user_id` that is
 *    not the caller's answers 403 `FORBIDDEN`, and neither plan moves.
 * 6. Control: the same signed-in caller buying for themselves still succeeds
 *    (`{received: true}`) and applies the plan — the gate is the session, not a
 *    disarmed endpoint.
 *
 * The spec only reads/writes this run's own tenant rows: no admin setting,
 * feature flag, plan catalogue, platform stat or singleton is touched, and the
 * plan assertions are relative to the plan the tenant starts the run with.
 */

const CASE = 'BIL-06';

/** The tenant's student account — the victim of the case's webhook call. */
const TARGET_PLAN = 'spark';
/** Catalog plan the case's anonymous webhook call tries to grant. */
const ATTACK_PLAN = 'pro';

/** Polish copy from `CheckoutPage` (pl.json), the case's UI language. */
const COPY = {
  summary: 'Podsumowanie zamówienia',
  title: 'Dokończ płatność',
  plan: 'StudiQ Spark',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface PlanInfo {
  key: string;
  name: string;
}

interface WebhookBody {
  type: string;
  session_id: string;
  plan_id: string;
  user_id: string;
}

const TENANT: QaTenant = loadTenant(CASE);
/** Run suffix the seeder folded into the tenant key (stable tenants have none). */
const RUN = TENANT.runSuffix ?? 'stable';

function account(role: QaRole) {
  const user = TENANT.users[role];
  if (!user) throw new Error(`tenant ${TENANT.case} has no seeded ${role} user`);
  return user;
}

/**
 * A separate signed-in session for a witness account, so a plan can be read
 * without disturbing the anonymous page under test. `context.request` shares the
 * context's cookie jar, so the login and the reads use the same session.
 */
async function apiSession(
  browser: Browser,
  baseURL: string,
  role: QaRole,
): Promise<{ request: APIRequestContext; close: () => Promise<void> }> {
  const user = account(role);
  const context = await browser.newContext({ baseURL });
  const response = await context.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  expect(response.status(), `login ${role} (${user.email})`).toBe(200);
  return { request: context.request, close: () => context.close() };
}

/** The caller's personal plan key (`profiles.personal_plan_key`). */
async function personalPlanKey(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/v1/me/personal-plan');
  expect(response.status(), 'GET /api/v1/me/personal-plan').toBe(200);
  const body = (await response.json()) as ApiEnvelope<PlanInfo>;
  expect(body.success, 'personal plan response is successful').toBe(true);
  return body.data.key;
}

function webhookBody(userId: string, sessionSuffix: string, planId: string): WebhookBody {
  return {
    type: 'checkout.session.completed',
    session_id: `bil06-${RUN}-${sessionSuffix}`,
    plan_id: planId,
    user_id: userId,
  };
}

test.describe('@case:BIL-06 @area:BIL @prio:P1 anonymous checkout and webhook', () => {
  test('a signed-out visitor can neither finish a checkout nor grant any user a plan', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    const base = baseURL ?? 'http://localhost:3010';
    const student = account('student');
    const manager = account('manager');
    const { hostname } = new URL(base);
    console.log(`BIL-06 tenant key: ${TENANT.key}`);
    console.log(`BIL-06 org: ${TENANT.org?.id} (${TENANT.org?.name})`);
    console.log(`BIL-06 student (victim): ${student.id}`);
    console.log(`BIL-06 manager (other owner): ${manager.id}`);

    // Polish copy, like the manual case document.
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);

    // Baselines first: the anonymous calls below must not move them, and reading
    // them before (not after) is what makes the assertion meaningful.
    const studentApi = await apiSession(browser, base, 'student');
    const managerApi = await apiSession(browser, base, 'manager');
    try {
      const studentBefore = await personalPlanKey(studentApi.request);
      const managerBefore = await personalPlanKey(managerApi.request);

      // 1. The checkout deep link is not reachable without a session; the proxy
      //    keeps the plan in `next` so the visitor returns to the same checkout.
      await page.goto('/checkout?plan_id=spark');
      await page.waitForURL(/\/login\?/);
      const redirect = new URL(page.url());
      expect(redirect.pathname, 'checkout redirects to the login page').toBe('/login');
      expect(redirect.searchParams.get('next'), 'login keeps the checkout deep link').toBe(
        '/checkout?plan_id=spark',
      );

      // 2. No checkout session can be opened signed out (there is no button to
      //    press, and the API behind it refuses too).
      const sessionResponse = await page.request.post('/api/v1/stripe/create-checkout-session', {
        data: { planKey: TARGET_PLAN },
      });
      expect(sessionResponse.status(), 'anonymous create-checkout-session').toBe(401);
      const sessionBody = (await sessionResponse.json()) as ApiEnvelope<null>;
      expect(sessionBody.success).toBe(false);
      expect(sessionBody.error).toBe('UNAUTHORIZED');

      // 3. The mock webhook is public at the proxy layer and must authenticate
      //    itself: an anonymous call for a real user id is refused and proves
      //    nothing was granted.
      const anonymous = await page.request.post('/api/v1/stripe/webhook', {
        data: webhookBody(student.id, 'anonymous', ATTACK_PLAN),
      });
      expect(anonymous.status(), 'anonymous webhook').toBe(401);
      expect(anonymous.headers()['x-error-code'], 'anonymous webhook error code').toBe(
        'UNAUTHORIZED',
      );
      const anonymousBody = (await anonymous.json()) as ApiEnvelope<unknown>;
      expect(anonymousBody).toEqual({ success: false, error: 'UNAUTHORIZED' });

      expect(
        await personalPlanKey(studentApi.request),
        'the anonymous webhook did not change the student plan',
      ).toBe(studentBefore);
      expect(
        await personalPlanKey(managerApi.request),
        'the anonymous webhook did not change any other plan',
      ).toBe(managerBefore);

      // 4. The visitor signs in from the redirect and lands back on the same
      //    checkout (the case's step 1 can only be finished with a session).
      await page.locator('#email').fill(student.email);
      await page.locator('#password').fill(student.password);
      await page.locator('form button[type=submit]').click();
      await page.waitForURL(/\/checkout\?plan_id=spark/, { timeout: 15_000 });
      await expect(page.getByText(COPY.title, { exact: true })).toBeVisible();
      await expect(page.getByText(COPY.summary, { exact: true })).toBeVisible();
      await expect(page.getByText(COPY.plan, { exact: true }).first()).toBeVisible();

      // 5. A signed-in caller still cannot buy for somebody else: the body
      //    `user_id` is only accepted when it is the authenticated caller.
      const crossUser = await page.request.post('/api/v1/stripe/webhook', {
        data: webhookBody(manager.id, 'cross-user', ATTACK_PLAN),
      });
      expect(crossUser.status(), 'webhook with a foreign user_id').toBe(403);
      expect(crossUser.headers()['x-error-code'], 'foreign user_id error code').toBe('FORBIDDEN');
      expect(
        await personalPlanKey(studentApi.request),
        'the refused webhook did not change the caller plan',
      ).toBe(studentBefore);
      expect(
        await personalPlanKey(managerApi.request),
        "the refused webhook did not change the other user's plan",
      ).toBe(managerBefore);

      // 6. Control: buying for yourself through the same endpoint still works,
      //    so the assertions above test the authorization gate, not a dead route.
      const ownPurchase = await page.request.post('/api/v1/stripe/webhook', {
        data: webhookBody(student.id, 'own-purchase', TARGET_PLAN),
      });
      expect(ownPurchase.status(), 'webhook for the caller').toBe(200);
      const ownPurchaseBody = (await ownPurchase.json()) as ApiEnvelope<{ received: boolean }>;
      expect(ownPurchaseBody).toEqual({ success: true, data: { received: true } });
      expect(await personalPlanKey(studentApi.request), 'the own purchase applied').toBe(
        TARGET_PLAN,
      );
      expect(
        await personalPlanKey(managerApi.request),
        "the caller's purchase left the other user alone",
      ).toBe(managerBefore);
    } finally {
      await studentApi.close();
      await managerApi.close();
    }
  });
});
