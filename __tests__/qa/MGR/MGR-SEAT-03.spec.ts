import { expect, type Page } from '@playwright/test';
import { asJson } from '#test/helpers/json';
import { loadTenant, loginAs, test, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * MGR-SEAT-03 — zwolnienie miejsca (`/manage/seats`).
 *
 * Case step: „Zwolnij miejsce przyciskiem przy przydziale.”
 * Expected: the member returns to the free plan and the pool's available
 * counter grows.
 *
 * `/manage/seats` shows the three licence tiers and the assign and release
 * controls. The purchase action is not on the page yet, so the release is
 * driven through the same `DELETE` the release button sends.
 *
 * Tenant (deterministic, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts MGR-SEAT-03 --fresh
 *
 * The legacy prerequisite „Istniejący przydział” names a manual account; in the
 * tenant model it is this case's own `content` tenant: the manager (org `admin`)
 * plus two org members, `users.student` (the member under test) and
 * `users.student2` (the untouched control). A fresh organization has **no** seat
 * pools — `plan_seat_allocations` was dropped — so the spec buys one licence
 * pool (`ai_max`, 2 seats) and assigns both members through the product's own
 * API. That setup is idempotent, so a repeated run in the same tenant starts from
 * the case's prerequisite state again.
 *
 * Every id comes from the tenant fixture (`tenantKey`/`tenantId`); the spec reads
 * and writes only its own tenant's org, members and seat rows. The pool and
 * assignment rows show the friendly licence name the page resolves from
 * `GET /organization/seats/licence-plans`.
 */

const CASE = 'MGR-SEAT-03';

/**
 * Licence tier the pool is bought on; both seated members hold the org `member`
 * role.
 */
const SEAT_PLAN_KEY = 'ai_max';
const SEAT_PLAN_NAME = 'StudiQ AI Max';
const POOL_SEATS = 2;

/** Polish copy from `ManageSeatsPage` (`apps/web/src/i18n/messages/pl.json`). */
const COPY = {
  poolsTitle: 'Pule miejsc',
  assignmentsTitle: 'Przydziały',
  purchasedColumn: 'Wykupione',
  assignedColumn: 'Przydzielone',
  availableColumn: 'Dostępne',
} as const;

const POOLS_URL = '/api/v1/organization/seats/pools';
const ASSIGNMENTS_URL = '/api/v1/organization/seats/assignments';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

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
}

interface OrgMember {
  id: string;
  email: string;
  orgRoleName: string;
  accountType: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** One request with the page's session cookies; the envelope is asserted to be a success. */
async function call<T>(
  page: Page,
  url: string,
  init: { method?: Method; data?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const response =
    method === 'GET'
      ? await page.request.get(url)
      : method === 'POST'
        ? await page.request.post(url, { data: init.data })
        : method === 'PUT'
          ? await page.request.put(url, { data: init.data })
          : await page.request.delete(url);

  const text = await response.text();
  const body = asJson<ApiEnvelope<T>>(text ? JSON.parse(text) : { success: true });
  expect(
    response.ok() && body.success,
    `${method} ${url} → ${response.status()} ${text.slice(0, 500)}`,
  ).toBe(true);
  return body.data;
}

/**
 * Reset this tenant's seat rows to the case's prerequisite: two members hold a
 * seat in one student-tier pool of `POOL_SEATS` seats. Deleting/reusing the
 * spec's own rows keeps a re-run deterministic without touching another tenant.
 */
async function resetSeatPools(page: Page): Promise<Pool> {
  for (const assignment of await call<Assignment[]>(page, ASSIGNMENTS_URL)) {
    await call<undefined>(page, `${ASSIGNMENTS_URL}/${assignment.id}`, { method: 'DELETE' });
  }

  const existing = (await call<Pool[]>(page, POOLS_URL)).find(
    (pool) => pool.planKey === SEAT_PLAN_KEY,
  );

  if (existing) {
    return call<Pool>(page, `${POOLS_URL}/${existing.id}`, {
      method: 'PUT',
      data: { total: POOL_SEATS },
    });
  }

  return call<Pool>(page, POOLS_URL, {
    method: 'POST',
    data: { planKey: SEAT_PLAN_KEY, quantity: POOL_SEATS },
  });
}

function assignSeat(page: Page, userId: string, poolId: string): Promise<Assignment> {
  return call<Assignment>(page, ASSIGNMENTS_URL, {
    method: 'POST',
    data: { userId, poolId },
  });
}

/** Row label the assignments table renders: full name when present, e-mail otherwise. */
function rowLabel(assignment: Assignment): string {
  return assignment.userFullName || assignment.userEmail;
}

test('releasing a seat through the API frees the pool counter and returns the member to the free plan', async ({
  page,
  browser,
}) => {
  const tenant: QaTenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');

  const org = tenant.org;
  const student = tenant.users.student;
  const control = tenant.users.student2;
  if (!org || !student || !control) {
    throw new Error(
      `MGR-SEAT-03 fixture incomplete: run \`bun scripts/qa-tenant.ts MGR-SEAT-03 --fresh\` first`,
    );
  }

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // --- Prerequisite: the tenant's manager, signed in, on the dashboard ------
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // Both people are student-persona org members with the `member` role. Since
  // #1193 a personal plan carries no audience, so assignment accepts any member;
  // the persona is asserted here as the fixture's own shape.
  const orgMembers = await call<OrgMember[]>(page, '/api/v1/organization/members');
  for (const account of [student, control]) {
    const member = orgMembers.find((candidate) => candidate.id === account.id);
    expect(member, `${account.email} is an org member`).toBeTruthy();
    expect(member?.orgRoleName, `${account.email} holds the org member role`).toBe('member');
    expect(member?.accountType, `${account.email} has the student persona`).toBe('student');
  }

  // --- Prerequisite: „istniejący przydział” --------------------------------
  const pool = await resetSeatPools(page);
  expect(pool).toMatchObject({ planKey: SEAT_PLAN_KEY, total: POOL_SEATS, assigned: 0 });

  const targetAssignment = await assignSeat(page, student.id, pool.id);
  const controlAssignment = await assignSeat(page, control.id, pool.id);
  expect(targetAssignment).toMatchObject({
    userId: student.id,
    poolId: pool.id,
    planKey: SEAT_PLAN_KEY,
  });
  expect(controlAssignment.userId).toBe(control.id);

  // The list endpoint is the one the table renders (it adds the member's name);
  // the create response only carries the e-mail.
  const assignmentsBefore = await call<Assignment[]>(page, ASSIGNMENTS_URL);
  const target = assignmentsBefore.find((assignment) => assignment.id === targetAssignment.id);
  const untouched = assignmentsBefore.find((assignment) => assignment.id === controlAssignment.id);
  if (!target || !untouched) {
    throw new Error('seat assignments were not listed after creation');
  }

  const poolsBefore = await call<Pool[]>(page, POOLS_URL);
  expect(poolsBefore.find((candidate) => candidate.id === pool.id)).toMatchObject({
    total: POOL_SEATS,
    assigned: 2,
  });

  // The member under test is on the seat plan before the release; their own
  // personal (base) plan is what they must fall back to.
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await loginAs(studentPage, tenant, 'student', { locale: 'pl' });
  const personalPlan = await call<PlanInfo>(studentPage, '/api/v1/me/personal-plan');
  const seatedPlan = await call<PlanInfo>(studentPage, '/api/v1/me/plan');
  expect(personalPlan.key, 'a seeded student personal plan is the free plan').toBe('free');
  expect(seatedPlan.key, 'the seated member resolves the seat plan').toBe(SEAT_PLAN_KEY);

  // --- Step 0: /manage/seats lists the existing assignment ------------------
  await page.goto('/manage/seats');
  await expect(page).toHaveURL(/\/manage\/seats$/, { timeout: 20_000 });

  const poolsCard = page.locator('[data-slot="card"]').filter({ hasText: COPY.poolsTitle });
  const assignmentsCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: COPY.assignmentsTitle });
  await expect(poolsCard, 'the seat pools card').toBeVisible();
  await expect(assignmentsCard, 'the assignments card').toBeVisible();

  await expect(
    poolsCard.getByRole('columnheader', { name: COPY.purchasedColumn, exact: true }),
  ).toBeVisible();
  await expect(
    poolsCard.getByRole('columnheader', { name: COPY.assignedColumn, exact: true }),
  ).toBeVisible();
  await expect(
    poolsCard.getByRole('columnheader', { name: COPY.availableColumn, exact: true }),
  ).toBeVisible();

  // Neither table prints the licence plan's key: the page resolves the friendly
  // name from the licence read, so both rows carry it.
  const poolRow = poolsCard.locator('tbody tr').filter({ hasText: SEAT_PLAN_NAME });
  await expect(poolRow, 'one row for the case pool').toHaveCount(1);
  await expect(poolRow.locator('td').nth(1), 'purchased seats').toHaveText(String(POOL_SEATS));
  await expect(poolRow.locator('td').nth(2), 'assigned seats before the release').toHaveText('2');
  await expect(
    poolRow.locator('td').nth(3).locator('span').first(),
    'available seats before the release',
  ).toHaveText('0');

  const targetRow = assignmentsCard.locator('tbody tr').filter({ hasText: rowLabel(target) });
  await expect(targetRow, 'the assignment under test').toHaveCount(1);
  await expect(targetRow.locator('td').nth(1), 'the assignment shows the seat plan').toHaveText(
    SEAT_PLAN_NAME,
  );

  const controlRow = assignmentsCard.locator('tbody tr').filter({ hasText: rowLabel(untouched) });
  await expect(controlRow, 'the control assignment').toHaveCount(1);

  // The page exposes the assign and release controls; purchase is not on it yet.
  await expect(page.getByRole('button', { name: 'Przydziel miejsce' })).toBeVisible();
  await expect(page.getByLabel('Zwolnij miejsce')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Kup miejsca' })).toHaveCount(0);

  // --- Step 1: release through the API, then read the page's own state -----
  await call<undefined>(page, `${ASSIGNMENTS_URL}/${target.id}`, { method: 'DELETE' });

  // --- Expected result: member back to free, available counter up -----------
  const assignmentsAfterRelease = await call<Assignment[]>(page, ASSIGNMENTS_URL);
  expect(
    assignmentsAfterRelease.some((assignment) => assignment.id === target.id),
    'the released assignment row is deleted',
  ).toBe(false);
  expect(
    assignmentsAfterRelease.some((assignment) => assignment.id === untouched.id),
    'the control assignment row is kept',
  ).toBe(true);
  expect(assignmentsAfterRelease, 'the tenant keeps exactly one seat assignment').toHaveLength(1);

  // The counters come from persisted state, so a reload reads them back.
  await page.reload();
  await expect(page).toHaveURL(/\/manage\/seats$/, { timeout: 20_000 });
  const poolRowAfterReload = page
    .locator('[data-slot="card"]')
    .filter({ hasText: COPY.poolsTitle })
    .locator('tbody tr')
    .filter({ hasText: SEAT_PLAN_NAME });
  await expect(poolRowAfterReload.locator('td').nth(1), 'purchased seats are unchanged').toHaveText(
    String(POOL_SEATS),
  );
  await expect(poolRowAfterReload.locator('td').nth(2), 'persisted assigned seats').toHaveText('1');
  await expect(
    poolRowAfterReload.locator('td').nth(3).locator('span').first(),
    'persisted available seats',
  ).toHaveText('1');
  const assignmentsCardAfterReload = page
    .locator('[data-slot="card"]')
    .filter({ hasText: COPY.assignmentsTitle });
  await expect(
    assignmentsCardAfterReload.locator('tbody tr').filter({ hasText: rowLabel(target) }),
    'the released assignment stays gone after a reload',
  ).toHaveCount(0);
  await expect(
    assignmentsCardAfterReload.locator('tbody tr').filter({ hasText: rowLabel(untouched) }),
    'the control assignment persists after a reload',
  ).toHaveCount(1);
  await expect(page.getByLabel('Zwolnij miejsce')).toHaveCount(1);

  // --- API cross-check: exactly the control assignment remains -------------
  const poolsAfter = await call<Pool[]>(page, POOLS_URL);
  expect(poolsAfter.find((candidate) => candidate.id === pool.id)).toMatchObject({
    total: POOL_SEATS,
    assigned: 1,
  });

  const assignmentsAfter = await call<Assignment[]>(page, ASSIGNMENTS_URL);
  expect(
    assignmentsAfter.some((assignment) => assignment.id === target.id),
    'the released assignment row is deleted',
  ).toBe(false);
  expect(
    assignmentsAfter.some((assignment) => assignment.id === untouched.id),
    'the control assignment row is kept',
  ).toBe(true);
  expect(assignmentsAfter, 'the tenant keeps exactly one seat assignment').toHaveLength(1);

  // --- The member is back on their free plan -------------------------------
  const releasedPlan = await call<PlanInfo>(studentPage, '/api/v1/me/plan');
  expect(releasedPlan.key, 'the member no longer resolves the seat plan').toBe('free');
  expect(releasedPlan.key, 'the member falls back to their personal plan').toBe(personalPlan.key);
  expect(releasedPlan.key).not.toBe(SEAT_PLAN_KEY);

  await studentContext.close();

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
