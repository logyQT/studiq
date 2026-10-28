import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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
 * MGR-MEM-03 — the last admin cannot demote themselves or leave the organization.
 *
 * Prerequisite (reconciled with the tenant seeder): a manager who is the **only**
 * `admin` of one organization, plus one teacher and one member so the page has
 * other rows to contrast against. The legacy manual seed (`manager@dev.local`,
 * password `pass`) is never used.
 *
 * Tenant: `tenantKey('qa/cases/MGR-MEM-03.md', <title>, 'qa-shared')::<run suffix>`.
 * Every org/user/role id is `tenantId(key, entity)`, so a run is reproducible by
 * pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which gives each
 * independent run its own organization, admin and members.
 *
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`). Nothing global is written — no settings,
 * flags, plans or platform rows — and no other case's tenant is touched.
 *
 * Acceptance points:
 * 1. On `/manage/members` the admin's own row renders no role select and no
 *    "remove member" control (only the „(ty)” self marker), so the UI blocks
 *    step 1 and step 2 before any request is made.
 * 2. The same two actions issued directly against the API the page calls —
 *    `PUT /api/v1/organization/members` for the own role,
 *    `DELETE /api/v1/organization/members?userId=<self>` — are rejected with
 *    `403 FORBIDDEN`.
 * 3. The organization is left intact: the caller is still its `admin`, the org
 *    still has exactly one admin, and no membership disappeared.
 * 4. Adjacent regression: the guard is self-scoped, not a blanket denial — the
 *    same admin can still change another member's role and remove another
 *    member through those endpoints.
 */

const CASE_FILE = 'qa/cases/MGR-MEM-03.md';
const TITLE = 'MGR-MEM-03 self role change and self removal are blocked';
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
  teacher: SeedAccount;
  student: SeedAccount;
  roles: { admin: string; teacher: string; member: string };
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

/**
 * Seed the case's org: one `admin` (the manager, the only admin), one `teacher`
 * and one `member`. The manager is the org owner, exactly like an organization
 * created through the app.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-mgr-mem03-${RUN_SUFFIX}` };
  const groupId = tenantId(key, 'group:default');
  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const teacher = buildAccount(key, 'teacher', 'educator', {
    name: 'QA teacher',
    orgRole: 'teacher',
  });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: { id: groupId, name: 'G1', isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [teacher, student],
    ownerOrgRole: 'admin',
  });

  const { admin, teacher: teacherRoleId, member } = seeded.roleIds;
  if (!admin || !teacherRoleId || !member) {
    throw new Error(`seed ${key}: one of the org roles (admin/teacher/member) is missing`);
  }

  return {
    key,
    org,
    manager: seeded.owner,
    teacher: seeded.members[0],
    student: seeded.members[1],
    roles: { admin, teacher: teacherRoleId, member },
  };
}

/**
 * Real login through the API, then boot the app with the locale the case's copy
 * is written in and the tenant's organization active (the cookie the app writes
 * on org creation / switch). Without it the first org-scoped request would run
 * with no org context.
 */
async function loginAsManager(page: Page, baseURL: string, tenant: CaseTenant): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: tenant.manager.email, password: tenant.manager.password },
  });
  expect(response.status(), `login ${tenant.manager.email}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: tenant.org.id, domain: hostname, path: '/', httpOnly: true },
  ]);

  await page.goto('/login');
  await expect(page).toHaveURL(/\/manage$/);
}

test.describe('@case:MGR-MEM-03 @area:MGR @prio:P1 self role change and self removal', () => {
  let tenant: CaseTenant;

  test.beforeAll(async () => {
    tenant = await seedCaseTenant();
    console.log(
      `MGR-MEM-03 tenant key: ${tenant.key} (org ${tenant.org.id}, admin ${tenant.manager.email})`,
    );
  });

  test('the only admin cannot demote or remove themselves', async ({ page, baseURL }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';

    await loginAsManager(page, origin, tenant);

    // Enter the page the way a manager does: dashboard → „Członkowie” in the sidebar.
    await page.locator('a[href="/manage/members"]').first().click();
    await expect(page).toHaveURL(/\/manage\/members$/);
    await expect(page.getByRole('heading', { name: 'Członkowie', exact: true })).toBeVisible();

    const ownRow = page.getByRole('row', { name: new RegExp(escapeRegExp(tenant.manager.email)) });
    const teacherRow = page.getByRole('row', {
      name: new RegExp(escapeRegExp(tenant.teacher.email)),
    });
    const studentRow = page.getByRole('row', {
      name: new RegExp(escapeRegExp(tenant.student.email)),
    });

    // Prerequisite: the caller is the only admin; the other two rows are not admins.
    await expect(page.locator('table tbody tr')).toHaveCount(3);
    await expect(ownRow.getByTestId('member-role')).toHaveText('Admin');
    await expect(teacherRow.getByTestId('member-role')).toHaveText('Teacher');
    await expect(studentRow.getByTestId('member-role')).toHaveText('Student');

    // Other members render the role select and the remove control, so their absence
    // on the own row below is specific to self — not a missing control set.
    await expect(teacherRow.getByRole('combobox')).toHaveCount(1);
    await expect(teacherRow.getByRole('button', { name: /Usuń członka/ })).toHaveCount(1);

    // 1 + 2 in the UI: the own row exposes no way to change the role and no way to
    // leave the organization; it carries the self marker instead.
    await expect(ownRow).toContainText('(ty)');
    await expect(ownRow.getByRole('combobox')).toHaveCount(0);
    await expect(ownRow.getByRole('button', { name: /Usuń członka/ })).toHaveCount(0);
    await expect(ownRow.getByRole('button', { name: /Zarządzaj grupami/ })).toHaveCount(0);

    // 1. The request behind a self-demotion is rejected, not silently applied.
    const demote = await page.request.put('/api/v1/organization/members', {
      data: { targetUserId: tenant.manager.id, newOrgRoleId: tenant.roles.member },
    });
    expect(demote.status(), 'PUT /api/v1/organization/members (self → member)').toBe(403);
    expect(await demote.json()).toMatchObject({ success: false, error: 'FORBIDDEN' });

    // 2. Same for removing oneself from the organization.
    const removeSelf = await page.request.delete('/api/v1/organization/members', {
      params: { userId: tenant.manager.id },
    });
    expect(removeSelf.status(), 'DELETE /api/v1/organization/members?userId=<self>').toBe(403);
    expect(await removeSelf.json()).toMatchObject({ success: false, error: 'FORBIDDEN' });

    // 3. The organization still has its admin and all of its members.
    const afterAttempts = await page.request.get('/api/v1/organization/members');
    expect(afterAttempts.status(), 'GET /api/v1/organization/members').toBe(200);
    const afterBody = (await afterAttempts.json()) as {
      success: boolean;
      data: Array<{ id: string; email: string; orgRoleId: string; orgRoleName: string }>;
    };
    expect(afterBody.success).toBe(true);
    expect(afterBody.data).toHaveLength(3);
    const selfAfter = afterBody.data.find((member) => member.id === tenant.manager.id);
    expect(selfAfter, 'the caller is still an organization member').toBeDefined();
    expect(selfAfter?.orgRoleName).toBe('admin');
    expect(selfAfter?.orgRoleId).toBe(tenant.roles.admin);
    expect(
      afterBody.data.filter((member) => member.orgRoleName === 'admin').length,
      'the organization still has exactly one admin',
    ).toBe(1);

    // The page reflects the unchanged state after a reload (nothing was applied
    // optimistically and then reverted).
    await page.reload();
    const ownRowAfterReload = page.getByRole('row', {
      name: new RegExp(escapeRegExp(tenant.manager.email)),
    });
    await expect(ownRowAfterReload.getByTestId('member-role')).toHaveText('Admin');
    await expect(ownRowAfterReload).toContainText('(ty)');

    // 4. Adjacent regression: the self-guard does not block managing others.
    const changeOther = await page.request.put('/api/v1/organization/members', {
      data: { targetUserId: tenant.teacher.id, newOrgRoleId: tenant.roles.member },
    });
    expect(changeOther.status(), 'PUT /api/v1/organization/members (other → member)').toBe(200);
    expect(await changeOther.json()).toMatchObject({ success: true });

    const removeOther = await page.request.delete('/api/v1/organization/members', {
      params: { userId: tenant.student.id },
    });
    expect(removeOther.status(), 'DELETE /api/v1/organization/members?userId=<other>').toBe(200);
    expect(await removeOther.json()).toMatchObject({ success: true });

    const finalList = await page.request.get('/api/v1/organization/members');
    expect(finalList.status()).toBe(200);
    const finalBody = (await finalList.json()) as {
      success: boolean;
      data: Array<{ id: string; orgRoleName: string }>;
    };
    expect(finalBody.success).toBe(true);
    expect(finalBody.data.map((member) => member.id).sort()).toEqual(
      [tenant.manager.id, tenant.teacher.id].sort(),
    );
    expect(finalBody.data.find((member) => member.id === tenant.teacher.id)?.orgRoleName).toBe(
      'member',
    );
    expect(finalBody.data.find((member) => member.id === tenant.manager.id)?.orgRoleName).toBe(
      'admin',
    );

    expect(pageErrors, 'uncaught page errors on the members page').toEqual([]);
  });
});
