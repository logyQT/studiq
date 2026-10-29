import { expect, loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * SEC-12 — Endpointy deweloperskie.
 *
 * Case steps: call `GET /api/v1/dev/traces` and
 * `POST /api/v1/dev/study-simulate {"email":"<student>"}`, then repeat on a
 * production build.
 *
 * Expected result: in development both work; in a production build traces must
 * answer 403 „Only available in development mode” and study-simulate 404
 * „Not available in production”. Any other answer is a critical defect.
 *
 * Environment reconciliation: the QA suite runs **one shared production build**
 * (`next start` on :3010, same in CI), so only the production half of the case is
 * executable here — starting a second development server is outside the shared
 * app/DB contract. This spec therefore pins the production gate, i.e. the
 * security property of the case, and checks it strictly (exact status *and* exact
 * body), so a 200 with trace events or with a simulation result fails. The
 * development half stays a manual note in `qa/cases/SEC-12.md`.
 *
 * Tenant reconciliation: the case does not need content, only a real signed-in
 * user, to prove the gate is not merely "anonymous callers are rejected". The
 * `bare` student tenant of this case is seeded by
 * `bun scripts/qa-tenant.ts SEC-12 --fresh` from
 * `__tests__/qa/profiles/SEC-12.json` = `{ "profile": "bare", "role": "student" }`;
 * the legacy `student1@dev.local` / `pass` account is never used and every id
 * comes from `qa/.tenants/SEC-12.json`.
 *
 * Observed on the shared app (3010 / DB 54421, production build), intended:
 * 1. Anonymous `GET /api/v1/dev/traces` → 403 with exactly
 *    `{"error":"Only available in development mode"}`; the `serverSessionId=all`
 *    query does not change that.
 * 2. Anonymous `POST /api/v1/dev/study-simulate` (with a real tenant e-mail) →
 *    404 with exactly `{"error":"Not available in production"}`.
 * 3. After signing in as the tenant student (session confirmed via
 *    `/api/v1/auth/me`), both answers are identical — the route returns before
 *    `withAuth`, so a valid session does not unlock it.
 * 4. Neither response carries `events`, `total`, `dbStatus`, `updated` or `cards`,
 *    so no trace data and no simulation result leaks, and the blocked
 *    `study-simulate` call never reaches the database.
 *
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row; the spec is read-only against its own tenant.
 */

const CASE = 'SEC-12';
const TENANT: QaTenant = loadTenant(CASE);

/** Production gate from the two `/api/v1/dev` route handlers. */
const GATE = {
  traces: { status: 403, error: 'Only available in development mode' },
  simulate: { status: 404, error: 'Not available in production' },
} as const;

const TRACES = '/api/v1/dev/traces';
const SIMULATE = '/api/v1/dev/study-simulate';

function studentEmail(): string {
  const student = TENANT.users.student;
  if (!student) throw new Error(`tenant ${CASE} needs the bare/student profile`);
  return student.email;
}

/**
 * The case treats any other answer as a critical defect, so the gate is asserted
 * on the status, the content type and the exact JSON body — a 200 with
 * `{events, total}` or `{updated, cards}` can never pass.
 */
async function expectGate(
  response: {
    status(): number;
    headers(): Record<string, string>;
    text(): Promise<string>;
  },
  expected: { status: number; error: string },
  label: string,
): Promise<void> {
  const body = await response.text();
  expect(response.status(), `${label} → ${body}`).toBe(expected.status);
  expect(response.headers()['content-type'] ?? '', `${label} content type`).toContain(
    'application/json',
  );
  expect(JSON.parse(body), `${label} body`).toEqual({ error: expected.error });
}

test.describe('@case:SEC-12 @area:SEC @prio:P2 dev endpoints stay closed in production', () => {
  test('anonymous callers get the production gate for both dev endpoints', async ({ page }) => {
    console.log(`SEC-12 tenant key: ${TENANT.key}`);

    await expectGate(
      await page.request.get(TRACES),
      GATE.traces,
      'GET /api/v1/dev/traces (anonymous)',
    );

    // The trace reader's most sensitive view must not be reachable by query alone.
    await expectGate(
      await page.request.get(`${TRACES}?serverSessionId=all&limit=2000&sort=asc`),
      GATE.traces,
      'GET /api/v1/dev/traces?serverSessionId=all (anonymous)',
    );

    await expectGate(
      await page.request.post(SIMULATE, { data: { email: studentEmail() } }),
      GATE.simulate,
      'POST /api/v1/dev/study-simulate (anonymous)',
    );
  });

  test('a signed-in tenant user does not unlock the dev endpoints', async ({ page }) => {
    await loginAs(page, TENANT, 'student', { waitFor: /\/app(\/|$)/ });

    // Control: the session is real, so a 403/404 below is the environment gate,
    // not a missing/ignored session.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status(), 'GET /api/v1/auth/me with the seeded session').toBe(200);
    const meBody = (await me.json()) as { data: { user: { id: string; email: string } | null } };
    expect(meBody.data.user?.id, 'the session belongs to the tenant student').toBe(
      TENANT.users.student?.id,
    );

    await expectGate(
      await page.request.get(TRACES),
      GATE.traces,
      'GET /api/v1/dev/traces (signed in)',
    );

    await expectGate(
      await page.request.post(SIMULATE, { data: { email: studentEmail() } }),
      GATE.simulate,
      'POST /api/v1/dev/study-simulate (signed in)',
    );
  });
});
