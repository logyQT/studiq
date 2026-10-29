import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';
import { createSeedDb } from '#test/helpers/tenant-seed';
import { expect, loadTenant, loginAs, test } from '@qa/fixtures/qa-tenant';

/**
 * ONB-06 — student joins a class with an invite code (/app/join).
 *
 * Prerequisite (reconciled with the tenant seeder): a student with **no
 * organization** — the manual seed's „Student3” — and a fresh `member`
 * invitation for their e-mail, i.e. what MGR-INV-01 produces. The legacy manual
 * accounts (`student3@dev.local`, password `pass`) are never used.
 *
 * Tenant: the `org-limit` profile, the only seeded shape that carries accounts
 * which are **not** org members (`invitee1`, `invitee2`) next to an org with an
 * `admin` manager and its default group `G1`:
 *
 *   bun scripts/qa-tenant.ts ONB-06 --fresh
 *
 * The spec never seeds accounts, orgs or groups. What stays in the test is the
 * case's own prerequisite — the invitation — because a code is single-use and a
 * backdated one cannot live in `qa/.tenants/ONB-06.json`:
 *
 * - both `member` invitations are minted through the real product endpoint
 *   (`POST /api/v1/organization/invites`, the MGR-INV-01 request) by the seeded
 *   manager, so the inviter authority, role scope and expiry are production-shaped;
 * - the second one is backdated through the service-role client to make the
 *   „wygasły kod” path a real expired row (no API exposes `expires_at`);
 * - `afterAll` returns the tenant to its seeded state (the joiner is removed
 *   through `DELETE /api/v1/organization/members`), so CI's retries and
 *   `--repeat-each` start from an org-less student again instead of a half-joined
 *   one.
 *
 * Nothing global is written — no settings, flags, plans or platform rows — and no
 * other case's tenant is touched.
 */

const CASE = 'ONB-06';

const TENANT = loadTenant(CASE);

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(
      `${CASE} fixture has no ${what}: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
    );
  }
  return value;
}

const ORG = required(TENANT.org, 'organization');
const MANAGER = required(TENANT.users.manager, 'manager (admin)');
const STUDENT = required(TENANT.users.invitee1, 'invitee1 (the org-less student)');
const OUTSIDER = required(TENANT.users.invitee2, 'invitee2 (the org-less outsider)');

/** Polish copy quoted by the case; the default suite locale. */
const COPY = {
  joinTitle: 'Dołącz do klasy',
  joinDescription: 'Wpisz kod zaproszenia lub wklej link zaproszenia, aby dołączyć do klasy',
  fieldLabel: 'Kod zaproszenia',
  submit: 'Dołącz',
  success: 'Dołączyłeś do klasy!',
  invalid: 'Nieprawidłowy lub wygasły kod zaproszenia',
  standalone: 'StudiQ',
  noOrg: 'Nie należysz do żadnej organizacji',
  orgsLabel: 'Organizacje',
} as const;

const ACCEPT_PATH = '/api/v1/organization/invites/accept';
const INVITES_PATH = '/api/v1/organization/invites';
const MEMBERS_PATH = '/api/v1/organization/members';

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface Invite {
  id: string;
  token: string;
}

interface OrgMembership {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** The shared stack this worker runs against (`qa/env.json` is authoritative). */
function workerEnv(): { appUrl: string; supabaseUrl?: string } {
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    return JSON.parse(raw) as { appUrl: string; supabaseUrl?: string };
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
    return { appUrl: 'http://localhost:3010' };
  }
}

/**
 * Resolve the shared Supabase admin credentials (env → CI env → worker config →
 * local defaults). Used only to backdate the expired invitation.
 */
function resolveSupabase(): { url: string; serviceKey: string } {
  return {
    url:
      process.env.QA_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      workerEnv().supabaseUrl ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

function appUrl(): string {
  return process.env.QA_APP_URL ?? workerEnv().appUrl;
}

/** A manager API context with the tenant org active, so roles/invites are org-scoped. */
async function managerApi(): Promise<APIRequestContext> {
  const api = await apiRequest.newContext({ baseURL: appUrl() });
  const login = await api.post('/api/v1/auth/login', {
    data: { email: MANAGER.email, password: MANAGER.password },
  });
  expect(login.status(), `manager login (${MANAGER.email})`).toBe(200);
  const switched = await api.post('/api/v1/me/orgs/switch', { data: { orgId: ORG.id } });
  expect([200, 204], 'activate the tenant org').toContain(switched.status());
  return api;
}

/** The org's `member` role id — the role MGR-INV-01 grants. */
async function memberRoleId(api: APIRequestContext): Promise<string> {
  const response = await api.get('/api/v1/organization/roles');
  expect(response.status(), 'GET /api/v1/organization/roles').toBe(200);
  const body = (await response.json()) as ApiEnvelope<Array<{ id: string; name: string }>>;
  const role = body.data.find((candidate) => candidate.name === 'member');
  if (!role) throw new Error(`tenant ${CASE}: the org has no "member" role`);
  return role.id;
}

/** Mint one live invitation through the real MGR-INV-01 endpoint. */
async function mintInvite(
  api: APIRequestContext,
  email: string,
  targetOrgRoleId: string,
): Promise<Invite> {
  const created = await api.post(INVITES_PATH, {
    data: { email, targetOrgRoleId, organizationId: ORG.id, locale: 'pl' },
  });
  expect(created.status(), `POST ${INVITES_PATH}`).toBe(201);
  const body = (await created.json()) as ApiEnvelope<{
    invitationId: string;
    inviteCode: string;
  }>;
  expect(body.success).toBe(true);
  expect(body.data.inviteCode).toMatch(/^[0-9a-f]{32}$/);
  return { token: body.data.inviteCode, id: body.data.invitationId };
}

/** The code MGR-INV-01 hands out for the live path and the one for the expired path. */
let invite: Invite;
let expiredInvite: Invite;

async function currentOrgs(page: Page): Promise<OrgMembership[]> {
  const response = await page.request.get('/api/v1/me/orgs');
  expect(response.status(), 'GET /api/v1/me/orgs').toBe(200);
  const body = (await response.json()) as { success: boolean; data: OrgMembership[] };
  expect(body.success).toBe(true);
  return body.data;
}

function orgSwitcher(page: Page) {
  return page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]').first();
}

/** Sonner renders every toast inside this persistent live region. */
function notifications(page: Page) {
  return page.locator('section[aria-label^="Notifications"]');
}

/** The inline, persistent twin of the toast (the toast alone is transient). */
function fieldError(page: Page) {
  return page.locator('#token-error');
}

function isAcceptRequest(response: { url(): string; request(): { method(): string } }): boolean {
  return response.url().includes(ACCEPT_PATH) && response.request().method() === 'POST';
}

test.beforeAll(async () => {
  const api = await managerApi();
  try {
    const roleId = await memberRoleId(api);
    invite = await mintInvite(api, STUDENT.email, roleId);
    expiredInvite = await mintInvite(api, OUTSIDER.email, roleId);
  } finally {
    await api.dispose();
  }

  // No API exposes `expires_at`, and a profile cannot carry a row that is already
  // expired: backdate this tenant's own invitation so „wygasły kod” is a real
  // expired invitation rather than a fabricated status.
  const db = createSeedDb(resolveSupabase());
  const { error } = await db
    .from('invitations')
    .update({ expires_at: '2020-01-01T00:00:00.000Z' })
    .eq('id', expiredInvite.id);
  if (error) throw new Error(`expire invite ${expiredInvite.id}: ${error.message}`);
});

test.afterAll(async () => {
  // CI seeds once and retries against the same tenant, so the tenant has to end
  // where it started: the joiner is removed through the product's own endpoint
  // (which also drops its group membership and seat). A no-op run (test failed
  // before joining) is fine — 404 means there is nothing to restore.
  const api = await managerApi();
  try {
    const removed = await api.delete(`${MEMBERS_PATH}?userId=${STUDENT.id}`);
    expect([200, 404], 'restore the org-less student').toContain(removed.status());
  } finally {
    await api.dispose();
  }
});

test.describe('@case:ONB-06 @area:ONB @prio:P2 student joins a class by code', () => {
  test('a student without an organization joins with a valid code and sees it in the switcher', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    /** Every accept call the page makes, so "an empty field sends nothing" is provable. */
    const acceptCalls: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes(ACCEPT_PATH)) {
        acceptCalls.push(request.postData() ?? '');
      }
    });

    await loginAs(page, TENANT, 'invitee1', { locale: 'pl', activeOrgId: null });
    // Precondition on screen: this student belongs to no organization.
    expect(await currentOrgs(page)).toEqual([]);

    await page.goto('/app');
    await expect(orgSwitcher(page)).toContainText(COPY.standalone);
    await expect(orgSwitcher(page)).toContainText('Student');

    // 1. "Dołącz do klasy" from the standalone switcher.
    await orgSwitcher(page).click();
    await expect(page.getByRole('menu')).toContainText(COPY.noOrg);
    await page.getByRole('menuitem', { name: COPY.joinTitle }).click();
    await expect(page).toHaveURL(/\/app\/join$/);

    await expect(page.locator('main [data-slot="card-title"]')).toHaveText(COPY.joinTitle);
    await expect(page.locator('main [data-slot="card-description"]')).toHaveText(
      COPY.joinDescription,
    );

    const field = page.getByLabel(COPY.fieldLabel);
    await expect(field).toHaveValue('');
    const submit = page.getByRole('button', { name: COPY.submit, exact: true });
    await expect(submit).toBeDisabled();

    // "Puste pole – przycisk nie wysyła żądania": neither the disabled button nor
    // the Enter key may reach the API. Both attempts are proven below by the fact
    // that the only accept call in this test is the valid one.
    await submit.click({ force: true });
    await field.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/join$/);

    // 2. Paste the code from MGR-INV-01 and join.
    await field.fill(invite.token);
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(notifications(page)).toContainText(COPY.success);
    // The field is cleared for the next code, without a hard reload (#316).
    await expect(field).toHaveValue('');

    // The switcher immediately shows the joined class, no manual refresh needed.
    await expect(orgSwitcher(page)).toContainText(ORG.name);

    expect(acceptCalls, 'only the valid submit reached the accept endpoint').toHaveLength(1);
    expect(JSON.parse(acceptCalls[0])).toEqual({ token: invite.token });

    // The membership is real: one org, member role, active.
    const orgs = await currentOrgs(page);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      id: ORG.id,
      name: ORG.name,
      orgRoleName: 'member',
      isActive: true,
    });

    // Refreshing keeps the class in the switcher.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/join$/);
    await expect(orgSwitcher(page)).toContainText(ORG.name);
    await orgSwitcher(page).click();
    await expect(page.getByRole('menu')).toContainText(COPY.orgsLabel);
    await expect(page.getByRole('menuitem', { name: new RegExp(ORG.name) })).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('an invalid and an expired code show the documented error and join nothing', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, TENANT, 'invitee2', { locale: 'pl', activeOrgId: null });
    expect(await currentOrgs(page)).toEqual([]);

    // 3. Repeat with a bad code — reached directly, as the case allows.
    await page.goto('/app/join');
    await expect(page.locator('main [data-slot="card-title"]')).toHaveText(COPY.joinTitle);
    const field = page.getByLabel(COPY.fieldLabel);
    const submit = page.getByRole('button', { name: COPY.submit, exact: true });

    await field.fill('abc');
    const [invalidResponse] = await Promise.all([
      page.waitForResponse(isAcceptRequest),
      submit.click(),
    ]);
    expect(invalidResponse.status(), 'unknown code').toBe(404);
    await expect(notifications(page)).toContainText(COPY.invalid);
    await expect(fieldError(page)).toHaveText(COPY.invalid);

    // The expired code is the same user-visible failure: a code that is no longer
    // live. Reload first so the two attempts each start from a clean toast stack.
    expect(await currentOrgs(page)).toEqual([]);
    await page.goto('/app/join');
    await field.fill(expiredInvite.token);
    // Editing clears the previous inline error before the next attempt.
    await expect(fieldError(page)).toHaveCount(0);
    const [expiredResponse] = await Promise.all([
      page.waitForResponse(isAcceptRequest),
      submit.click(),
    ]);
    expect(expiredResponse.status(), 'expired code').toBe(410);
    await expect(notifications(page)).toContainText(COPY.invalid);
    await expect(fieldError(page)).toHaveText(COPY.invalid);

    // No membership was created and the student is still standalone.
    expect(await currentOrgs(page)).toEqual([]);
    await expect(orgSwitcher(page)).toContainText(COPY.standalone);
    await orgSwitcher(page).click();
    await expect(page.getByRole('menu')).toContainText(COPY.noOrg);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
