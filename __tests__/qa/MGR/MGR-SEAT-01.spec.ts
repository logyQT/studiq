import { expect, type Locator, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, test, type QaTenant } from '#test/qa/fixtures/tenant';

/**
 * MGR-SEAT-01 — Zakup miejsc (symulacja) (`/manage/seats`).
 *
 * The case's own `content` tenant, seeded with a fresh run suffix before every
 * independent run:
 *
 *   bun scripts/qa-tenant.ts MGR-SEAT-01 --fresh
 *
 * gives `qa-mgr-seat-01-<suffix>` (`tenantKey('qa/cases/MGR-SEAT-01.md',
 * 'MGR-SEAT-01#<suffix>', 'qa-shared')` + `tenantId`) with a manager as org
 * admin. Seat pools are read and written only for that organization (every
 * endpoint scopes itself from `active_org_id`, which the fixture seeds), so the
 * test never touches another tenant's seats, a global plan, a feature flag or a
 * singleton row.
 *
 * Seats are frozen at the UI since #1493: the organization ladder is capacity
 * only, so a sold seat has no feature to add and organization licences arrive in
 * #1511. `/manage/seats` keeps the pools and assignments tables and every `GET`,
 * and hides the purchase, assign and release entries. The case's purchase is
 * therefore driven through the product API, the same request the retired dialog
 * sent: `POST /api/v1/organization/seats/pools` adds the quantity to the plan's
 * pool (or creates it) and the page re-reads the pools. A fresh org has no pools
 * — `plan_seat_allocations` and its trigger seeding were dropped in
 * `20260915000003_drop_plan_seat_allocations.sql` — so the pool the case reads
 * back is exactly the one this test bought.
 *
 * Asserted behaviour (the case's expected result):
 * - The page renders the „Pule miejsc” and „Przydziały” tables and no „Kup
 *   miejsca”, „Przydziel miejsce” or „Zwolnij miejsce” control.
 * - Buying 3 of a plan through the API returns 201 and the pool row reads
 *   3 purchased / 0 assigned / 3 available, also after a reload.
 * - The API enforces the same floor: quantity 0 or -1 is a 422, not a pool.
 */

const CASE = 'MGR-SEAT-01';

const SEATS_PATH = '/manage/seats';
const POOLS_API = '/api/v1/organization/seats/pools';
const ASSIGNMENTS_API = '/api/v1/organization/seats/assignments';

/** Pool the test buys in; the label is the plan catalogue's own name. */
const PLAN_KEY = 'ace';
const PLAN_LABEL = 'StudiQ Pro';
const QUANTITY = 3;

const COPY = {
  heading: 'Licencje miejsc',
  poolsTitle: 'Pule miejsc',
  assignmentsTitle: 'Przydziały',
  frozenNote: 'Sprzedaż miejsc jest wstrzymana do czasu wprowadzenia licencji organizacji.',
} as const;

interface Pool {
  id: string;
  planKey: string;
  total: number;
  assigned: number;
}

async function listPools(page: Page): Promise<Pool[]> {
  const res = await page.request.get(POOLS_API);
  expect(res.status(), `GET ${POOLS_API}`).toBe(200);
  const body = await json<{ success: boolean; data: Pool[] }>(res);
  expect(body.success).toBe(true);
  return body.data;
}

/** The „Pule miejsc” card, so pool rows never mix with the assignments table. */
function poolsCard(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({ hasText: COPY.poolsTitle });
}

function poolRows(page: Page): Locator {
  return poolsCard(page).locator('table tbody tr');
}

/** Asserts the visible plan/total/assigned/available cells of one pool row. */
async function expectPoolRow(
  row: Locator,
  expected: { total: number; assigned: number; available: number },
): Promise<void> {
  await expect(row.locator('td').nth(1)).toHaveText(String(expected.total));
  await expect(row.locator('td').nth(2)).toHaveText(String(expected.assigned));
  await expect(row.locator('td').nth(3)).toHaveText(String(expected.available));
}

test('the frozen seat page shows the pools table and the API still buys three seats', async ({
  page,
}) => {
  const tenant: QaTenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} runs on the content tenant profile`).toBe('content');
  const org = tenant.org;
  const manager = tenant.users.manager;
  if (!org || !manager) {
    throw new Error(
      `MGR-SEAT-01 fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
    );
  }

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // --- Prerequisite: the tenant's manager, signed in, on the seats page -----
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage/ });
  await page.goto(SEATS_PATH);
  await expect(page).toHaveURL(new RegExp(`${SEATS_PATH}$`), { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { name: COPY.heading, exact: true })).toBeVisible();
  await expect(page.getByText(COPY.poolsTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.assignmentsTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(COPY.frozenNote)).toBeVisible();

  // The B2 freeze: the data is visible, the sale and assignment are not.
  for (const control of ['Kup miejsca', 'Przydziel miejsce']) {
    await expect(page.getByRole('button', { name: control }), `${control} is hidden`).toHaveCount(
      0,
    );
  }
  await expect(page.getByLabel('Zwolnij miejsce')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The read path the page renders answers, and a fresh org has no pool yet.
  expect(await listPools(page)).toEqual([]);
  await expect(poolRows(page)).toHaveCount(0);
  const assignments = await page.request.get(ASSIGNMENTS_API);
  expect(assignments.status(), `GET ${ASSIGNMENTS_API}`).toBe(200);

  // --- Step 1: buy 3 seats through the API the page no longer exposes -------
  const purchase = await page.request.post(POOLS_API, {
    data: { planKey: PLAN_KEY, quantity: QUANTITY },
  });
  expect(purchase.status(), `POST ${POOLS_API}`).toBe(201);
  expect(await purchase.json()).toMatchObject({
    success: true,
    data: { planKey: PLAN_KEY, total: QUANTITY, assigned: 0 },
  });

  // Expected result: the pool row is 3 purchased / 0 assigned / 3 available.
  await page.reload();
  await expect(page.getByRole('heading', { name: COPY.heading, exact: true })).toBeVisible();
  await expect(poolRows(page)).toHaveCount(1);
  await expect(poolRows(page).first().locator('td').nth(0)).toHaveText(PLAN_LABEL);
  await expectPoolRow(poolRows(page).first(), {
    total: QUANTITY,
    assigned: 0,
    available: QUANTITY,
  });

  const pools = await listPools(page);
  expect(pools).toHaveLength(1);
  expect(pools[0]).toMatchObject({ planKey: PLAN_KEY, total: QUANTITY, assigned: 0 });

  // --- Step 2: quantities 0 and negative are refused ------------------------
  for (const invalidQuantity of [0, -2]) {
    const res = await page.request.post(POOLS_API, {
      data: { planKey: PLAN_KEY, quantity: invalidQuantity },
    });
    expect(res.status(), `POST ${POOLS_API} with quantity ${invalidQuantity}`).toBe(422);
    const body = await json<{ success: boolean; error: string }>(res);
    expect(body).toMatchObject({ success: false, error: 'UNPROCESSABLE_ENTITY' });
  }

  const untouched = await listPools(page);
  expect(untouched).toHaveLength(1);
  expect(untouched[0]).toMatchObject({ planKey: PLAN_KEY, total: QUANTITY, assigned: 0 });

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
