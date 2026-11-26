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
 * The organization ladder is capacity only since #1493 and seats are frozen at
 * the UI: `/manage/seats` keeps the pools and assignments tables and every `GET`,
 * but hides the purchase, assign and release entries. The API routes stay — they
 * are the data path #1511 builds on — so this case drives the assignment through
 * the API and checks what a seat still changes: the member's effective plan and
 * user-scope limits.
 *
 * Tenant: `__tests__/qa/profiles/MGR-SEAT-02.json` declares the `content` profile
 * on the `hub` plan with an explicit roster (manager `admin`, teacher, `student`
 * and `student2`, both `member`) and `personalPlan: "plus"`, so every member
 * carries `ai.chat` and `quiz.templates` into the org (`personalPortable`):
 *
 *   bun scripts/qa-tenant.ts MGR-SEAT-02 --fresh
 *
 * The spec provisions the pools through the product API — Free ×1, Plus ×3, Pro
 * ×3, Max ×2 — clears any assignment a previous run left behind, and assigns the
 * **`max`** seat to `student` through the same API. Nothing global is written.
 *
 * Acceptance points:
 * 1. `/manage/seats` renders both tables and no purchase, assign or release
 *    control (the B2 freeze).
 * 2. The assignment appears in „Przydziały”, the Max pool (`max`, 2 seats) moves
 *    from 2/0/2 to 2/1/1, and the other pools keep their counters.
 * 3. The seated member's `/me/plan` is the seat plan `max`; the user-scope
 *    limits resolve `max(org, seat, personal)`, so `max_flashcards` is 25000 and
 *    `max_ai_tokens_per_day` is 500000. The org ceiling adds no paid key, so the
 *    member's entitlements are the personal plan's portable keys plus the two
 *    baseline keys, before and after the seat.
 * 4. The unseated control member (`student2`) keeps their personal plan and the
 *    hub floor (`max_flashcards` 2000, AI 100000): the seat is per-member.
 * 5. The server-side guards still hold: a second seat for the same member is
 *    429 `USAGE_LIMIT_EXCEEDED`, and another member accepts any pool (201).
 */

const CASE = 'MGR-SEAT-02';

const POOLS = [
  { planKey: 'free', quantity: 1 },
  { planKey: 'plus', quantity: 3 },
  { planKey: 'pro', quantity: 3 },
  { planKey: 'max', quantity: 2 },
] as const;

const SEAT_PLAN_KEY = 'max';

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

/** One pool per individual plan, at exactly the case's quantity and unassigned. */
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
  test('the frozen seat surface keeps its tables and the API still raises the member plan and limits', async ({
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

    // The seat plans are shared catalog data: read them, never write them.
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
    const max = plan(SEAT_PLAN_KEY);

    // Catalog facts the story leans on: the org ceiling is baseline only, and
    // the personal Plus plan carries the portable paid keys.
    expect(hub.features.toSorted(), 'catalog: Hub is capacity only').toEqual([
      'flashcards',
      'quiz',
    ]);
    expect(hub.limits.max_ai_tokens_per_day, 'catalog: Hub carries no AI quota').toBeUndefined();
    expect(plus.features, 'catalog: Plus carries ai.chat').toContain('ai.chat');
    expect(plus.features, 'catalog: Plus carries quiz.templates').toContain('quiz.templates');
    expect(max.features, 'catalog: Max raises the AI budget').toContain('stats.insights');
    expect(max.limits.max_ai_tokens_per_day, 'catalog: Max AI budget').toBe(500_000);
    expect(plus.limits.max_ai_tokens_per_day, 'catalog: Plus AI budget').toBe(100_000);

    // ── The read-only surface ────────────────────────────────────────────────
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

    // The B2 freeze: the data is visible, the sale and assignment are not.
    for (const control of ['Kup miejsca', 'Przydziel miejsce']) {
      await expect(page.getByRole('button', { name: control }), `${control} is hidden`).toHaveCount(
        0,
      );
    }
    await expect(page.getByLabel('Zwolnij miejsce')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // ── Step 1: assign through the API the page no longer exposes ────────────
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
        ['free', 0],
        ['plus', 0],
        ['pro', 0],
        ['max', 1],
      ].toSorted(),
    );

    // The table renders the new assignment; the release control stays hidden.
    await page.reload();
    const assignmentTable = page.locator('table').nth(1);
    await expect(assignmentTable.locator('tbody tr')).toHaveCount(1);
    // The row shows the member's full name when the profile carries one, else the e-mail.
    await expect(assignmentTable.locator('tbody tr').first()).toContainText(
      assignments[0]?.userFullName || tenantUser(tenant, 'student').email,
    );
    await expect(assignmentTable.locator('tbody tr').first()).toContainText(max.name);
    await expect(page.getByLabel('Zwolnij miejsce')).toHaveCount(0);

    // 5. Server-side guards behind the removed UI: one seat per member, and a
    //    pool accepts any member because a personal plan carries no audience.
    const duplicate = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'student'), poolId: pools.get(SEAT_PLAN_KEY)!.id },
    });
    expect(duplicate.status(), 'second seat for the same member').toBe(429);
    expect(await duplicate.json()).toMatchObject({
      success: false,
      error: 'USAGE_LIMIT_EXCEEDED',
    });

    const crossPersona = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'teacher'), poolId: pools.get('free')!.id },
    });
    expect(crossPersona.status(), 'an educator accepts a personal-plan pool').toBe(201);

    // ── Step 2: the seated member's effective plan and limits ────────────────
    await signOut(page);
    await signIn(page, tenant, 'student', /\/app$/);

    const expectedKeys = ['ai.chat', 'flashcards', 'quiz', 'quiz.templates'];
    expect(
      (await entitlements(page)).toSorted(),
      'the personal plan carries the paid keys',
    ).toEqual(expectedKeys.toSorted());

    const memberPlan = await planOf(page);
    expect(memberPlan.key, 'the seat is the effective plan').toBe(SEAT_PLAN_KEY);
    expect(memberPlan.limits.max_flashcards, 'max(hub 2000, seat 25000, plus 1000)').toBe(25_000);
    expect(memberPlan.limits.max_ai_tokens_per_day, 'max(0, seat 500000, plus 100000)').toBe(
      500_000,
    );

    const afterUsage = await usage(page);
    expect(afterUsage.limit, 'the seat raises the AI limit').toBe(500_000);
    expect(afterUsage.plan, 'the effective primary stays the org plan').toBe('hub');

    // ── The control member: the seat is per-member, not org-wide ─────────────
    await signOut(page);
    await signIn(page, tenant, 'student2', /\/app$/);

    expect(
      (await entitlements(page)).toSorted(),
      'the unseated control keeps its personal keys',
    ).toEqual(expectedKeys.toSorted());
    const controlPlan = await planOf(page);
    expect(controlPlan.key, 'the unseated member resolves their personal plan').toBe('plus');
    expect(controlPlan.limits.max_flashcards, 'the hub floor stays above Plus').toBe(2_000);
    expect(controlPlan.limits.max_ai_tokens_per_day, 'no seat: the Plus AI budget').toBe(100_000);
    expect((await usage(page)).limit).toBe(100_000);

    expect(pageErrors, 'uncaught page errors while assigning and using the seat').toEqual([]);
  });
});
