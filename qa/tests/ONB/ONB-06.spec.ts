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
 * ONB-06 — student joins a class with an invite code (/app/join).
 *
 * Prerequisite (reconciled with the tenant seeder): a student with **no
 * organization** — the manual seed's „Student3” — and a fresh `member`
 * invitation for their e-mail, i.e. what MGR-INV-01 produces. The legacy manual
 * accounts (`student3@dev.local`, password `pass`) are never used.
 *
 * Tenant: `tenantKey('qa/cases/ONB-06.md', <title>, 'qa-shared')::<run suffix>`.
 * Every org/user/role id is `tenantId(key, entity)`, so a run is reproducible by
 * pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which gives each
 * independent run its own org, its own invitation and its own expired code.
 *
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`) instead of reading `qa/.tenants/ONB-06.json`
 * because a valid invite is single-use: a file seeded out of band could not be
 * reused across the three independent runs. Nothing global is written — no
 * settings, flags, plans or platform rows — and no other case's tenant is
 * touched.
 */

const CASE_FILE = 'qa/cases/ONB-06.md';
const TITLE = 'ONB-06 student joins a class with an invite code';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

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

interface CaseTenant {
  key: string;
  org: { id: string; name: string };
  student: SeedAccount;
  /** Second org-less student: walks the invalid/expired codes, never joins. */
  outsider: SeedAccount;
  invite: { token: string; id: string };
  expiredInvite: { token: string };
}

interface OrgMembership {
  id: string;
  name: string;
  orgRoleName: string;
  isActive: boolean;
}

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
 * Seed the case's org + manager, two org-less students and the codes the case
 * needs. Both invitations are minted through the real MGR-INV-01 endpoint, so the
 * inviter authority and the `member` role are production-shaped; the second is
 * then given a past expiry so the „wygasły kod” path is real too.
 */
async function seedCaseTenant(baseURL: string): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-onb06-${RUN_SUFFIX}` };
  const groupId = tenantId(key, 'group:default');
  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });
  const outsider = buildAccount(key, 'outsider', 'student', { name: 'QA other student' });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { id: groupId, name: 'G1', isDefault: true },
    extraGroups: [],
    owner: manager,
    // Both students deliberately start with no organization: the case's precondition.
    members: [],
    ownerOrgRole: 'admin',
  });
  const studentAccount = await ensureAccount(db, student);
  const outsiderAccount = await ensureAccount(db, outsider);

  const memberRoleId = seeded.roleIds.member;
  if (!memberRoleId) throw new Error(`seed ${key}: member role is missing`);

  const api = await apiRequest.newContext({ baseURL });
  try {
    const managerLogin = await api.post('/api/v1/auth/login', {
      data: { email: manager.email, password: manager.password },
    });
    expect(managerLogin.status(), `manager login (${manager.email})`).toBe(200);

    async function invite(email: string): Promise<{ token: string; id: string }> {
      const created = await api.post('/api/v1/organization/invites', {
        data: { email, targetOrgRoleId: memberRoleId, organizationId: org.id, locale: 'pl' },
      });
      expect(created.status(), 'POST /api/v1/organization/invites').toBe(201);
      const body = (await created.json()) as {
        success: boolean;
        data: { invitationId: string; inviteCode: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.inviteCode).toMatch(/^[0-9a-f]{32}$/);
      return { token: body.data.inviteCode, id: body.data.invitationId };
    }

    const liveInvite = await invite(studentAccount.email);
    const staleInvite = await invite(outsiderAccount.email);

    const { error } = await db
      .from('invitations')
      .update({ expires_at: '2020-01-01T00:00:00.000Z' })
      .eq('id', staleInvite.id);
    if (error) throw new Error(`expire invite ${staleInvite.id}: ${error.message}`);

    return {
      key,
      org,
      student: studentAccount,
      outsider: outsiderAccount,
      invite: liveInvite,
      expiredInvite: { token: staleInvite.token },
    };
  } finally {
    await api.dispose();
  }
}

/** Real login through the API, so the session cookie lives in the page context. */
async function login(page: Page, account: SeedAccount): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);
}

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

test.describe('@case:ONB-06 @area:ONB @prio:P2 student joins a class by code', () => {
  let tenant: CaseTenant;

  test.beforeAll(async () => {
    const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3010';
    tenant = await seedCaseTenant(baseURL);
    console.log(`ONB-06 tenant key: ${tenant.key} (org ${tenant.org.id})`);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    // The case quotes Polish copy; pin the locale instead of trusting a profile.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

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

    await login(page, tenant.student);
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
    await field.fill(tenant.invite.token);
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(notifications(page)).toContainText(COPY.success);
    // The field is cleared for the next code, without a hard reload (#316).
    await expect(field).toHaveValue('');

    // The switcher immediately shows the joined class, no manual refresh needed.
    await expect(orgSwitcher(page)).toContainText(tenant.org.name);

    expect(acceptCalls, 'only the valid submit reached the accept endpoint').toHaveLength(1);
    expect(JSON.parse(acceptCalls[0])).toEqual({ token: tenant.invite.token });

    // The membership is real: one org, member role, active.
    const orgs = await currentOrgs(page);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      id: tenant.org.id,
      name: tenant.org.name,
      orgRoleName: 'member',
      isActive: true,
    });

    // Refreshing keeps the class in the switcher.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/join$/);
    await expect(orgSwitcher(page)).toContainText(tenant.org.name);
    await orgSwitcher(page).click();
    await expect(page.getByRole('menu')).toContainText(COPY.orgsLabel);
    await expect(page.getByRole('menuitem', { name: new RegExp(tenant.org.name) })).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });

  test('an invalid and an expired code show the documented error and join nothing', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await login(page, tenant.outsider);
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
    await field.fill(tenant.expiredInvite.token);
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
