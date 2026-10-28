import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as apiRequest, expect, test, type Browser, type Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * MGR-INV-03 — cancelling a pending organization invitation (/manage/invites).
 *
 * Prerequisite (reconciled with the tenant seeder): a manager whose organization
 * has one **pending** invitation, and the copyable `/join?token=…` link of that
 * invitation. The legacy manual seed (`manager@dev.local`, password `pass`) is
 * never used.
 *
 * Tenant: `tenantKey('qa/cases/MGR-INV-03.md', <title>, 'qa-shared')::<run suffix>`.
 * Every org/user/role id is `tenantId(key, entity)`, so a run is reproducible by
 * pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which gives each
 * independent run its own organization, manager and invitation.
 *
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`) and mints the invitation through the real
 * `POST /api/v1/organization/invites` endpoint — the same request the page makes —
 * so the inviter authority, the target role and the 7-day expiry are real. The
 * invitee account is deliberately **not** created: an invitation is addressed to
 * an e-mail, and the case never accepts it. Nothing global is written — no
 * settings, flags, plans or platform rows — and no other case's tenant is touched.
 *
 * Acceptance points:
 * 1. „Anuluj” in the invitation row opens „Anulować zaproszenie?”; confirming
 *    shows the toast „Zaproszenie anulowane” and the row leaves the pending list
 *    (closing the dialog leaves it untouched).
 * 2. The previously copied `/join?token=…` link stops working: the public preview
 *    is gone (404) and the join screen treats it as an invalid invitation
 *    (redirect to /register + „Nieprawidłowy lub wygasły kod zaproszenia”).
 */

const CASE_FILE = 'qa/cases/MGR-INV-03.md';
const TITLE = 'MGR-INV-03 cancel a pending invitation';
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
  /** Address the invitation is addressed to; it never accepts, so no account exists. */
  inviteeEmail: string;
  invite: { id: string; token: string; link: string };
}

/**
 * Resolve the shared Supabase admin credentials. `QA_SUPABASE_*` wins; otherwise
 * the routine `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, then the
 * worker's `qa/env.json`, then the shared local defaults.
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Seed the case's org + manager and mint one live `teacher` invitation. */
async function seedCaseTenant(baseURL: string): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-mgr-inv03-${RUN_SUFFIX}` };
  const groupId = tenantId(key, 'group:default');
  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  // Only the address is used: the invitation targets an e-mail, not an account.
  const invitee = buildAccount(key, 'invitee', 'educator', { name: 'QA invitee' });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { id: groupId, name: 'G1', isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [],
    ownerOrgRole: 'admin',
  });

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
        email: invitee.email,
        targetOrgRoleId: teacherRoleId,
        organizationId: org.id,
        locale: 'pl',
      },
    });
    expect(created.status(), 'POST /api/v1/organization/invites').toBe(201);
    const body = (await created.json()) as {
      success: boolean;
      data: { invitationId: string; inviteCode: string; inviteLink: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.inviteCode).toMatch(/^[0-9a-f]{32}$/);
    expect(body.data.inviteLink).toContain(`/join?token=${body.data.inviteCode}`);

    return {
      key,
      org,
      manager,
      inviteeEmail: invitee.email,
      invite: {
        id: body.data.invitationId,
        token: body.data.inviteCode,
        link: body.data.inviteLink,
      },
    };
  } finally {
    await api.dispose();
  }
}

/**
 * Polish copy is asserted because the case quotes the Polish UI; the login helper
 * pins `NEXT_LOCALE=pl`, so a locale cookie left by an earlier case cannot change
 * the strings under test.
 */
async function pinPolish(page: Page, baseURL: string): Promise<void> {
  const { hostname } = new URL(baseURL);
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
}

/** Real login through the API, so the session cookie lives in the page context. */
async function loginAsManager(page: Page, tenant: CaseTenant, baseURL: string): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: tenant.manager.email, password: tenant.manager.password },
  });
  expect(response.status(), `login ${tenant.manager.email}`).toBe(200);
  await pinPolish(page, baseURL);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/manage$/);
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
  let tenant: CaseTenant;

  test.beforeAll(async () => {
    const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3010';
    tenant = await seedCaseTenant(baseURL);
    console.log(`MGR-INV-03 tenant key: ${tenant.key} (org ${tenant.org.id})`);
  });

  test('revoking cancels the invitation and kills its join link', async ({
    page,
    browser,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';

    // Precondition: before the manager touches it, the copied link is live — the
    // join screen renders the form with the invited address. Without this the
    // "link stops working" assertion below could pass for a link that never worked.
    const live = await openAnonymous(browser, origin);
    try {
      await live.page.goto(tenant.invite.link);
      await expect(live.page).toHaveURL(new RegExp(`/join\\?token=${tenant.invite.token}`));
      await expect(live.page.getByText('Dołącz do organizacji', { exact: true })).toBeVisible();
      const invitedEmail = live.page.locator('input[name="email"]');
      await expect(invitedEmail).toHaveValue(tenant.inviteeEmail);
      await expect(invitedEmail).toHaveAttribute('readonly', '');
      await expect(live.page.getByRole('button', { name: 'Aktywuj konto' })).toBeVisible();
      expect(live.errors, 'uncaught page errors on the live join screen').toEqual([]);
    } finally {
      await live.page.context().close();
    }

    await loginAsManager(page, tenant, origin);

    // The dashboard settles the active organization first; the case's own entry
    // point is the „Zaproszenia” sidebar item.
    await expect(
      page.locator('[data-slot="sidebar-header"] [data-sidebar="menu-button"]'),
    ).toContainText(tenant.org.name);
    await page.locator('a[href="/manage/invites"]').first().click();
    await expect(page).toHaveURL(/\/manage\/invites$/);
    await expect(page.getByRole('heading', { name: 'Zaproszenia', exact: true })).toBeVisible();

    // Prerequisite: the invitation is listed as pending.
    const row = page.getByRole('row', {
      name: new RegExp(escapeRegExp(tenant.inviteeEmail)),
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
    const listResponse = await page.request.get('/api/v1/organization/invites?isAccepted=false');
    expect(listResponse.status(), 'GET /api/v1/organization/invites').toBe(200);
    const list = (await listResponse.json()) as {
      success: boolean;
      data: Array<{ id: string; email: string }>;
    };
    expect(list.success).toBe(true);
    expect(list.data.filter((invitation) => invitation.id === tenant.invite.id)).toEqual([]);

    // 2. The previously copied link no longer resolves.
    const preview = await page.request.get(
      `/api/v1/organization/invites?token=${tenant.invite.token}`,
    );
    expect(preview.status(), 'GET /api/v1/organization/invites?token=<revoked>').toBe(404);

    const dead = await openAnonymous(browser, origin);
    try {
      await dead.page.goto(tenant.invite.link);
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
