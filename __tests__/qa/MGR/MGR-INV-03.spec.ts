import { expect, test, type Browser, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * MGR-INV-03 — cancelling a pending organization invitation (/manage/invites).
 *
 * Prerequisite (reconciled with the tenant model): a manager whose organization
 * has one **pending** invitation, and the copyable `/join?token=…` link of that
 * invitation. The legacy manual seed (`manager@dev.local`, password `pass`) is
 * never used.
 *
 * Tenant (`content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts MGR-INV-03 --fresh
 *
 * gives the org `qa-mgr-inv-03-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1`. Every org/user id derives from `tenantKey(
 * 'qa/cases/MGR-INV-03.md', 'MGR-INV-03#<suffix>', 'qa-shared')` + `tenantId`, so
 * nothing global is read or written: no admin setting, feature flag, plan, platform
 * stat or singleton row.
 *
 * The tenant graph is seeded once before Playwright starts. The invitation is
 * content, not graph: this spec mints it through the real
 * `POST /api/v1/organization/invites` endpoint — the same request the page makes —
 * so the inviter authority, the target role and the 7-day expiry are real. The
 * invitee account is deliberately **not** created: an invitation is addressed to
 * an e-mail, and the case never accepts it.
 *
 * The invitation is minted per attempt (a fresh address under the case's prefix)
 * and pending leftovers of an earlier attempt are cancelled first, so the case is
 * re-runnable against the one tenant CI seeds for retries.
 *
 * Acceptance points:
 * 1. „Anuluj” in the invitation row opens „Anulować zaproszenie?”; confirming
 *    shows the toast „Zaproszenie anulowane” and the row leaves the pending list
 *    (closing the dialog leaves it untouched).
 * 2. The previously copied `/join?token=…` link stops working: the public preview
 *    is gone (404) and the join screen treats it as an invalid invitation
 *    (redirect to /register + „Nieprawidłowy lub wygasły kod zaproszenia”).
 */

const CASE = 'MGR-INV-03';

const INVITES_URL = '/api/v1/organization/invites';
const ROLES_URL = '/api/v1/organization/roles';

/** Every address this spec mints starts with this prefix (retry cleanup). */
const EMAIL_PREFIX = 'mgr-inv03';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface OrgRole {
  id: string;
  name: string;
}

interface PendingInvitation {
  id: string;
  email: string;
}

interface CreatedInvitation {
  invitationId: string;
  inviteCode: string;
  inviteLink: string;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url} → ${await response.text()}`).toBe(200);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** The manager's org roles — `teacher` is the role the case's invitation targets. */
async function teacherRoleId(page: Page): Promise<string> {
  const roles = await getData<OrgRole[]>(page, ROLES_URL);
  const teacher = roles.find((role) => role.name === 'teacher');
  expect(teacher, 'the tenant org has a teacher role').toBeDefined();
  return teacher!.id;
}

/**
 * Start each attempt from the same state: the pending list holds no invitation
 * this spec left behind. CI seeds the tenant once and reuses it for every retry,
 * so a failed attempt must not make the next one see two rows for its address.
 */
async function cancelStaleInvitations(page: Page): Promise<void> {
  const pending = await getData<PendingInvitation[]>(page, `${INVITES_URL}?isAccepted=false`);
  for (const invitation of pending.filter((row) => row.email.startsWith(EMAIL_PREFIX))) {
    const cancelled = await page.request.delete(`${INVITES_URL}/${invitation.id}`);
    expect(
      cancelled.status(),
      `DELETE ${INVITES_URL}/${invitation.id} → ${await cancelled.text()}`,
    ).toBe(200);
  }
}

/** Mint the case's live `teacher` invitation through the product API. */
async function createInvitation(
  page: Page,
  orgId: string,
  roleId: string,
): Promise<{ id: string; token: string; link: string; email: string }> {
  const inviteeEmail = `${EMAIL_PREFIX}-${Date.now().toString(36)}@qa.local`;
  const created = await page.request.post(INVITES_URL, {
    data: {
      email: inviteeEmail,
      targetOrgRoleId: roleId,
      organizationId: orgId,
      locale: 'pl',
    },
  });
  expect(created.status(), `POST ${INVITES_URL} → ${await created.text()}`).toBe(201);
  const body = (await created.json()) as ApiEnvelope<CreatedInvitation>;
  expect(body.success).toBe(true);
  expect(body.data.inviteCode, 'the invitation has a 32-hex join code').toMatch(/^[0-9a-f]{32}$/);
  expect(body.data.inviteLink).toContain(`/join?token=${body.data.inviteCode}`);
  return {
    id: body.data.invitationId,
    token: body.data.inviteCode,
    link: body.data.inviteLink,
    email: inviteeEmail,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A fresh, signed-out context for the public `/join` surface. */
async function openAnonymous(
  browser: Browser,
  baseURL: string,
): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ baseURL });
  const { hostname } = new URL(baseURL);
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { page, errors };
}

test.describe('@case:MGR-INV-03 @area:MGR @prio:P2 cancelling a pending invitation', () => {
  test('revoking cancels the invitation and kills its join link', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(150_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const org = tenant.org;
    if (!org || !tenant.users.manager) {
      throw new Error(`${CASE} needs the content tenant profile (org and manager)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';

    // Real login first: the invitation and the cleanup below are the manager's
    // own authenticated writes, exactly as the page performs them.
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    const roleId = await teacherRoleId(page);
    await cancelStaleInvitations(page);
    const invite = await createInvitation(page, org.id, roleId);

    // Precondition: before the manager touches it, the copied link is live — the
    // join screen renders the form with the invited address. Without this the
    // "link stops working" assertion below could pass for a link that never worked.
    const live = await openAnonymous(browser, origin);
    try {
      await live.page.goto(invite.link);
      await expect(live.page).toHaveURL(new RegExp(`/join\\?token=${invite.token}`));
      await expect(live.page.getByText('Dołącz do organizacji', { exact: true })).toBeVisible();
      const invitedEmail = live.page.locator('input[name="email"]');
      await expect(invitedEmail).toHaveValue(invite.email);
      await expect(invitedEmail).toHaveAttribute('readonly', '');
      await expect(live.page.getByRole('button', { name: 'Aktywuj konto' })).toBeVisible();
      expect(live.errors, 'uncaught page errors on the live join screen').toEqual([]);
    } finally {
      await live.page.context().close();
    }

    // The dashboard settles the active organization first; the case's own entry
    // point is the „Zaproszenia” sidebar item.
    await expect(
      page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]'),
    ).toContainText(org.name);
    await page.locator('a[href="/manage/invites"]').first().click();
    await expect(page).toHaveURL(/\/manage\/invites$/);
    await expect(page.getByRole('heading', { name: 'Zaproszenia', exact: true })).toBeVisible();

    // Prerequisite: the invitation is listed as pending.
    const row = page.getByRole('row', {
      name: new RegExp(escapeRegExp(invite.email)),
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Oczekujące');

    // 1. „Anuluj” opens the confirmation window.
    const revokeButton = row.getByRole('button', { name: 'Anuluj' });
    await revokeButton.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Anulować zaproszenie?', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('Spowoduje to anulowanie zaproszenia. Osoba nie będzie mogła dołączyć.', {
        exact: true,
      }),
    ).toBeVisible();

    // Closing the window must not cancel anything: the row stays pending.
    await dialog.getByRole('button', { name: 'Zamknij' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Oczekujące');

    // Confirming cancels it: toast + the row leaves the pending list.
    await revokeButton.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByText('Zaproszenie anulowane', { exact: true })).toBeVisible();
    await expect(row).toHaveCount(0);
    await expect(page.getByText('Brak wysłanych zaproszeń')).toBeVisible();

    // The pending list really no longer holds the invitation (not just the view).
    const list = await getData<PendingInvitation[]>(page, `${INVITES_URL}?isAccepted=false`);
    expect(list.filter((invitation) => invitation.id === invite.id)).toEqual([]);

    // 2. The previously copied link no longer resolves.
    const preview = await page.request.get(`${INVITES_URL}?token=${invite.token}`);
    expect(preview.status(), 'GET /api/v1/organization/invites?token=<revoked>').toBe(404);

    const dead = await openAnonymous(browser, origin);
    try {
      await dead.page.goto(invite.link);
      // Same handling as any invalid invitation (ONB-09): error toast, no form.
      await expect(
        dead.page.getByText('Nieprawidłowy lub wygasły kod zaproszenia', { exact: true }),
      ).toBeVisible();
      await expect(dead.page).toHaveURL(/\/register$/);
      // No invitation form: the revoked token cannot prefill an address, and the
      // only form left is the plain registration page.
      await expect(dead.page.getByRole('button', { name: 'Aktywuj konto' })).toHaveCount(0);
      await expect(dead.page.getByText('Utwórz konto', { exact: true })).toBeVisible();
      expect(dead.errors, 'uncaught page errors on the revoked join screen').toEqual([]);
    } finally {
      await dead.page.context().close();
    }

    expect(pageErrors, 'uncaught page errors while revoking').toEqual([]);
  });
});
