import { expect, test, type Page, type Response } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-INV-04 — accepting an invitation as an **existing** user.
 *
 * Prerequisite (reconciled with the tenant seeder): the invitee is a registered
 * account that does **not** belong to the manager's organization yet — the legacy
 * `student3@dev.local` (standalone B2C student, no organization). The legacy
 * manual accounts (`@dev.local`, password `pass`) are never used.
 *
 * Tenant: `bun scripts/qa-tenant.ts MGR-INV-04 --fresh` seeds it before the suite
 * starts. `qa/tests/profiles/MGR-INV-04.json` declares the `org-limit` profile,
 * the only seeded shape with accounts that are **not** members of the tenant's
 * organization:
 *
 * - one organization with its default group `G1` (ids
 *   `tenantId(KEY, 'org' | 'group:default')`) and the manager as its `admin`,
 *   plus an educator and a student member;
 * - `invitee1` — a registered student account that belongs to no organization —
 *   which joins this organization through the invitation, exactly like the
 *   legacy `student3`.
 *
 * The spec never creates accounts, an organization or a group: the profile seeds
 * the graph, and the invitation itself is minted through the manager page.
 *
 * Re-run safety: CI seeds one tenant per case and Playwright reuses it for every
 * retry and every `--repeat-each` pass. A previous attempt leaves the invitee
 * inside the organization with an accepted invitation row behind, so the run
 * first removes **only this case's** rows (the invitee's invitations in this
 * organization, its group and organization memberships) and every attempt starts
 * from the case prerequisite: registered, outside the organization, no pending
 * invitations.
 *
 * Nothing global is written (no settings, feature flags, plans, platform stats),
 * and no other case's tenant is touched.
 */

const CASE = 'MGR-INV-04';

/** The role under test: it must come from the invitation, not from a default. */
const INVITE_ROLE_NAME = 'teacher';
const INVITE_ROLE_LABEL = 'Teacher';

/** Polish copy the case quotes; the fixture pins `NEXT_LOCALE=pl`. */
const COPY = {
  invitesTitle: 'Zaproszenia',
  sendInvitations: 'Wyślij zaproszenia',
  sentToast: 'Wysłano 1 zaproszeń.',
  resultsTitle: 'Wyniki',
  success: 'Sukces',
  pending: 'Oczekujące',
  accepted: 'Zaakceptowane',
  revoke: 'Anuluj',
  showAccepted: 'Pokaż zaakceptowane',
  noInvitations: 'Brak wysłanych zaproszeń',
  joinTitle: 'Dołącz do klasy',
  joinDescription: 'Wpisz kod zaproszenia lub wklej link zaproszenia, aby dołączyć do klasy',
  joinSubmit: 'Dołącz',
  joinedToast: 'Dołączyłeś do klasy!',
  invalidToken: 'Nieprawidłowy lub wygasły kod zaproszenia',
} as const;

interface OrgMembership {
  id: string;
  name: string;
  orgRoleName: string;
  orgRoleDisplayName?: string;
  isActive: boolean;
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

interface MemberRow {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  orgRoleId: string;
  groups: Array<{ id: string; name: string; role: string }>;
}

interface CreatedInvitation {
  email: string;
  success: boolean;
  data: { invitationId: string; inviteLink: string; inviteCode: string };
}

declare global {
  interface Window {
    __qaToasts?: string[];
  }
}

/**
 * Reset this case's own rows so a retry or a `--repeat-each` pass on the
 * CI-seeded tenant starts from the case prerequisite: an invitee that is
 * registered but outside the organization, and no invitation history.
 *
 * The product offers no way to delete an accepted invitation, and removing a
 * member is the member's own action, so the cleanup goes through the suite's
 * service-role client — the same helper the other cases use to reset rows they
 * own. The deletes are scoped to this tenant's organization, group and invitee.
 */
async function resetCaseState(tenant: QaTenant): Promise<void> {
  const org = tenant.org;
  const group = tenant.group;
  const invitee = tenant.users.invitee1;
  if (!org || !group || !invitee) {
    throw new Error(`${CASE} fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``);
  }
  const db = createQaSupabase();

  const invitations = await db
    .from('invitations')
    .delete()
    .eq('organization_id', org.id)
    .eq('email', invitee.email);
  expect(
    invitations.error,
    `reset ${CASE} invitations: ${invitations.error?.message ?? ''}`,
  ).toBeNull();

  const groupMembers = await db
    .from('group_members')
    .delete()
    .eq('group_id', group.id)
    .eq('user_id', invitee.id);
  expect(
    groupMembers.error,
    `reset ${CASE} group membership: ${groupMembers.error?.message ?? ''}`,
  ).toBeNull();

  const orgMembers = await db
    .from('org_members')
    .delete()
    .eq('organization_id', org.id)
    .eq('user_id', invitee.id);
  expect(
    orgMembers.error,
    `reset ${CASE} organization membership: ${orgMembers.error?.message ?? ''}`,
  ).toBeNull();
}

/** Record every toast that appears, so a transient toast is still an assertion. */
async function watchToasts(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__qaToasts) return;
    const recorded: string[] = [];
    window.__qaToasts = recorded;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('[data-sonner-toast]')) {
        const text = (node as HTMLElement).innerText.trim();
        if (text && !recorded.includes(text)) recorded.push(text);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

function expectToast(page: Page, text: string) {
  return expect
    .poll(() => page.evaluate(() => window.__qaToasts ?? []), { timeout: 10_000 })
    .toContain(text);
}

async function logout(page: Page): Promise<void> {
  const response = await page.request.post('/api/v1/auth/logout');
  expect(response.status(), 'POST /api/v1/auth/logout').toBe(200);
}

async function getData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data;
}

function memberships(page: Page) {
  return getData<OrgMembership[]>(page, '/api/v1/me/orgs');
}

/** Wait for `useOrgs` to settle the server-side `active_org_id` cookie on this org. */
async function expectActiveOrg(page: Page, orgId: string): Promise<void> {
  await expect
    .poll(async () => (await memberships(page)).find((org) => org.isActive)?.id, {
      timeout: 20_000,
    })
    .toBe(orgId);
}

function isInvitesRequest(response: Response, accepted: boolean): boolean {
  const url = new URL(response.url());
  return (
    url.pathname === '/api/v1/organization/invites' &&
    url.searchParams.get('isAccepted') === String(accepted) &&
    response.request().method() === 'GET'
  );
}

function isAcceptRequest(response: Response): boolean {
  return (
    new URL(response.url()).pathname === '/api/v1/organization/invites/accept' &&
    response.request().method() === 'POST'
  );
}

function rowFor(page: Page, email: string) {
  return page.locator('table tbody tr').filter({ hasText: email });
}

test.describe('MGR-INV-04 — accepting an invite as an existing user', () => {
  test('the invitee joins /app/join with the invited role, and the token is single-use', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');
    const org = tenant.org;
    const group = tenant.group;
    const manager = tenant.users.manager;
    const invitee = tenant.users.invitee1;
    if (!org || !group || !manager || !invitee) {
      throw new Error(
        `${CASE} fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
      );
    }

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(`MGR-INV-04 tenant: ${tenant.key}`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // A retry reuses this tenant, so drop whatever the previous attempt left.
    await resetCaseState(tenant);

    // --- Step 1a: the manager invites the existing account -------------------
    // `/login` sends a manager to `/manage`, where `useOrgs` writes the
    // `active_org_id` cookie the invitations endpoints scope themselves by.
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    await expectActiveOrg(page, org.id);

    await page.goto('/manage/invites');
    await expect(page.getByRole('heading', { name: COPY.invitesTitle, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.noInvitations, { exact: true })).toBeVisible();
    await expect(rowFor(page, invitee.email)).toHaveCount(0);

    await page.locator('#email-0').fill(invitee.email);
    await page.locator('#role-0').click();
    await expect(page.getByRole('option', { name: INVITE_ROLE_LABEL, exact: true })).toBeVisible();
    await page.getByRole('option', { name: INVITE_ROLE_LABEL, exact: true }).click();

    await watchToasts(page);
    const bulkResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/organization/invites/bulk' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: COPY.sendInvitations, exact: true }).click();

    const bulk = await bulkResponse;
    expect(bulk.status(), 'POST /api/v1/organization/invites/bulk').toBe(200);
    const bulkBody = (await bulk.json()) as {
      success: boolean;
      data: { results: CreatedInvitation[] };
    };
    expect(bulkBody.success).toBe(true);
    expect(bulkBody.data.results).toHaveLength(1);

    const created = bulkBody.data.results[0];
    expect(created.email).toBe(invitee.email);
    expect(created.data.inviteCode).toMatch(/^[0-9a-f]{32}$/);
    const inviteLink = new URL(created.data.inviteLink);
    expect(inviteLink.pathname).toBe('/join');
    expect(inviteLink.searchParams.get('token')).toBe(created.data.inviteCode);

    // The manager sees the batch result and the pending row with the invited role.
    await expectToast(page, COPY.sentToast);
    const resultRow = page.getByTestId('invite-result-row').filter({ hasText: invitee.email });
    await expect(resultRow).toHaveCount(1);
    await expect(resultRow).toContainText(COPY.success);
    await expect(resultRow).toContainText(`Kod zaproszenia: ${created.data.inviteCode}`);

    const pendingRow = rowFor(page, invitee.email);
    await expect(pendingRow).toHaveCount(1);
    await expect(pendingRow).toContainText(INVITE_ROLE_LABEL);
    await expect(pendingRow).toContainText(COPY.pending);

    // --- Step 1b: the existing user accepts from /app/join -------------------
    await logout(page);
    await loginAs(page, tenant, 'invitee1', {
      locale: 'pl',
      waitFor: /\/app(\/|$)/,
      activeOrgId: null,
    });

    // Prerequisite made explicit: a registered account that is in no organization
    // yet — exactly the legacy `student3` (B2C) situation the case describes.
    expect(await memberships(page), 'the invitee starts outside every organization').toEqual([]);

    await page.goto('/app/join');
    await expect(page.locator('[data-slot="card-title"]', { hasText: COPY.joinTitle })).toHaveCount(
      1,
    );
    await expect(page.getByText(COPY.joinDescription, { exact: true })).toBeVisible();

    const tokenInput = page.locator('#token');
    const submit = page.locator('form button[type="submit"]');

    await tokenInput.fill(created.data.inviteLink);
    await watchToasts(page);
    const acceptResponse = page.waitForResponse(isAcceptRequest);
    await submit.click();

    const accepted = await acceptResponse;
    expect(accepted.status(), 'POST /api/v1/organization/invites/accept').toBe(200);
    expect(((await accepted.json()) as { success: boolean }).success).toBe(true);

    await expectToast(page, COPY.joinedToast);
    await expect(tokenInput).toHaveValue('');

    // Server state: the organization is now active for the invitee, with the
    // role **from the invitation** (not the default `member`).
    const joined = await memberships(page);
    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      id: org.id,
      name: org.name,
      orgRoleName: INVITE_ROLE_NAME,
      isActive: true,
    });

    // --- Step 1c: the same token is single-use ------------------------------
    await tokenInput.fill(created.data.inviteLink);
    await watchToasts(page);
    const reuseResponse = page.waitForResponse(isAcceptRequest);
    await submit.click();

    const reused = await reuseResponse;
    expect(reused.status(), 'the used token must be rejected').toBe(410);
    expect(await reused.json()).toMatchObject({ success: false, error: 'GONE' });

    await expectToast(page, COPY.invalidToken);
    // The failure stays visible next to the field, not only in the transient toast.
    await expect(page.locator('#token-error')).toHaveText(COPY.invalidToken);
    await expect(tokenInput).toHaveAttribute('aria-invalid', 'true');
    await expect(tokenInput).toHaveValue(created.data.inviteLink);

    // The rejected replay changes nothing: still one organization, same role.
    const afterReplay = await memberships(page);
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0]).toMatchObject({ id: org.id, orgRoleName: INVITE_ROLE_NAME });

    // --- Step 2: the manager sees the accepted invitation and the member ----
    await logout(page);
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    await expectActiveOrg(page, org.id);

    await page.goto('/manage/invites');
    // Pending is the default view: an accepted invitation is no longer pending.
    await expect(rowFor(page, invitee.email)).toHaveCount(0);
    await expect(page.getByText(COPY.noInvitations, { exact: true })).toBeVisible();

    const acceptedList = page.waitForResponse((response) => isInvitesRequest(response, true));
    await page.getByRole('checkbox', { name: COPY.showAccepted }).check();
    expect((await acceptedList).status(), 'GET invites?isAccepted=true').toBe(200);

    const acceptedRow = rowFor(page, invitee.email);
    await expect(acceptedRow).toHaveCount(1);
    await expect(acceptedRow).toContainText(INVITE_ROLE_LABEL);
    await expect(acceptedRow).toContainText(COPY.accepted);
    // An accepted invitation is final: no revoke action is offered.
    await expect(acceptedRow.getByRole('button', { name: COPY.revoke, exact: true })).toHaveCount(
      0,
    );

    const acceptedInvitations = await getData<InvitationRow[]>(
      page,
      '/api/v1/organization/invites?isAccepted=true',
    );
    const acceptedInvitation = acceptedInvitations.filter(
      (invitation) => invitation.email === invitee.email,
    );
    expect(acceptedInvitation).toHaveLength(1);
    expect(acceptedInvitation[0]).toMatchObject({
      id: created.data.invitationId,
      orgRoleName: INVITE_ROLE_NAME,
      isAccepted: true,
    });

    const pendingInvitations = await getData<InvitationRow[]>(
      page,
      '/api/v1/organization/invites?isAccepted=false',
    );
    expect(
      pendingInvitations.filter((invitation) => invitation.email === invitee.email),
      'the accepted invitation must not be listed as pending',
    ).toEqual([]);

    // --- Step 2b: the organization members list -----------------------------
    await page.goto('/manage/members');
    const memberRow = rowFor(page, invitee.email);
    await expect(memberRow).toHaveCount(1);
    await expect(memberRow.getByTestId('member-role')).toHaveText(INVITE_ROLE_LABEL);
    // Accepting enrolls the invitee in the organization's default group.
    await expect(memberRow.getByText(group.name, { exact: true })).toBeVisible();

    const members = await getData<MemberRow[]>(page, '/api/v1/organization/members');
    const inviteeRows = members.filter((member) => member.id === invitee.id);
    expect(inviteeRows, 'exactly one membership row after the rejected replay').toHaveLength(1);
    expect(inviteeRows[0].email).toBe(invitee.email);
    expect(inviteeRows[0].orgRoleName).toBe(INVITE_ROLE_NAME);
    expect(inviteeRows[0].groups.map((row) => row.id)).toEqual([group.id]);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
