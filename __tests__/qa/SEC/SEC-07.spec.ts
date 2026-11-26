import { expect, test, type Page } from '@playwright/test';
import { asJson, json } from '#test/helpers/json';
import { createQaSupabase } from '#test/helpers/db-admin';
import { loadTenant, loginAs, tenantUser, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * SEC-07 — Manager nie korzysta z API AI.
 *
 * Case: `POST /api/v1/ai/chat` with a correct body → **403 `FORBIDDEN`**; the AI
 * API requires the `ai.chat` entitlement (ADR-0015 §7), which this tenant's
 * `launch` org plan does not carry (`max_ai_tokens_per_day = 0` there, so the
 * resolver never makes the key effective for an org-layer caller either).
 *
 * Tenant: the legacy prerequisite `manager@dev.local` is not used.
 * `bun scripts/qa-tenant.ts SEC-07 --fresh` seeds the default `content` profile
 * (no profile file: `content` is the seeder's default), which gives this case
 * exactly the accounts it needs — `manager` (the subject), `teacher` and
 * `student`, all inside one organization whose default group keeps the graph
 * realistic. Every id is read from `qa/.tenants/SEC-07.json`; the conversation
 * id carries the run suffix so two runs never share a row name.
 *
 * Walk (rewritten 2026-11-22 for phase 5a — the served-build run of this spec is
 * the coordinator's gate, not this file's claim):
 * 1. `GET /api/v1/me/entitlements` as the tenant manager → `200`, and `ai.chat` is
 *    **not** in `data.entitlements` — the 403 below is the entitlement gate, not a
 *    persona rule.
 * 2. `POST /api/v1/ai/chat` with a valid UI-message body as the tenant manager →
 *    `403`, `x-error-code: FORBIDDEN`, body exactly
 *    `{"success":false,"error":"FORBIDDEN"}` — no stream, no `data`.
 * 3. The same route with `{}` and with malformed JSON → still `403`, never `400`:
 *    `requireEntitlement(ctx, 'ai.chat')` is the first statement of the handler,
 *    before the body is read or validated (the handler's `400 BAD_REQUEST` is
 *    unreachable without the entitlement).
 * 4. `GET /api/v1/ai/usage` (the counter the chat route reports into; same
 *    `ai.chat` entitlement) → `403` as well.
 * 5. Anonymous `POST` → `401 UNAUTHORIZED`, so the manager's `403` is an
 *    authorization boundary and not "no session".
 * 6. The teacher (personal `base` inside the same `launch` org) is refused for
 *    the same reason: `/me/entitlements` without `ai.chat`, and the same empty body
 *    → `403`. The refusal is a plan boundary, not a manager-specific rule.
 * 7. Positive control by plan, not persona: the student's
 *    `profiles.personal_plan_key` is set to the paid `ace` (Pro) plan through the
 *    service-role client (`ai.chat` is `personalPortable`, so the key carries
 *    inside the org even though `launch` does not grant it; D3). The same
 *    launch-org student then has `ai.chat` in `/me/entitlements`, reads
 *    `/api/v1/ai/usage` → `200` with `limit === 250000` (`plan` stays `launch`:
 *    the effective primary is the org plan), and the same empty body reaches
 *    the handler → `400 BAD_REQUEST`. The plan key is restored in a `finally`
 *    block so a CI retry on the same tenant starts clean.
 * 8. `user_daily_activity` for the manager has **0** AI tokens for today: the
 *    refused calls metered nothing, so the case protects the AI budget too.
 *
 * No model is called anywhere in this spec: the entitlement gate refuses the
 * manager and the teacher before the body is parsed, and the student control
 * stops at the handler's `400`, so the case needs neither a real provider nor
 * the fake inference server.
 *
 * Mutation (proves this spec can fail): delete the
 * `await requireEntitlement(ctx, 'ai.chat')` line from the chat route (a
 * plausible "the plan check is enough" cleanup). Result on the mutant build:
 * the manager reaches the handler — `POST /api/v1/ai/chat` with a correct body
 * answers `429` `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}` (their quota
 * is 0 on `launch`), and with an invalid body `400` `BAD_REQUEST`; both expected
 * 403, so the spec goes red. Conversely, a build whose resolver returns no
 * entitlements at all fails the student control in step 7 (`/me/entitlements`
 * without `ai.chat`, `ai/usage` 403), so the case cannot pass on an empty
 * resolution either.
 */

const CASE = 'SEC-07';

const AI_CHAT = '/api/v1/ai/chat';
const AI_USAGE = '/api/v1/ai/usage';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface AiUsage {
  current: number;
  limit: number;
  plan: string;
}

interface CallResult {
  status: number;
  errorCode: string | null;
  body: string;
}

/**
 * The seeded fixture must be the shape this case needs: one organization, a
 * manager for the subject, and the teacher and student for the plan-boundary
 * controls.
 */
function loadCaseTenant(): QaTenant {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
  for (const role of ['manager', 'teacher', 'student'] as const) {
    expect(tenantUser(tenant, role).id, `${CASE} tenant has a seeded ${role}`).toBeTruthy();
  }
  return tenant;
}

/** A fresh session for one tenant user; cookies are cleared so roles never overlap. */
async function switchUser(
  page: Page,
  tenant: QaTenant,
  role: 'manager' | 'teacher' | 'student',
): Promise<void> {
  await page.context().clearCookies();
  await loginAs(page, tenant, role, {
    locale: 'pl',
    waitFor:
      role === 'manager' ? /\/manage(\/|$)/ : role === 'teacher' ? /\/edu(\/|$)/ : /\/app(\/|$)/,
  });
}

/** The request the case describes: one user message, the shape the chat UI sends. */
function chatBody(conversationId: string): string {
  return JSON.stringify({
    messages: [
      {
        id: conversationId,
        role: 'user',
        parts: [{ type: 'text', text: 'Wyjaśnij pojęcie fotosyntezy' }],
      },
    ],
  });
}

async function postChat(page: Page, body: string): Promise<CallResult> {
  const response = await page.request.post(AI_CHAT, {
    headers: { 'content-type': 'application/json' },
    data: body,
  });
  return {
    status: response.status(),
    errorCode: response.headers()['x-error-code'] ?? null,
    body: await response.text(),
  };
}

/**
 * The rejection: 403 with the `FORBIDDEN` code and an envelope that carries no
 * stream and no payload — a refused caller must not get a chat.
 */
function expectForbidden(result: CallResult, label: string): void {
  expect(result.status, `${label}: HTTP status → ${result.body}`).toBe(403);
  expect(result.errorCode, `${label}: x-error-code header`).toBe('FORBIDDEN');
  expect(JSON.parse(result.body), `${label}: response envelope`).toEqual({
    success: false,
    error: 'FORBIDDEN',
  });
}

/** The gate let the caller through: the handler's own validation answers. */
function expectReachedHandler(result: CallResult, label: string): void {
  expect(result.status, `${label}: HTTP status → ${result.body}`).toBe(400);
  expect(result.errorCode, `${label}: x-error-code header`).toBe('BAD_REQUEST');
}

test.describe('@case:SEC-07 @area:SEC @prio:P2 manager has no AI chat API', () => {
  test('the manager is refused the AI chat and the AI usage counter', async ({ page, request }) => {
    test.setTimeout(120_000);

    const tenant = loadCaseTenant();
    const manager = tenantUser(tenant, 'manager');
    const student = tenantUser(tenant, 'student');
    const conversationId = `sec-07-${tenant.runSuffix ?? tenant.key.slice(-8)}-manager`;
    const body = chatBody(conversationId);
    const db = createQaSupabase();

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(`SEC-07 tenant key: ${tenant.key} (manager ${manager.email})`);

    // --- Preconditions: the caller is a manager with a real session --------
    await switchUser(page, tenant, 'manager');

    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status(), 'GET /api/v1/auth/me as the manager').toBe(200);
    const meBody = await json<{
      data?: { user?: { id?: string; app_metadata?: { account_type?: string } } };
    }>(me);
    expect(meBody.data?.user?.id, 'the signed-in user is the case subject').toBe(manager.id);
    expect(meBody.data?.user?.app_metadata?.account_type, 'the case subject is a manager').toBe(
      'manager',
    );

    // --- Precondition: the entitlement, not the persona, is the reason ------
    // The tenant org is on `launch`, which carries no `ai.chat` (and
    // `max_ai_tokens_per_day = 0`), and the manager's personal `base` plan
    // carries none either, so the resolver never makes the key effective:
    // `/me/entitlements` does not list it. This is what makes the 403 below the
    // entitlement gate and not an account-type rule.
    const entitlementsResponse = await page.request.get('/api/v1/me/entitlements');
    expect(entitlementsResponse.status(), 'GET /api/v1/me/entitlements as the manager').toBe(200);
    const entitlementsBody = await json<{ data: { entitlements: string[] } }>(entitlementsResponse);
    expect(
      entitlementsBody.data.entitlements,
      'the launch org does not resolve ai.chat',
    ).not.toContain('ai.chat');

    // --- Step 1: the case's one step --------------------------------------
    expectForbidden(
      await postChat(page, body),
      'POST /api/v1/ai/chat with a correct body as the manager',
    );

    // The entitlement gate is the first statement of the handler, before the
    // body is read: an empty and a malformed body are both 403, never the
    // handler's 400.
    expectForbidden(
      await postChat(page, JSON.stringify({})),
      'POST /api/v1/ai/chat with an invalid body as the manager',
    );
    expectForbidden(
      await postChat(page, 'not json'),
      'POST /api/v1/ai/chat with a malformed body as the manager',
    );

    // --- Adjacent: the same entitlement on the AI surface -------------------
    const usageResponse = await page.request.get(AI_USAGE);
    const usageBody = await usageResponse.text();
    expect(usageResponse.status(), `GET /api/v1/ai/usage as the manager → ${usageBody}`).toBe(403);
    expect(usageResponse.headers()['x-error-code'], 'GET /api/v1/ai/usage x-error-code').toBe(
      'FORBIDDEN',
    );

    // --- No session is not the reason: anonymous is 401, not 403 ----------
    const anonymous = await request.post(AI_CHAT, {
      headers: { 'content-type': 'application/json' },
      data: body,
    });
    expect(anonymous.status(), 'POST /api/v1/ai/chat without a session').toBe(401);
    expect(anonymous.headers()['x-error-code'], 'anonymous x-error-code').toBe('UNAUTHORIZED');

    // --- The refusal is not manager-specific: the teacher is refused too ----
    // Same org (`launch`), personal plan `base` — no `ai.chat` there either, so
    // the same empty body gets the gate's 403, not the handler's 400.
    await switchUser(page, tenant, 'teacher');
    const teacherEntitlements = await page.request.get('/api/v1/me/entitlements');
    expect(teacherEntitlements.status(), 'GET /api/v1/me/entitlements as the teacher').toBe(200);
    const teacherEntitlementsBody = await json<{ data: { entitlements: string[] } }>(
      teacherEntitlements,
    );
    expect(
      teacherEntitlementsBody.data.entitlements,
      'the base personal plan does not resolve ai.chat',
    ).not.toContain('ai.chat');
    expectForbidden(
      await postChat(page, JSON.stringify({})),
      'POST /api/v1/ai/chat as the educator on base',
    );

    // --- Positive control by plan, not persona: the student on Pro ----------
    // `ace` carries `ai.chat` and `max_ai_tokens_per_day = 250000`, and
    // `ai.chat` is `personalPortable`, so the paid personal plan carries inside
    // the `launch` org (D3) even though the org plan does not grant it. The
    // update goes through the service-role client the spec already builds and
    // is restored in `finally`, so a CI retry on the same tenant starts clean.
    const originalPlanRow = await db
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', student.id)
      .maybeSingle();
    expect(originalPlanRow.error, 'reading the tenant student’s personal plan').toBeNull();
    const originalPlan = asJson<string | null>(originalPlanRow.data?.personal_plan_key) ?? 'base';

    try {
      const setup = await db
        .from('profiles')
        .update({ personal_plan_key: 'ace' })
        .eq('id', student.id);
      expect(setup.error, 'move the tenant student to the paid Pro plan').toBeNull();

      await switchUser(page, tenant, 'student');

      const studentEntitlements = await page.request.get('/api/v1/me/entitlements');
      expect(
        studentEntitlements.status(),
        'GET /api/v1/me/entitlements as the student on Pro',
      ).toBe(200);
      const studentEntitlementsBody = await json<{ data: { entitlements: string[] } }>(
        studentEntitlements,
      );
      expect(
        studentEntitlementsBody.data.entitlements,
        'the Pro personal plan resolves ai.chat inside the launch org',
      ).toContain('ai.chat');

      const studentUsage = await page.request.get(AI_USAGE);
      expect(studentUsage.status(), 'GET /api/v1/ai/usage as the student on Pro').toBe(200);
      const studentUsageBody = await json<Envelope<AiUsage>>(studentUsage);
      expect(studentUsageBody.success).toBe(true);
      // The effective primary is the org plan (`launch`); the limit is the
      // user-scope max(org `launch` 0, personal `ace` 250000) = 250000.
      expect(studentUsageBody.data, 'the paid personal plan lifts the AI budget').toMatchObject({
        current: expect.any(Number),
        limit: 250_000,
        plan: 'launch',
      });

      // The entitlement gate let the student through: the handler's own
      // validation answers. A valid body is never sent — no model may run here.
      expectReachedHandler(
        await postChat(page, JSON.stringify({})),
        'POST /api/v1/ai/chat as the student on Pro',
      );
    } finally {
      const restore = await db
        .from('profiles')
        .update({ personal_plan_key: originalPlan })
        .eq('id', student.id);
      expect(restore.error, 'restore the tenant student’s seeded personal plan').toBeNull();
    }

    // --- The manager's refusal metered no AI tokens -----------------------
    // `limits.trackTokenUsage` meters into `user_daily_activity` for the calling user;
    // a request refused before the handler cannot have written there.
    const today = new Date().toISOString().slice(0, 10);
    const activity = await db
      .from('user_daily_activity')
      .select('ai_input_tokens, ai_output_tokens')
      .eq('user_id', manager.id)
      .eq('date', today)
      .maybeSingle();
    expect(activity.error, 'reading the manager’s daily activity row').toBeNull();
    expect(
      (activity.data?.ai_input_tokens ?? 0) + (activity.data?.ai_output_tokens ?? 0),
      'the refused manager calls metered no AI tokens',
    ).toBe(0);
  });
});
