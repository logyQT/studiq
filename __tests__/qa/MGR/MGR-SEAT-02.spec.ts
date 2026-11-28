import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import {
  loadTenant,
  loginAs,
  tenantUser,
  type QaRole,
  type QaTenant,
} from '#test/qa/fixtures/tenant';

/**
 * MGR-SEAT-02 — assigning a seat to a member.
 *
 * A pool is a licence since #1511: one licence plan (`ai_lite`/`ai_pro`/
 * `ai_max`), `ai.chat` only, one daily quota row, sold on the `seat_pool`
 * channel. A licence seat grants its own keys and the organization ceiling no
 * longer intersects it (D38), so a seat adds AI and the tier quota and nothing
 * else — no content limit, no non-AI feature.
 *
 * `/manage/seats` shows the three licence tiers, the pools and assignments
 * tables, and the assign and release controls. The purchase action is not on the
 * page yet, so this case drives the assignment through the API and checks what
 * a seat changes: the member's effective plan and user-scope limits.
 *
 * Tenant: `__tests__/qa/profiles/MGR-SEAT-02.json` declares the `content` profile
 * on the `hub` plan with an explicit roster (manager `admin`, teacher, `student`
 * and `student2`, both `member`) and `personalPlan: "plus"`, so every non-manager
 * member carries the portable `ai.chat` and `quiz.templates` into the org
 * (`personalPortable`) on top of the Hub ceiling. A manager holds no personal
 * plan (ADR-0007), so the seeder leaves the manager out of that write:
 *
 *   bun scripts/qa-tenant.ts MGR-SEAT-02 --fresh
 *
 * The spec provisions one pool per licence tier — Lite ×1, Pro ×3, Max ×2 —
 * clears any assignment a previous run left behind, and assigns the **`ai_pro`**
 * seat to `student` through the API. The Pro tier is the one that shows a seat
 * at work: its 300 000/day differs from the member's 100 000 Plus quota, so the
 * assertion reads the licence, not the personal plan. Nothing global is written.
 *
 * Acceptance points:
 * 1. `/manage/seats` renders the three licence tiers with their prices and the
 *    assign and release controls, and no purchase control.
 * 2. The assignment appears in „Przydziały” under the friendly licence name,
 *    the Pro pool (3 seats) moves from 3/0/3 to 3/1/2, and the other pools keep
 *    their counters.
 * 3. The seated member's `/me/plan` is the licence `ai_pro`; the user-scope
 *    limits resolve `max(org, seat, personal)`: `max_ai_tokens_per_day` is
 *    300 000 (the tier quota, over Plus 100 000 and Hub's absent AI row) and
 *    `max_flashcards` stays 5 000 (Hub; the licence carries no content limit).
 *    The keys are the learner profile's two on Hub plus the personal Plus
 *    portables — no `stats.insights`, because a seat is not intersected with the
 *    ceiling (D38).
 * 4. The unseated control (`student2`) keeps Plus: AI 100 000, `max_flashcards`
 *    5 000 — the seat is per-member.
 * 5. The server-side guards still hold: a second seat for the same member is
 *    429 `USAGE_LIMIT_EXCEEDED`, and another member accepts a pool (201).
 *
 * Mutation (proves this spec can fail): `subscription-plan.service.ts#getMyPlan`,
 * `planKey = sources.seat.planKey` → `planKey = null`, rebuilt and served. The
 * spec failed on `the seat is the effective plan`: Expected "ai_pro", Received
 * "plus". Result: KILLED. Reverted, rebuilt, green again.
 */

const CASE = 'MGR-SEAT-02';

const POOLS = [
  { planKey: 'ai_lite', quantity: 1 },
  { planKey: 'ai_pro', quantity: 3 },
  { planKey: 'ai_max', quantity: 2 },
] as const;

const SEAT_PLAN_KEY = 'ai_pro';
const SEAT_PLAN_NAME = 'StudiQ AI Pro';

interface Pool {
  id: string;
  planKey: string;
  total: number;
  assigned: number;
}

interface Assignment {
  id: string;
  userId: string;
  poolId: string;
  planKey: string;
  userEmail: string;
  userFullName: string | null;
  assignedAt: string;
}

interface PlanInfo {
  key: string;
  name: string;
  features: string[];
  limits: Record<string, number>;
}

interface ApiBody<T> {
  success: boolean;
  data: T;
  error?: string;
}

/** Real login, then wait until the dashboard has resolved `/me/entitlements`. */
async function signIn(page: Page, tenant: QaTenant, role: QaRole, landing: RegExp): Promise<void> {
  const entitlementsResolved = page.waitForResponse(
    (res) => res.url().includes('/api/v1/me/entitlements'),
    { timeout: 20_000 },
  );
  await loginAs(page, tenant, role, { locale: 'pl', waitFor: landing });
  await entitlementsResolved;
  await page.waitForLoadState('networkidle');
}

function userId(tenant: QaTenant, role: QaRole): string {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user.id;
}

async function readEnvelope<T>(response: APIResponse): Promise<ApiBody<T>> {
  expect(response.status(), `${response.url()} answered ${response.status()}`).toBeLessThan(400);
  return json<ApiBody<T>>(response);
}

/** Clear every assignment a previous run on this tenant left behind. */
async function resetSeats(page: Page): Promise<void> {
  const assignments = (
    await readEnvelope<Assignment[]>(
      await page.request.get('/api/v1/organization/seats/assignments'),
    )
  ).data;
  for (const assignment of assignments) {
    const response = await page.request.delete(
      `/api/v1/organization/seats/assignments/${assignment.id}`,
    );
    expect(response.status(), `DELETE assignment ${assignment.id}`).toBe(200);
  }
}

/** One pool per licence tier, at exactly the case's quantity and unassigned. */
async function ensurePool(page: Page, entry: (typeof POOLS)[number]): Promise<Pool> {
  const existing = (
    await readEnvelope<Pool[]>(await page.request.get('/api/v1/organization/seats/pools'))
  ).data.find((pool) => pool.planKey === entry.planKey);
  const response = existing
    ? await page.request.put(`/api/v1/organization/seats/pools/${existing.id}`, {
        data: { total: entry.quantity },
      })
    : await page.request.post('/api/v1/organization/seats/pools', {
        data: { planKey: entry.planKey, quantity: entry.quantity },
      });
  const body = await readEnvelope<Pool>(response);
  expect(body.data, `pool ${entry.planKey}`).toMatchObject({
    planKey: entry.planKey,
    total: entry.quantity,
    assigned: 0,
  });
  return body.data;
}

async function signOut(page: Page): Promise<void> {
  const response = await page.request.post('/api/v1/auth/logout');
  expect(response.status(), 'POST /api/v1/auth/logout').toBe(200);
}

async function entitlements(page: Page): Promise<string[]> {
  return (
    await readEnvelope<{ entitlements: string[] }>(
      await page.request.get('/api/v1/me/entitlements'),
    )
  ).data.entitlements;
}

async function planOf(page: Page): Promise<PlanInfo> {
  return (await readEnvelope<PlanInfo>(await page.request.get('/api/v1/me/plan'))).data;
}

async function usage(page: Page): Promise<{ limit: number; plan: string }> {
  return (
    await readEnvelope<{ limit: number; plan: string }>(await page.request.get('/api/v1/ai/usage'))
  ).data;
}

test.describe('@case:MGR-SEAT-02 @area:MGR @prio:P2 assigning a seat to a member', () => {
  test('the seat surface renders the tiers and the API still raises the member plan and limits', async ({
    page,
    request,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.plan, `${CASE} needs its tenant org on the hub plan`).toBe('hub');
    expect(tenant.personalPlan, `${CASE} needs the personal Plus plan`).toBe('plus');
    expect(tenant.org, `${CASE} needs the seeded organization`).toBeTruthy();
    for (const role of ['manager', 'teacher', 'student', 'student2'] as const) {
      expect(tenant.users[role], `${CASE} needs the seeded ${role}`).toBeTruthy();
    }

    // The org and personal plans are on the public catalogue the numbers below
    // are derived from. The licence tiers are not: that read filters to the
    // `individual` channel, so the page reads them from
    // `GET /organization/seats/licence-plans`.
    const catalog = (
      await readEnvelope<PlanInfo[]>(await request.get('/api/v1/subscription-plans'))
    ).data;
    const plan = (key: string): PlanInfo => {
      const found = catalog.find((entry) => entry.key === key);
      if (!found) throw new Error(`subscription-plans: no ${key} plan in the catalog`);
      return found;
    };
    const hub = plan('hub');
    const plus = plan('plus');

    // Catalog facts the expectations below rest on: the Hub ceiling carries the
    // saved quiz library and insights but no AI row, and Plus carries the
    // portable AI key and a 100 000/day quota.
    expect(hub.features.toSorted(), 'catalog: Hub carries the cumulative set').toEqual([
      'flashcards',
      'quiz',
      'quiz.templates',
      'stats.insights',
    ]);
    expect(hub.limits.max_ai_tokens_per_day, 'catalog: Hub carries no AI quota').toBeUndefined();
    expect(plus.features, 'catalog: Plus carries ai.chat').toContain('ai.chat');
    expect(plus.features, 'catalog: Plus carries quiz.templates').toContain('quiz.templates');
    expect(plus.limits.max_ai_tokens_per_day, 'catalog: Plus AI budget').toBe(100_000);

    // ── The seat surface ─────────────────────────────────────────────────────
    await signIn(page, tenant, 'manager', /\/manage$/);
    await resetSeats(page);
    const pools = new Map<string, Pool>();
    for (const entry of POOLS) {
      pools.set(entry.planKey, await ensurePool(page, entry));
    }

    await page.locator('a[href="/manage/seats"]').first().click();
    await expect(page).toHaveURL(/\/manage\/seats$/);
    await expect(page.getByRole('heading', { name: 'Licencje miejsc', exact: true })).toBeVisible();
    await expect(page.getByText('Pule miejsc')).toBeVisible();
    await expect(page.getByText('Przydziały')).toBeVisible();

    // The tier cards are the licence comparison; purchase is not on the page yet.
    for (const [name, price] of [
      ['StudiQ AI Lite', /19,99/],
      ['StudiQ AI Pro', /39,99/],
      ['StudiQ AI Max', /79,99/],
    ] as const) {
      const card = page.locator('section#licence-tiers li').filter({ hasText: name });
      await expect(card, `the ${name} tier card`).toHaveCount(1);
      await expect(card).toContainText(price);
    }
    await expect(page.getByRole('button', { name: 'Kup miejsca' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Przydziel miejsce' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // ── Step 1: assign through the API --------------------------------------
    const created = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'student'), poolId: pools.get(SEAT_PLAN_KEY)!.id },
    });
    expect(created.status(), `POST assignment ${await created.text()}`).toBe(201);

    const assignments = (
      await readEnvelope<Assignment[]>(
        await page.request.get('/api/v1/organization/seats/assignments'),
      )
    ).data;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      userId: userId(tenant, 'student'),
      poolId: pools.get(SEAT_PLAN_KEY)!.id,
      planKey: SEAT_PLAN_KEY,
      userEmail: tenantUser(tenant, 'student').email,
    });
    const poolsAfter = (
      await readEnvelope<Pool[]>(await page.request.get('/api/v1/organization/seats/pools'))
    ).data;
    expect(poolsAfter.map((pool) => [pool.planKey, pool.assigned]).toSorted()).toEqual(
      [
        ['ai_lite', 0],
        ['ai_max', 0],
        ['ai_pro', 1],
      ].toSorted(),
    );

    // The table renders the new assignment under the friendly licence name,
    // with the release control.
    await page.reload();
    const assignmentTable = page.locator('table').nth(1);
    await expect(assignmentTable.locator('tbody tr')).toHaveCount(1);
    // The row shows the member's full name when the profile carries one, else the e-mail.
    await expect(assignmentTable.locator('tbody tr').first()).toContainText(
      assignments[0]?.userFullName || tenantUser(tenant, 'student').email,
    );
    await expect(assignmentTable.locator('tbody tr').first()).toContainText(SEAT_PLAN_NAME);
    await expect(page.getByLabel('Zwolnij miejsce')).toHaveCount(1);

    // 5. Server-side guards: one seat per member, and a pool accepts any member
    //    because a personal plan carries no audience.
    const duplicate = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'student'), poolId: pools.get(SEAT_PLAN_KEY)!.id },
    });
    expect(duplicate.status(), 'second seat for the same member').toBe(429);
    expect(await duplicate.json()).toMatchObject({
      success: false,
      error: 'USAGE_LIMIT_EXCEEDED',
    });

    const crossPersona = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'teacher'), poolId: pools.get('ai_max')!.id },
    });
    expect(crossPersona.status(), 'an educator accepts a licence pool').toBe(201);

    // ── Step 2: the seated member's effective plan and limits ────────────────
    await signOut(page);
    await signIn(page, tenant, 'student', /\/app$/);

    // The learner profile grants `flashcards`/`quiz` from the Hub ceiling; Plus
    // adds its portable `ai.chat`/`quiz.templates`; the seat adds `ai.chat`,
    // which Plus already carries. A seat is not intersected with the ceiling and
    // carries no content or insight key, so `stats.insights` stays absent (D38).
    const memberKeys = ['ai.chat', 'flashcards', 'quiz', 'quiz.templates'];
    expect(
      (await entitlements(page)).toSorted(),
      'the licence adds no key beyond the profile and the personal plan',
    ).toEqual(memberKeys.toSorted());

    const memberPlan = await planOf(page);
    expect(memberPlan.key, 'the seat is the effective plan').toBe(SEAT_PLAN_KEY);
    expect(memberPlan.limits.max_flashcards, 'the licence carries no content limit: Hub wins').toBe(
      5_000,
    );
    expect(
      memberPlan.limits.max_ai_tokens_per_day,
      'max(Hub 0, Pro seat 300000, Plus 100000)',
    ).toBe(300_000);

    const afterUsage = await usage(page);
    expect(afterUsage.limit, 'the seat sets the AI budget').toBe(300_000);
    expect(afterUsage.plan, 'the effective primary stays the org plan').toBe('hub');

    // ── The control member: the seat is per-member, not org-wide ─────────────
    await signOut(page);
    await signIn(page, tenant, 'student2', /\/app$/);

    expect(
      (await entitlements(page)).toSorted(),
      'the unseated control keeps its personal keys',
    ).toEqual(memberKeys.toSorted());
    const controlPlan = await planOf(page);
    expect(controlPlan.key, 'the unseated member resolves their personal plan').toBe('plus');
    expect(controlPlan.limits.max_flashcards, 'the hub floor stays above Plus').toBe(5_000);
    expect(controlPlan.limits.max_ai_tokens_per_day, 'no seat: the Plus AI budget').toBe(100_000);
    expect((await usage(page)).limit).toBe(100_000);

    expect(pageErrors, 'uncaught page errors while assigning and using the seat').toEqual([]);
  });
});
