import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-INV-02 — bulk invitations (several rows at once).
 *
 * Prerequisite: a manager of an organization that already has its system roles,
 * i.e. the `content` tenant profile (org + manager/teacher/student + group `G1`):
 *
 *   bun scripts/qa-tenant.ts MGR-INV-02 --fresh
 *
 * The spec reads everything it needs from `qa/.tenants/MGR-INV-02.json`: the
 * manager account, the org (to prove the active-org cookie points at this
 * tenant) and the run suffix that keeps the invited addresses unique per run.
 * Nothing outside this tenant is read or mutated.
 *
 * Polish copy is asserted because the case quotes the Polish interface; the
 * fixture pins `NEXT_LOCALE=pl`.
 *
 * Acceptance criteria (case text, reconciled with the product behaviour):
 * - the per-row X control exists only while there is more than one row;
 * - a batch of several rows returns one result per e-mail, with its own status;
 * - rows that are completely empty are skipped (they are not sent and do not
 *   block the batch);
 * - a form with no valid row is refused with "Dodaj przynajmniej jeden e-mail
 *   z rolą." and sends nothing;
 * - a half-filled row is named inline and blocks the send instead of being
 *   dropped silently (product decision of 2026-10-20, issue #244).
 */

const CASE = 'MGR-INV-02';
const BULK_PATH = '/api/v1/organization/invites/bulk';

const COPY = {
  title: 'Zaproszenia',
  cardTitle: 'Zaproś członków',
  addMember: 'Dodaj kolejną',
  send: 'Wyślij zaproszenia',
  rolePlaceholder: 'Rola',
  noInvites: 'Dodaj przynajmniej jeden e-mail z rolą.',
  success: 'Sukces',
  pending: 'Oczekujące',
  codeLabel: 'Kod zaproszenia:',
  removeRow: (row: number) => `Usuń wiersz ${row}`,
  missingEmail: (row: number) => `Wiersz ${row}: wpisz adres e-mail.`,
  missingRole: (row: number) => `Wiersz ${row}: wybierz rolę.`,
} as const;

/** Role option labels on this page are the display names, not the slugs. */
const ROLE = { admin: 'Admin', teacher: 'Teacher', student: 'Student' } as const;

const emailInputs = (page: Page) => page.locator('input[id^="email-"]');
const removeButtons = (page: Page) => page.getByRole('button', { name: /^Usuń wiersz \d+$/ });
const sendButton = (page: Page) => page.getByRole('button', { name: COPY.send, exact: true });
const resultsCard = (page: Page) => page.locator('[data-testid="invite-result-row"]');

interface BulkBody {
  invitations: Array<{ email: string; targetOrgRoleId: string }>;
}

/** Addresses derived from the tenant's run suffix: unique per independent run. */
function addressFactory(tenant: QaTenant): (tag: string) => string {
  const run = tenant.runSuffix ?? 'stable';
  return (tag: string) => `qa-mgr-inv-02-${run}-${tag}@example.com`;
}

async function openInvites(page: Page, tenant: QaTenant): Promise<void> {
  const org = tenant.org;
  if (!org) throw new Error(`${CASE} needs the content tenant profile (org + roles)`);

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  // The active-org cookie is set by the dashboard's auto-select. Route into the
  // invitations page only once this tenant's org is the active one: a stale org
  // from another case would 403 both `/organization/roles` and `/invites`.
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/v1/me/orgs');
        if (!res.ok()) return null;
        const body = (await res.json()) as {
          data?: Array<{ id: string; isActive: boolean }>;
        };
        return body.data?.find((row) => row.isActive)?.id ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe(org.id);

  // Register before navigating: the page fetches the roles on mount and the
  // selects are unusable (empty) until that response lands.
  const rolesLoaded = page.waitForResponse(
    (res) => new URL(res.url()).pathname === '/api/v1/organization/roles' && res.ok(),
    { timeout: 30_000 },
  );

  await page.goto('/manage/invites');
  await expect(page.locator('#email-0')).toBeVisible();
  await expect(page.getByRole('heading', { name: COPY.title, exact: true })).toBeVisible();
  await expect(page.getByText(COPY.cardTitle, { exact: true })).toBeVisible();
  await rolesLoaded;
}

async function roleIds(page: Page): Promise<Record<'admin' | 'teacher' | 'member', string>> {
  const res = await page.request.get('/api/v1/organization/roles');
  expect(res.status(), 'GET /api/v1/organization/roles').toBe(200);
  const body = (await res.json()) as { data: Array<{ id: string; name: string }> };
  const byName = new Map(body.data.map((role) => [role.name, role.id]));
  return {
    admin: byName.get('admin')!,
    teacher: byName.get('teacher')!,
    member: byName.get('member')!,
  };
}

async function fillRow(page: Page, row: number, email: string, roleLabel: string) {
  await page.locator(`#email-${row}`).fill(email);
  await page.locator(`#role-${row}`).click();
  const option = page.getByRole('option', { name: roleLabel, exact: true });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator(`#role-${row}`)).toHaveText(roleLabel);
}

/** Click "Wyślij zaproszenia" and hand back both the request and the response. */
async function send(page: Page) {
  const isBulk = (url: string) => new URL(url).pathname === BULK_PATH;
  const requestPromise = page.waitForRequest((req) => req.method() === 'POST' && isBulk(req.url()));
  const responsePromise = page.waitForResponse(
    (res) => res.request().method() === 'POST' && isBulk(res.url()),
  );

  await sendButton(page).click();

  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  return {
    response,
    body: request.postDataJSON() as BulkBody,
  };
}

test('three rows, one removed with the X icon, and a separate result per e-mail', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  const emailFor = addressFactory(tenant);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openInvites(page, tenant);
  const roles = await roleIds(page);

  // --- Step 1a: the remove control appears only with more than one row ------
  await expect(emailInputs(page)).toHaveCount(1);
  await expect(removeButtons(page)).toHaveCount(0);

  const addButton = page.getByRole('button', { name: COPY.addMember, exact: true });
  await addButton.click();
  await expect(emailInputs(page)).toHaveCount(2);
  await expect(removeButtons(page)).toHaveCount(2);
  await expect(removeButtons(page).first()).toHaveAccessibleName(COPY.removeRow(1));
  await expect(removeButtons(page).nth(1)).toHaveAccessibleName(COPY.removeRow(2));

  await addButton.click();
  await expect(emailInputs(page)).toHaveCount(3);

  // --- Step 1b: three different e-mails, three different roles --------------
  const first = emailFor('a');
  const removed = emailFor('b');
  const third = emailFor('c');

  await fillRow(page, 0, first, ROLE.teacher);
  await fillRow(page, 1, removed, ROLE.student);
  await fillRow(page, 2, third, ROLE.admin);

  // Three complete rows: nothing blocks the send.
  await expect(sendButton(page)).toBeEnabled();
  await expect(page.locator('[id^="row-error-"]')).toHaveCount(0);

  // --- Step 1c: delete the middle row with its X icon ----------------------
  await removeButtons(page).nth(1).click();

  await expect(emailInputs(page)).toHaveCount(2);
  await expect(removeButtons(page)).toHaveCount(2);
  // The surviving rows keep their values and the labels renumber from 1.
  await expect(page.locator('#email-0')).toHaveValue(first);
  await expect(page.locator('#email-1')).toHaveValue(third);
  await expect(page.locator('#role-0')).toHaveText(ROLE.teacher);
  await expect(page.locator('#role-1')).toHaveText(ROLE.admin);
  await expect(removeButtons(page).first()).toHaveAccessibleName(COPY.removeRow(1));
  await expect(removeButtons(page).nth(1)).toHaveAccessibleName(COPY.removeRow(2));

  // --- Step 2: send the two remaining rows ---------------------------------
  const { response, body } = await send(page);

  expect(response.status(), `POST ${BULK_PATH}`).toBe(200);
  expect(body.invitations.map((invite) => invite.email)).toEqual([first, third]);
  expect(body.invitations.map((invite) => invite.targetOrgRoleId)).toEqual([
    roles.teacher,
    roles.admin,
  ]);

  const payload = (await response.json()) as {
    success: boolean;
    data: { results: Array<{ email: string; success: boolean }> };
  };
  expect(payload.success).toBe(true);
  expect(payload.data.results.map((result) => result.email)).toEqual([first, third]);
  expect(payload.data.results.every((result) => result.success)).toBe(true);

  // Expected: one "Wyniki" entry per e-mail, each with its own status.
  await expect(page.getByText('Wyniki', { exact: true })).toBeVisible();
  await expect(resultsCard(page)).toHaveCount(2);

  const firstResult = resultsCard(page).filter({ hasText: first });
  await expect(firstResult).toHaveCount(1);
  await expect(firstResult).toContainText(COPY.success);
  await expect(firstResult).toContainText(COPY.codeLabel);

  const thirdResult = resultsCard(page).filter({ hasText: third });
  await expect(thirdResult).toHaveCount(1);
  await expect(thirdResult).toContainText(COPY.success);
  await expect(thirdResult).toContainText(COPY.codeLabel);

  // Each invitation is its own row: the codes must differ.
  const codes = await resultsCard(page).locator('p').allTextContents();
  expect(codes).toHaveLength(2);
  expect(new Set(codes).size).toBe(2);

  // The removed address was not part of the batch at all.
  await expect(page.getByText(removed)).toHaveCount(0);

  // Expected: the invitations table lists both, pending, with their roles.
  const tableRow = (email: string) => page.locator('table tbody tr').filter({ hasText: email });
  await expect(tableRow(first)).toHaveCount(1);
  await expect(tableRow(first)).toContainText(ROLE.teacher);
  await expect(tableRow(first)).toContainText(COPY.pending);
  await expect(tableRow(third)).toHaveCount(1);
  await expect(tableRow(third)).toContainText(ROLE.admin);
  await expect(tableRow(third)).toContainText(COPY.pending);

  // Expected: the form goes back to a single empty row (no X control).
  await expect(emailInputs(page)).toHaveCount(1);
  await expect(page.locator('#email-0')).toHaveValue('');
  await expect(page.locator('#role-0')).toHaveText(COPY.rolePlaceholder);
  await expect(removeButtons(page)).toHaveCount(0);

  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

test('a completely blank extra row is skipped and only the filled row is invited', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  const emailFor = addressFactory(tenant);

  await openInvites(page, tenant);
  const roles = await roleIds(page);

  const invited = emailFor('skip');
  await fillRow(page, 0, invited, ROLE.student);

  // Second row stays untouched: no e-mail, no role.
  await page.getByRole('button', { name: COPY.addMember, exact: true }).click();
  await expect(emailInputs(page)).toHaveCount(2);
  await expect(page.locator('#email-1')).toHaveValue('');
  await expect(page.locator('#role-1')).toHaveText(COPY.rolePlaceholder);

  // An all-blank row is not an incomplete row: it neither blocks the send nor
  // produces a result.
  await expect(page.locator('[id^="row-error-"]')).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();

  const { response, body } = await send(page);

  expect(response.status(), `POST ${BULK_PATH}`).toBe(200);
  expect(body.invitations).toHaveLength(1);
  expect(body.invitations[0]).toMatchObject({ email: invited, targetOrgRoleId: roles.member });

  await expect(resultsCard(page)).toHaveCount(1);
  await expect(resultsCard(page).first()).toContainText(invited);
  await expect(resultsCard(page).first()).toContainText(COPY.success);

  const tableRow = page.locator('table tbody tr').filter({ hasText: invited });
  await expect(tableRow).toHaveCount(1);
  await expect(tableRow).toContainText(ROLE.student);
  await expect(tableRow).toContainText(COPY.pending);

  // The batch is done: a single empty row remains and no row was invented.
  await expect(emailInputs(page)).toHaveCount(1);
  await expect(page.locator('#email-0')).toHaveValue('');
});

test('a form with no valid row is refused with the no-invites toast and sends nothing', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  await openInvites(page, tenant);

  let bulkRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === BULK_PATH) {
      bulkRequests += 1;
    }
  });

  // A single, completely empty row is not an error: the send is clickable and
  // answers with the "no valid row" toast.
  await expect(emailInputs(page)).toHaveCount(1);
  await expect(page.locator('[id^="row-error-"]')).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();

  await sendButton(page).click();

  await expect(page.getByText(COPY.noInvites, { exact: true })).toBeVisible();
  expect(bulkRequests, 'an empty batch must not reach the API').toBe(0);
});

test('a half-filled row is named inline, blocks the send and never reaches the API', async ({
  page,
}) => {
  const tenant = loadTenant(CASE);
  const emailFor = addressFactory(tenant);

  await openInvites(page, tenant);

  let bulkRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === BULK_PATH) {
      bulkRequests += 1;
    }
  });

  // E-mail without a role: row 1 is named and the send is blocked.
  await page.locator('#email-0').fill(emailFor('half'));
  await expect(page.locator('#row-error-0')).toHaveText(COPY.missingRole(1));
  await expect(page.locator('#role-0')).toHaveAttribute('aria-invalid', 'true');
  await expect(sendButton(page)).toBeDisabled();

  // Even a forced click must not reach the API while the batch is incomplete.
  await sendButton(page).click({ force: true });
  await page.waitForTimeout(300);
  expect(bulkRequests).toBe(0);

  // Choosing the role clears the error and unblocks the send.
  await page.locator('#role-0').click();
  await page.getByRole('option', { name: ROLE.teacher, exact: true }).click();
  await expect(page.locator('#role-0')).toHaveText(ROLE.teacher);
  await expect(page.locator('#row-error-0')).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();

  // Role without an e-mail: the mirror case, named on the e-mail field.
  await page.locator('#email-0').fill('');
  await expect(page.locator('#row-error-0')).toHaveText(COPY.missingEmail(1));
  await expect(page.locator('#email-0')).toHaveAttribute('aria-invalid', 'true');
  await expect(sendButton(page)).toBeDisabled();

  await sendButton(page).click({ force: true });
  await page.waitForTimeout(300);
  expect(bulkRequests).toBe(0);
});
