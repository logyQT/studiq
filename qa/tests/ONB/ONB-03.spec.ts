import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';
import { expect, loadTenant, loginAs, test } from '@qa/fixtures/qa-tenant';

/**
 * ONB-03 — joining an existing organization with an invite code (teacher role).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator with **no
 * organization** and a live `teacher` invitation minted by the org's manager —
 * the same graph MGR-INV produces. The legacy manual teacher account (password
 * `pass`) is never used.
 *
 * Tenant: `{ "profile": "content", members: [manager/admin], solo: invitee }` in
 * `qa/tests/profiles/ONB-03.json`, seeded once before the suite by
 * `bun scripts/qa-tenant.ts --all --run <suffix>`:
 *
 * - `members` declares the exact roster the invite needs: one `manager` who is
 *   the org `admin` (and therefore may mint a `teacher` invitation);
 * - `solo` declares the one account that belongs to **no** organization — the
 *   educator who joins (and the one who walks the bad-code path);
 * - the default group `G1` comes with the org, so `/setup/join` previews a real
 *   organization.
 *
 * The spec never seeds accounts, orgs, roles or groups. What stays in the test is
 * the case's own prerequisite — the invitation — because a code is single-use and
 * cannot live in `qa/.tenants/ONB-03.json`: it is minted through the real product
 * endpoint (`POST /api/v1/organization/invites`, the MGR-INV-01 request) by the
 * seeded manager, so the inviter authority, the `teacher` role scope and the
 * 7-day expiry are production-shaped. `afterEach` returns the tenant to its
 * seeded state (the joiner is removed through `DELETE /api/v1/organization/members`),
 * so the case's step 4 — and CI's retries/`--repeat-each` — start from an org-less
 * educator again instead of a half-joined one.
 *
 * Nothing global is written — no settings, flags, plans or platform rows — and no
 * other case's tenant is touched.
 */

const CASE = 'ONB-03';

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
const INVITEE = required(TENANT.users.invitee, 'invitee (the org-less educator)');

const INVITES_PATH = '/api/v1/organization/invites';
const MEMBERS_PATH = '/api/v1/organization/members';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

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

/** The shared stack this worker runs against (`qa/env.json` is authoritative). */
function workerEnv(): { appUrl: string } {
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    return JSON.parse(raw) as { appUrl: string };
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
    return { appUrl: 'http://localhost:3010' };
  }
}

function appUrl(): string {
  return process.env.QA_APP_URL ?? workerEnv().appUrl;
}

/** A manager API context with the tenant org active, so invites are org-scoped. */
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

/** The org's `teacher` role id — the role the case's invite grants. */
async function teacherRoleId(api: APIRequestContext): Promise<string> {
  const response = await api.get('/api/v1/organization/roles');
  expect(response.status(), 'GET /api/v1/organization/roles').toBe(200);
  const body = (await response.json()) as ApiEnvelope<Array<{ id: string; name: string }>>;
  const role = body.data.find((candidate) => candidate.name === 'teacher');
  if (!role) throw new Error(`tenant ${CASE}: the org has no "teacher" role`);
  return role.id;
}

/** Mint one live `teacher` invitation through the real MGR-INV-01 endpoint. */
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

/** Fresh per suite repetition: an invitation is single-use and time-limited. */
let invite: Invite;

async function currentOrgs(page: Page): Promise<OrgMembership[]> {
  const response = await page.request.get('/api/v1/me/orgs');
  expect(response.status(), 'GET /api/v1/me/orgs').toBe(200);
  const body = (await response.json()) as { success: boolean; data: OrgMembership[] };
  expect(body.success).toBe(true);
  return body.data;
}

test.beforeAll(async () => {
  const api = await managerApi();
  try {
    invite = await mintInvite(api, INVITEE.email, await teacherRoleId(api));
  } finally {
    await api.dispose();
  }
});

test.afterEach(async () => {
  // The case walks one educator: steps 1-3 join with the valid code, step 4 retries
  // with the invalid one, so the account has to be org-less again for "joins
  // nothing" to be provable. CI seeds once and retries/repeats against the same
  // tenant, so restore the seeded state after every test: the joiner is removed
  // through the product's own endpoint (which also drops its group membership and
  // seat). A run that failed before joining is fine — 404 means nothing to restore.
  const api = await managerApi();
  try {
    const removed = await api.delete(`${MEMBERS_PATH}?userId=${INVITEE.id}`);
    expect([200, 404], 'restore the org-less educator').toContain(removed.status());
  } finally {
    await api.dispose();
  }
});

test.describe('@case:ONB-03 @area:ONB @prio:P2 join an organization by invite code', () => {
  test('a valid code previews the organization and joins it as teacher', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, TENANT, 'invitee', {
      locale: 'pl',
      activeOrgId: null,
      waitFor: /\/setup$/,
    });
    // Prerequisite: the teacher has no organization, so /setup is the chooser.
    expect(await currentOrgs(page)).toEqual([]);

    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Witaj w StudiQ', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Dołącz do istniejącej organizacji/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Utwórz własną klasę/ })).toBeVisible();

    // 1. "Dołącz do istniejącej organizacji"
    await page.getByRole('button', { name: /Dołącz do istniejącej organizacji/ }).click();
    await expect(page).toHaveURL(/\/setup\/join$/);
    await expect(
      page.getByRole('heading', { name: 'Dołącz do organizacji', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Kod zaproszenia', { exact: true })).toBeVisible();

    // 2. Paste the invite code from MGR-INV.
    await page.locator('#invite-code').fill(invite.token);

    // 3. Preview: "Zostałeś zaproszony do …", org name, role, join button.
    const preview = page.locator('main [data-slot="card"]');
    await expect(preview).toHaveCount(1);
    await expect(page.getByText(/Zostałeś zaproszony do/i)).toBeVisible();
    await expect(preview).toContainText(ORG.name);
    await expect(preview.getByText('teacher', { exact: true })).toBeVisible();
    const joinButton = page.getByRole('button', { name: 'Dołącz do organizacji', exact: true });
    await expect(joinButton).toBeVisible();
    await expect(joinButton).toBeEnabled();

    // Previewing must not consume the invitation or add a membership.
    expect(await currentOrgs(page)).toEqual([]);

    await joinButton.click();

    // Accepted: the teacher dashboard, with the org in the switcher.
    await expect(page).toHaveURL(/\/edu$/);
    const switcher = page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]');
    await expect(switcher).toContainText(ORG.name);
    await expect(switcher).toContainText('Teacher');

    // The accepted invite granted exactly this org with the teacher role.
    const orgs = await currentOrgs(page);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      id: ORG.id,
      name: ORG.name,
      orgRoleName: 'teacher',
      isActive: true,
    });

    // Onboarding is over: /setup sends the joined teacher back to the dashboard.
    await page.goto('/setup');
    await expect(page).toHaveURL(/\/edu$/);
    await expect(page.getByRole('heading', { name: 'Witaj w StudiQ', exact: true })).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('an invalid code shows the documented error and joins nothing', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, TENANT, 'invitee', {
      locale: 'pl',
      activeOrgId: null,
      waitFor: /\/setup$/,
    });
    expect(await currentOrgs(page)).toEqual([]);

    // 4. Repeat with the invalid code "abc".
    await page.goto('/setup/join');
    await expect(
      page.getByRole('heading', { name: 'Dołącz do organizacji', exact: true }),
    ).toBeVisible();
    await page.locator('#invite-code').fill('abc');

    await expect(
      page.getByText('Ten kod zaproszenia jest nieprawidłowy lub wygasł.', { exact: true }),
    ).toBeVisible();

    // No organization preview and no way to join.
    await expect(page.getByText(/Zostałeś zaproszony do/i)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Dołącz do organizacji', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('main [data-slot="card"]')).toHaveCount(0);

    // The failed attempt changed nothing: still org-less, and still onboarding.
    expect(await currentOrgs(page)).toEqual([]);
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Witaj w StudiQ', exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
