import { expect, request as apiRequest, test } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * MGR-INV-01 — sending an invitation with a role (/manage/invites).
 *
 * Prerequisite (reconciled with the tenant fixture): the `content` tenant — one
 * organization whose manager is its `admin` — replaces the legacy manual seed
 * ("M1, WSB Merito, 4/5 członków"). The invitation list is empty on a fresh seed,
 * so the row this test creates is unambiguous. The legacy `@dev.local` accounts
 * are never used.
 *
 *   bun scripts/qa-tenant.ts MGR-INV-01 --fresh
 *
 * Every id comes from the tenant fixture (`tenantKey`/`tenantId`); the spec only
 * reads and writes its own tenant's invitations. Nothing global is touched — no
 * settings, feature flags, plans or platform rows.
 *
 * The spec is re-runnable against a tenant that already has invitations: it
 * records the pending set first and then proves exactly one new invitation (the
 * one just created) appeared, instead of assuming the list was empty.
 *
 * Not asserted: Inbucket delivery. The case says "notuj" — mail is opt-in behind
 * `MAIL_DRIVER` (#604), and with no adapter configured the copied link is the only
 * delivery path. The spec asserts that link instead of a mailbox.
 */

const CASE = 'MGR-INV-01';

/** The address from the case; unique per seeded org, so runs never collide. */
const INVITEE_EMAIL = 'invite1@example.com';

/** The role display name of the org's default `member` role. */
const MEMBER_ROLE_LABEL = 'Student';

interface OrgRole {
  id: string;
  name: string;
  displayName: string;
}

interface InvitationRow {
  id: string;
  email: string;
  targetOrgRoleId: string;
  orgRoleName: string;
  isAccepted: boolean;
  expiresAt: string;
  createdAt: string;
}

interface BulkInviteResult {
  email: string;
  success: boolean;
  data: { invitationId: string; inviteCode: string; inviteLink: string };
}

async function orgRoles(page: import('@playwright/test').Page): Promise<OrgRole[]> {
  const response = await page.request.get('/api/v1/organization/roles');
  expect(response.status(), 'GET /api/v1/organization/roles').toBe(200);
  const body = (await response.json()) as { success: boolean; data: OrgRole[] };
  expect(body.success).toBe(true);
  return body.data;
}

async function pendingInvitations(page: import('@playwright/test').Page): Promise<InvitationRow[]> {
  const response = await page.request.get('/api/v1/organization/invites?isAccepted=false');
  expect(response.status(), 'GET /api/v1/organization/invites').toBe(200);
  const body = (await response.json()) as { success: boolean; data: InvitationRow[] };
  expect(body.success).toBe(true);
  return body.data;
}

test.describe('MGR-INV-01 — sending an invitation with a role', () => {
  test('a single member invitation is sent, copyable and listed as pending', async ({
    page,
    context,
    baseURL,
  }) => {
    const tenant = loadTenant(CASE);
    const manager = tenant.users.manager;
    if (!manager) throw new Error(`tenant ${CASE} has no seeded manager`);
    if (!tenant.org) throw new Error(`tenant ${CASE} has no organization`);
    const orgName = tenant.org.name;

    // „Kopiuj link” writes to the clipboard; assert what actually landed there.
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // 1. Open /manage/invites as the org's manager (Polish UI, like the case).
    await loginAs(page, tenant, 'manager', { locale: 'pl' });
    await expect(
      page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]'),
    ).toContainText(orgName);

    const before = await pendingInvitations(page);
    const roles = await orgRoles(page);
    const memberRole = roles.find((role) => role.name === 'member');
    expect(memberRole, 'the org has no member role').toBeDefined();

    await page.goto('/manage/invites');
    await expect(page).toHaveURL(/\/manage\/invites$/);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Zaproszenia', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#email-0')).toBeVisible();

    // 2. E-mail + role „member” (its display name is „Student”).
    await page.locator('#email-0').fill(INVITEE_EMAIL);
    await page.locator('#role-0').click();
    await page.getByRole('option', { name: MEMBER_ROLE_LABEL, exact: true }).click();
    await expect(page.locator('#role-0')).toHaveText(MEMBER_ROLE_LABEL);

    // 3. Send, capturing both sides of the request so the role and the code/link
    //    the UI is about to offer can be pinned exactly.
    const [bulkResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/api/v1/organization/invites/bulk') &&
          res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Wyślij zaproszenia', exact: true }).click(),
    ]);
    expect(bulkResponse.status(), 'POST /api/v1/organization/invites/bulk').toBe(200);

    // Toast: „Wysłano 1 zaproszeń.” Asserted first — a sonner toast auto-dismisses,
    // so this is the earliest point at which it is on screen.
    await expect(page.getByText('Wysłano 1 zaproszeń.', { exact: true })).toBeVisible();

    const sentBody = bulkResponse.request().postDataJSON() as {
      invitations: { email: string; targetOrgRoleId: string }[];
    };
    expect(sentBody.invitations).toHaveLength(1);
    expect(sentBody.invitations[0]).toMatchObject({
      email: INVITEE_EMAIL,
      targetOrgRoleId: memberRole!.id,
    });

    const bulkJson = (await bulkResponse.json()) as {
      success: boolean;
      data: { results: BulkInviteResult[] };
    };
    expect(bulkJson.success).toBe(true);
    expect(bulkJson.data.results).toHaveLength(1);
    const [result] = bulkJson.data.results;
    expect(result.email).toBe(INVITEE_EMAIL);
    expect(result.success).toBe(true);
    const inviteCode = result.data.inviteCode;
    const inviteLink = result.data.inviteLink;
    expect(inviteCode).toMatch(/^[0-9a-f]{32}$/);

    // „Wyniki”: one row for this address, badge „Sukces”, the code and the copy actions.
    await expect(page.getByText('Wyniki', { exact: true })).toBeVisible();
    const resultRow = page.getByTestId('invite-result-row').filter({ hasText: INVITEE_EMAIL });
    await expect(resultRow).toHaveCount(1);
    await expect(resultRow.getByText('Sukces', { exact: true })).toBeVisible();
    await expect(resultRow).toContainText(inviteCode);
    const copyLink = resultRow.getByRole('button', { name: 'Kopiuj link', exact: true });
    await expect(copyLink).toBeVisible();

    // 4. „Kopiuj link” → toast „Skopiowano!” and the working join link on the clipboard.
    await copyLink.click();
    await expect(page.getByText('Skopiowano!', { exact: true })).toBeVisible();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied, 'clipboard after „Kopiuj link”').toBe(inviteLink);
    const copiedUrl = new URL(copied);
    expect(copiedUrl.pathname).toBe('/join');
    expect(copiedUrl.searchParams.get('token')).toBe(inviteCode);

    // „Wysłane zaproszenia” lists the new invitation: this address, role „Student”,
    // status „Oczekujące”.
    await expect(page.getByText('Wysłane zaproszenia', { exact: true })).toBeVisible();
    const invitationRow = page
      .getByRole('row')
      .filter({ hasText: INVITEE_EMAIL })
      .filter({ hasText: MEMBER_ROLE_LABEL });
    await expect(invitationRow.first()).toBeVisible();
    await expect(invitationRow.first().getByText('Oczekujące', { exact: true })).toBeVisible();

    // The row the manager sees is the row the API holds: exactly one new pending
    // invitation, targeting this org's `member` role.
    const after = await pendingInvitations(page);
    const created = after.find((row) => row.id === result.data.invitationId);
    expect(created, 'the created invitation is missing from the pending list').toMatchObject({
      email: INVITEE_EMAIL,
      targetOrgRoleId: memberRole!.id,
      orgRoleName: 'member',
      isAccepted: false,
    });
    expect(after).toHaveLength(before.length + 1);

    // Adjacent regression that matters for this surface: the copied link is a live
    // capability that previews this organization with the member role for the
    // invitee and does not consume it. Fetched anonymously, as the invitee would.
    const anonymous = await apiRequest.newContext({ baseURL });
    try {
      const preview = await anonymous.get(
        `/api/v1/organization/invites?token=${encodeURIComponent(inviteCode)}`,
      );
      expect(preview.status(), 'public invite preview').toBe(200);
      const previewBody = (await preview.json()) as {
        success: boolean;
        data: {
          email: string;
          organizationId: string;
          organizationName: string;
          targetRole: string;
          orgRoleName: string;
        };
      };
      expect(previewBody.data).toMatchObject({
        email: INVITEE_EMAIL,
        organizationId: tenant.org.id,
        organizationName: orgName,
        targetRole: memberRole!.id,
        orgRoleName: 'member',
      });
    } finally {
      await anonymous.dispose();
    }

    // Previewing changed nothing: the created invitation is still pending.
    const stillPending = await pendingInvitations(page);
    expect(stillPending.map((row) => row.id)).toContain(result.data.invitationId);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
