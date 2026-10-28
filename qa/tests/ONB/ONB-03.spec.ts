import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as apiRequest, expect, test, type Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  ensureAccount,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * ONB-03 — joining an existing organization with an invite code (teacher role).
 *
 * Prerequisite (reconciled with the tenant seeder): an educator with **no
 * organization** and a live `teacher` invitation minted by the org's manager —
 * the same graph MGR-INV produces. The legacy manual seed (`teacher1@dev.local`,
 * password `pass`) is never used.
 *
 * Tenant: `tenantKey('qa/cases/ONB-03.md', <title>, 'qa-shared')::<run suffix>`.
 * Every org/user/role id is `tenantId(key, entity)`, so a run is reproducible by
 * pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which gives each
 * independent run its own org and its own single-use invite.
 *
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`) instead of reading `qa/.tenants/ONB-03.json`
 * so the run stays self-contained: the invite must be unconsumed, and an invite
 * is single-use. Nothing global is written — no settings, flags, plans or
 * platform rows — and no other case's tenant is touched.
 */

const CASE_FILE = 'qa/cases/ONB-03.md';
const TITLE = 'ONB-03 join an existing organization with an invite code';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface CaseTenant {
  key: string;
  org: { id: string; name: string };
  manager: SeedAccount;
  /** Educator who accepts the invite. */
  invitee: SeedAccount;
  /** Second educator, used for the invalid-code path; never joins. */
  outsider: SeedAccount;
  invite: { token: string; id: string };
}

interface OrgMembership {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

async function currentOrgs(page: Page): Promise<OrgMembership[]> {
  const response = await page.request.get('/api/v1/me/orgs');
  expect(response.status(), 'GET /api/v1/me/orgs').toBe(200);
  const body = (await response.json()) as { success: boolean; data: OrgMembership[] };
  expect(body.success).toBe(true);
  return body.data;
}

/** Real login through the API, so the session cookie lives in the page context. */
async function login(page: Page, account: SeedAccount): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);
}

/**
 * Resolve the shared Supabase admin credentials. `QA_SUPABASE_*` wins; otherwise
 * the routine `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (CI), then
 * the worker's `qa/env.json`, then the shared local defaults.
 */
function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url:
      process.env.QA_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      fromEnvJson ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

/**
 * Seed the case's org + manager, two org-less educators, and one live `teacher`
 * invitation created through the real MGR-INV endpoint (so the inviter, the
 * expiry and the `can_assign_org_role` authority match production).
 */
async function seedCaseTenant(baseURL: string): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-onb03-${RUN_SUFFIX}` };
  const groupId = tenantId(key, 'group:default');
  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const invitee = buildAccount(key, 'teacher', 'educator', { name: 'QA invitee teacher' });
  const outsider = buildAccount(key, 'outsider', 'educator', { name: 'QA other teacher' });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { id: groupId, name: 'G1', isDefault: true },
    extraGroups: [],
    owner: manager,
    // Both educators deliberately start with no org: the case's prerequisite.
    members: [],
    ownerOrgRole: 'admin',
  });
  const inviteeAccount = await ensureAccount(db, invitee);
  const outsiderAccount = await ensureAccount(db, outsider);

  const teacherRoleId = seeded.roleIds.teacher;
  if (!teacherRoleId) throw new Error(`seed ${key}: teacher role is missing`);

  const api = await apiRequest.newContext({ baseURL });
  try {
    const managerLogin = await api.post('/api/v1/auth/login', {
      data: { email: manager.email, password: manager.password },
    });
    expect(managerLogin.status(), `manager login (${manager.email})`).toBe(200);

    const created = await api.post('/api/v1/organization/invites', {
      data: {
        email: inviteeAccount.email,
        targetOrgRoleId: teacherRoleId,
        organizationId: org.id,
        locale: 'pl',
      },
    });
    expect(created.status(), 'POST /api/v1/organization/invites').toBe(201);
    const body = (await created.json()) as {
      success: boolean;
      data: { invitationId: string; inviteCode: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.inviteCode).toMatch(/^[0-9a-f]{32}$/);

    return {
      key,
      org,
      manager,
      invitee: inviteeAccount,
      outsider: outsiderAccount,
      invite: { token: body.data.inviteCode, id: body.data.invitationId },
    };
  } finally {
    await api.dispose();
  }
}

test.describe('@case:ONB-03 @area:ONB @prio:P2 join an organization by invite code', () => {
  let tenant: CaseTenant;

  // The graph is created once per spec run; each test signs in as its own
  // seeded user, so the two paths share no mutable state.
  test.beforeAll(async () => {
    const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3010';
    tenant = await seedCaseTenant(baseURL);
    console.log(`ONB-03 tenant key: ${tenant.key} (org ${tenant.org.id})`);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    // A Polish teacher: the case quotes Polish copy, so pin the locale instead
    // of relying on the default of a fresh profile.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('a valid code previews the organization and joins it as teacher', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await login(page, tenant.invitee);
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
    await page.locator('#invite-code').fill(tenant.invite.token);

    // 3. Preview: "Zostałeś zaproszony do …", org name, role, join button.
    const preview = page.locator('main [data-slot="card"]');
    await expect(preview).toHaveCount(1);
    await expect(page.getByText(/Zostałeś zaproszony do/i)).toBeVisible();
    await expect(preview).toContainText(tenant.org.name);
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
    await expect(switcher).toContainText(tenant.org.name);
    await expect(switcher).toContainText('Teacher');

    // The accepted invite granted exactly this org with the teacher role.
    const orgs = await currentOrgs(page);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      id: tenant.org.id,
      name: tenant.org.name,
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

    await login(page, tenant.outsider);
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
