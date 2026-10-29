import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * ONB-09 — `/join` without a token, with a bad token, and with a revoked or
 * expired invitation.
 *
 * The visitor is the whole point: none of these paths has a session. Everything
 * that needs one (minting and revoking a real invitation) is done by the case's
 * own manager beforehand, in a separate browser context, so the page under test
 * is always opened by a visitor who has never signed in.
 *
 * Tenant (deterministic, shared `content` profile, fresh run suffix per run):
 *
 *   bun scripts/qa-tenant.ts ONB-09 --profile content --fresh
 *
 * gives org `qa-onb-09-<hash>` with a manager/teacher/student
 * (`tenantKey('qa/cases/ONB-09.md', 'ONB-09#<suffix>', 'qa-shared')`). The spec
 * creates its own invitations through the product API and only ever touches those
 * rows; the manager is the seeded tenant's admin, so the invitation’s inviter
 * authority is real and an expired/revoked token fails for exactly one reason. No
 * global admin setting, feature flag, plan or singleton row is read or written.
 *
 * The third step needs an invitation whose 7 days have already passed. The API
 * has no "expire now" action, so the spec backdates the single row it just
 * created (keyed by that row’s token) through the service client in
 * `qa/fixtures/qa-db.ts`; revocation uses the same DELETE the manage/invites page
 * calls.
 */

const CASE = 'ONB-09';
const APP_URL = process.env.QA_APP_URL ?? 'http://localhost:3010';
const HOST = new URL(APP_URL).hostname;

/** Copy from `RegisterPage` (pl), the suite’s default locale. */
const INVALID_TOAST = 'Nieprawidłowy lub wygasły kod zaproszenia';
const JOIN_TITLE = 'Dołącz do organizacji';
const REGISTER_TITLE = 'Utwórz konto';

interface CreatedInvite {
  id: string;
  token: string;
}

async function managerSession(
  page: Page,
  tenant: QaTenant,
): Promise<{ orgId: string; roleId: string }> {
  const orgId = tenant.org?.id;
  if (!orgId) throw new Error('ONB-09 needs the content tenant profile (org + manager)');

  await loginAs(page, tenant, 'manager', { locale: 'pl' });
  // Every org-scoped request (and the revoke endpoint in particular) reads the
  // active org from this cookie; the seeded manager is an admin of this org.
  await page
    .context()
    .addCookies([{ name: 'active_org_id', value: orgId, domain: HOST, path: '/', httpOnly: true }]);

  const response = await page.request.get('/api/v1/organization/roles');
  expect(response.status(), 'GET /api/v1/organization/roles').toBe(200);
  const body = (await response.json()) as {
    success: boolean;
    data: Array<{ id: string; name: string }>;
  };
  expect(body.success).toBe(true);
  const member = body.data.find((role) => role.name === 'member');
  expect(member, 'the seeded organization has the system member role').toBeTruthy();
  return { orgId, roleId: member!.id };
}

/** Invite a fresh address through the endpoint the manage/invites page uses. */
async function createInvite(
  request: APIRequestContext,
  orgId: string,
  roleId: string,
  email: string,
): Promise<CreatedInvite> {
  const response = await request.post('/api/v1/organization/invites', {
    data: { email, targetOrgRoleId: roleId, organizationId: orgId },
  });
  expect(response.status(), 'POST /api/v1/organization/invites').toBe(201);
  const body = (await response.json()) as {
    success: boolean;
    data: { invitationId: string; inviteCode: string };
  };
  expect(body.success).toBe(true);
  return { id: body.data.invitationId, token: body.data.inviteCode };
}

interface JoinVisit {
  page: Page;
  /** The preview request, or null when `/join` was opened without a token. */
  response: Awaited<ReturnType<Page['waitForResponse']>> | null;
  close: () => Promise<void>;
}

/**
 * Open `/join` the way an invitee would: a brand-new browser context, so no
 * session, no active org and no language cookie from the manager step can leak
 * into the page.
 */
async function visitJoin(browser: Browser, token?: string): Promise<JoinVisit> {
  const context = await browser.newContext({ baseURL: APP_URL });
  const page = await context.newPage();

  if (!token) {
    await page.goto('/join');
    return { page, response: null, close: () => context.close() };
  }

  const preview = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/v1/organization/invites' &&
      new URL(response.url()).searchParams.get('token') === token,
  );
  await page.goto(`/join?token=${encodeURIComponent(token)}`);
  return { page, response: await preview, close: () => context.close() };
}

/** The case’s expected result for every invalid handle: toast, then /register. */
async function expectRejectedInvitation(page: Page): Promise<void> {
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: INVALID_TOAST }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register$/, { timeout: 15_000 });
  await expect(page.getByText(REGISTER_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zarejestruj się' })).toBeVisible();
  // The join form must never be offered: no join heading, and the only read-only
  // e-mail field on the screen (the invited address) does not exist. The register
  // form's own e-mail input stays editable.
  await expect(page.getByText(JOIN_TITLE, { exact: true })).toHaveCount(0);
  await expect(page.locator('input[readonly]')).toHaveCount(0);
  await expect(page.getByLabel('Adres e-mail')).toBeEditable();
}

test('without a token /join sends the visitor straight to /register', async ({ browser }) => {
  const visitor = await visitJoin(browser);
  const { page } = visitor;
  try {
    // Step 1: no token at all — nothing to verify, so no error toast either.
    await expect(page).toHaveURL(/\/register$/, { timeout: 15_000 });
    await expect(page.getByText(REGISTER_TITLE, { exact: true })).toBeVisible();
    await expect(page.getByText(JOIN_TITLE, { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Adres e-mail')).toBeEditable();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: INVALID_TOAST }),
    ).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});

test('a bad token shows the error toast and lands on /register', async ({ browser }) => {
  const visitor = await visitJoin(browser, 'zlytoken');
  const { page } = visitor;
  try {
    // Step 2: the literal value from the case. The preview rejects it, and the
    // page tells the visitor why before replacing the URL.
    expect(visitor.response?.status()).toBe(404);
    await expectRejectedInvitation(page);
  } finally {
    await visitor.close();
  }
});

test('a revoked or expired invitation is rejected exactly like a bad token', async ({
  page,
  browser,
}) => {
  // Step 3: the manager mints two real invitations, then kills them the two ways
  // the product supports — revoke (the manage/invites DELETE) and expiry.
  const tenant = loadTenant(CASE);
  const { orgId, roleId } = await managerSession(page, tenant);

  const revoked = await createInvite(page.request, orgId, roleId, 'qa-onb-09-revoked@test.local');
  const expired = await createInvite(page.request, orgId, roleId, 'qa-onb-09-expired@test.local');

  const revoke = await page.request.delete(`/api/v1/organization/invites/${revoked.id}`);
  expect(revoke.status(), 'DELETE /api/v1/organization/invites/:id').toBe(200);

  const db = createQaSupabase();
  const aged = await db
    .from('invitations')
    .update({ expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
    .eq('token', expired.token)
    .select('id');
  expect(aged.error, 'backdate the invitation the spec just created').toBeNull();
  expect(aged.data, 'exactly the one expired row was aged').toHaveLength(1);

  // A revoked row no longer exists -> the preview is a plain NOT_FOUND; an
  // expired row is GONE. Both must be treated as an invalid invitation.
  const revokedVisit = await visitJoin(browser, revoked.token);
  try {
    expect(revokedVisit.response?.status()).toBe(404);
    await expectRejectedInvitation(revokedVisit.page);
  } finally {
    await revokedVisit.close();
  }

  const expiredVisit = await visitJoin(browser, expired.token);
  try {
    expect(expiredVisit.response?.status()).toBe(410);
    await expectRejectedInvitation(expiredVisit.page);
  } finally {
    await expiredVisit.close();
  }
});

test('a live invitation still opens the join form with the invited address', async ({
  page,
  browser,
}) => {
  // Regression guard for the tested surface: the rejection paths above must not
  // turn into "every link is invalid". A usable link shows the prefilled form.
  const tenant = loadTenant(CASE);
  const { orgId, roleId } = await managerSession(page, tenant);
  const email = 'qa-onb-09-live@test.local';
  const live = await createInvite(page.request, orgId, roleId, email);

  const visitor = await visitJoin(browser, live.token);
  const { page: joinPage } = visitor;
  try {
    expect(visitor.response?.status()).toBe(200);
    await expect(joinPage.getByText(JOIN_TITLE, { exact: true })).toBeVisible();
    const invitedEmail = joinPage.getByLabel('Adres e-mail');
    await expect(invitedEmail).toHaveValue(email);
    await expect(invitedEmail).toHaveAttribute('readonly');
    await expect(joinPage.getByRole('button', { name: 'Aktywuj konto' })).toBeVisible();
    // The visitor is still on /join, not bounced to /register.
    await expect(joinPage).toHaveURL(/\/join\?token=/);
  } finally {
    await visitor.close();
  }

  // Leave no pending invitation behind for the next run.
  const db = createQaSupabase();
  const removed = await db.from('invitations').delete().eq('token', live.token).select('id');
  expect(removed.error).toBeNull();
  expect(removed.data).toHaveLength(1);
});
