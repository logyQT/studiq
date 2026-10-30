import { expect, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

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
 * The purchase itself is the simulated flow the product defines: there is no
 * payment step, `POST /api/v1/organization/seats/pools` adds the quantity to the
 * plan's pool (or creates it) and the page re-reads the pools. A fresh org has
 * no pools — `plan_seat_allocations` and its trigger seeding were dropped in
 * `20260915000003_drop_plan_seat_allocations.sql` — so the pool the case reads
 * back is exactly the one this test bought.
 *
 * Asserted behaviour (the case's expected result):
 * - „Kup” is inert without a plan and for a quantity below 1 (0 and negative);
 *   the dialog explains the minimum and no write is sent.
 * - Buying 3 of a plan shows the „Miejsca dodane do puli” toast and the pool row
 *   reads 3 purchased / 0 assigned / 3 available, also after a reload.
 * - The API enforces the same floor: quantity 0 or -1 is a 422, not a pool.
 */

const CASE = 'MGR-SEAT-01';

const SEATS_PATH = '/manage/seats';
const POOLS_API = '/api/v1/organization/seats/pools';

/** Pool the test buys in; the label is the dialog's own option copy. */
const PLAN_KEY = 'ace';
const PLAN_LABEL = 'StudiQ Ace';
const QUANTITY = 3;

const COPY = {
  heading: 'Licencje miejsc',
  purchaseSeats: 'Kup miejsca',
  dialogTitle: 'Kup licencje na miejsca',
  purchase: 'Kup',
  cancel: 'Anuluj',
  purchased: 'Miejsca dodane do puli',
  quantityInvalid: 'Podaj liczbę całkowitą miejsc (co najmniej 1).',
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
  const body = (await res.json()) as { success: boolean; data: Pool[] };
  expect(body.success).toBe(true);
  return body.data;
}

/** The „Pule miejsc” card, so pool rows never mix with the assignments table. */
function poolsCard(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({ hasText: 'Pule miejsc' });
}

function poolRows(page: Page): Locator {
  return poolsCard(page).locator('table tbody tr');
}

/** Asserts the visible plan/total/assigned/available cells of one pool row. */
async function expectPoolRow(
  row: Locator,
  expected: { total: number; assigned: number; available: number },
): Promise<void> {
  // The plan label comes from the shared plan catalog, which the case does not
  // pin: assert the row has a plan name and the three numeric columns.
  await expect(row.locator('td').nth(0)).not.toBeEmpty();
  await expect(row.locator('td').nth(1)).toHaveText(String(expected.total));
  await expect(row.locator('td').nth(2)).toHaveText(String(expected.assigned));
  await expect(row.locator('td').nth(3)).toHaveText(String(expected.available));
}

async function openPurchaseDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: COPY.purchaseSeats, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(COPY.dialogTitle, { exact: true })).toBeVisible();
  return dialog;
}

function buyButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: COPY.purchase, exact: true });
}

async function selectPlan(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: PLAN_LABEL, exact: true }).click();
}

function quantityInput(dialog: Locator): Locator {
  return dialog.locator('input[type="number"]');
}

test('a manager buys three seats and the purchase dialog refuses quantities below one', async ({
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

  /** POSTs the page itself sends; the dialog must not write for invalid input. */
  let purchaseWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === POOLS_API) {
      purchaseWrites += 1;
    }
  });

  // --- Prerequisite: the tenant's manager, signed in, on the seats page -----
  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage/ });
  await page.goto(SEATS_PATH);
  await expect(page).toHaveURL(new RegExp(`${SEATS_PATH}$`), { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { name: COPY.heading, exact: true })).toBeVisible();

  // A fresh org starts without seat pools; the test buys the only pool it reads.
  expect((await listPools(page)).filter((pool) => pool.planKey === PLAN_KEY)).toEqual([]);
  await expect(poolRows(page)).toHaveCount(0);

  // --- Step 1: „Kup miejsca”, pick a plan and 3, click „Kup” ----------------
  let dialog = await openPurchaseDialog(page);

  // Expected result: „Kup” is inert without a plan (the dialog opens with 1).
  await expect(buyButton(dialog)).toBeDisabled();

  await selectPlan(page, dialog);
  await expect(buyButton(dialog), '„Kup” with a plan and quantity 1').toBeEnabled();
  await quantityInput(dialog).fill(String(QUANTITY));

  const purchase = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === POOLS_API,
  );
  await buyButton(dialog).click();
  const purchased = await purchase;
  expect(purchased.status(), `POST ${POOLS_API}`).toBe(201);
  expect(await purchased.json()).toMatchObject({
    success: true,
    data: { planKey: PLAN_KEY, total: QUANTITY, assigned: 0 },
  });

  // Expected result: toast „Miejsca dodane do puli”.
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: COPY.purchased }).first(),
  ).toBeVisible();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: /Nie udało się/ }),
    'no failure toast',
  ).toHaveCount(0);

  // Expected result: the pool row is 3 purchased / 0 assigned / 3 available.
  await expect(poolRows(page)).toHaveCount(1);
  await expectPoolRow(poolRows(page).first(), {
    total: QUANTITY,
    assigned: 0,
    available: QUANTITY,
  });

  const pools = await listPools(page);
  expect(pools).toHaveLength(1);
  expect(pools[0]).toMatchObject({ planKey: PLAN_KEY, total: QUANTITY, assigned: 0 });

  // The pool is server state, so it survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: COPY.heading, exact: true })).toBeVisible();
  await expect(poolRows(page)).toHaveCount(1);
  await expectPoolRow(poolRows(page).first(), {
    total: QUANTITY,
    assigned: 0,
    available: QUANTITY,
  });

  // --- Step 2: quantities 0 and negative are refused ------------------------
  const writesBeforeInvalidInput = purchaseWrites;
  dialog = await openPurchaseDialog(page);
  await expect(buyButton(dialog), '„Kup” without a plan').toBeDisabled();

  await selectPlan(page, dialog);
  const quantity = quantityInput(dialog);

  await quantity.fill('0');
  await expect(buyButton(dialog), '„Kup” for quantity 0').toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveText(COPY.quantityInvalid);

  await quantity.fill('-2');
  await expect(buyButton(dialog), '„Kup” for a negative quantity').toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveText(COPY.quantityInvalid);

  // 1 is the floor and re-enables the button — the guard is about < 1, not a
  // permanently disabled control.
  await quantity.fill('1');
  await expect(buyButton(dialog), '„Kup” for quantity 1').toBeEnabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);

  await dialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(purchaseWrites, 'cancelling and invalid quantities send no purchase').toBe(
    writesBeforeInvalidInput,
  );

  // The pool the case bought is unchanged by the rejected attempts.
  await expect(poolRows(page)).toHaveCount(1);
  await expectPoolRow(poolRows(page).first(), {
    total: QUANTITY,
    assigned: 0,
    available: QUANTITY,
  });

  // --- The API enforces the same floor as the disabled button ---------------
  for (const quantity of [0, -2]) {
    const res = await page.request.post(POOLS_API, {
      data: { planKey: PLAN_KEY, quantity },
    });
    expect(res.status(), `POST ${POOLS_API} with quantity ${quantity}`).toBe(422);
    expect(await res.json()).toMatchObject({
      success: false,
      error: 'UNPROCESSABLE_ENTITY',
    });
  }

  const untouched = await listPools(page);
  expect(untouched).toHaveLength(1);
  expect(untouched[0]).toMatchObject({ planKey: PLAN_KEY, total: QUANTITY, assigned: 0 });

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});
