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
} from '#test/helpers/tenant-seed';
import { loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-ROL-01 — creating a custom role on an organization plan that lacks
 * `role.builder` (Launch).
 *
 * Prerequisite (reconciled with the tenant seeder): the case's own organization
 * on the **Launch** plan — an organization is created on `launch` by the org
 * trigger, so no global plan row is touched — with a manager who is its `admin`.
 * The legacy manual seed (`manager@dev.local`, password `pass`) is never used.
 *
 * Tenant: `tenantKey('qa/cases/MGR-ROL-01.md', 'MGR-ROL-01 role builder gate',
 * 'qa-shared')::<run suffix>`. Every org/user/group id is `tenantId(key, entity)`,
 * so a run is reproducible by pinning `QA_RUN_SUFFIX`; by default the suffix is
 * fresh, which gives each independent run its own organization and users.
 * Nothing global is written (no settings, flags, plans or platform rows).
 *
 * Walk observation (shared app, pl): the manual case was written against a build
 * where `/manage/roles` offered „Nowa rola” on Launch and the attempt failed at
 * save time with „Nie udało się utworzyć roli”, and it asked to note whether the
 * page warns about the plan upfront. Fix #259 added that upfront warning
 * (`RoleBuilderLockedCard`, write affordances withheld) while keeping the API
 * gate (`requireFeature(ctx, 'role.builder')` → 403) as defence in depth. The
 * intended behaviour — and what this spec asserts — is therefore:
 *
 * 1. „Nowa rola” is not offered at all on Launch; the locked card names the
 *    missing plan feature and links to the organization plans.
 * 2. The roles list stays readable (the lock only withholds writes).
 * 3. A direct write still fails with 403/FORBIDDEN and creates nothing.
 *
 * The „Nie udało się utworzyć roli” toast is no longer reachable through the UI
 * (there is no form to submit); the API rejection is what keeps the guarantee
 * the case asked to confirm.
 */

const CASE_FILE = 'qa/cases/MGR-ROL-01.md';
const TITLE = 'MGR-ROL-01 role builder gate';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

const ROLE_NAME = 'Asystent';
const ROLE_DESCRIPTION = 'Rola testowa MGR-ROL-01';

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface OrgRoleRow {
  id: string;
  name: string;
  isSystem: boolean;
}

interface FeatureSet {
  features: string[];
}

interface PlanInfo {
  key: string;
  name: string;
  features: string[];
}

/**
 * Resolve the shared Supabase the QA tenant lives in. `qa/env.json` wins over the
 * worker's `apps/web/.env`, which often points at that worker's own, idle stack.
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
      fromEnvJson ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

/**
 * Seed the case's tenant: one organization (Launch by the org trigger) with an
 * admin manager, a teacher and a student. The teacher/student exist so the
 * organization is a normal tenant graph; only the manager is used.
 */
async function seedCaseTenant(): Promise<QaTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-mgr-rol-01-${RUN_SUFFIX}` };
  const group = { id: tenantId(key, 'group:default'), name: 'G1', isDefault: true };
  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const teacher = buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });

  const seeded = await seedTenantGraph(createSeedDb(resolveSupabase()), {
    key,
    org,
    defaultGroup: group,
    extraGroups: [],
    owner: manager,
    members: [teacher, student],
    ownerOrgRole: 'admin',
  });

  const tenant: QaTenant = {
    case: 'MGR-ROL-01',
    key,
    profile: 'content',
    runSuffix: RUN_SUFFIX,
    org,
    group: { id: group.id, name: group.name },
    users: {
      manager: { id: seeded.owner.id, email: seeded.owner.email, password: seeded.owner.password },
      teacher: {
        id: seeded.members[0].id,
        email: seeded.members[0].email,
        password: seeded.members[0].password,
      },
      student: {
        id: seeded.members[1].id,
        email: seeded.members[1].email,
        password: seeded.members[1].password,
      },
    },
  };

  return tenant;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

function roleRow(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

test.describe('@case:MGR-ROL-01 @area:MGR @prio:P2 role builder plan gate', () => {
  let tenant: QaTenant;

  test.beforeAll(async () => {
    tenant = await seedCaseTenant();
    console.log(`MGR-ROL-01 tenant key: ${tenant.key} (run ${RUN_SUFFIX})`);
  });

  test('Launch plan withholds role writes and the API rejects a direct create', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // Manager of this org, Polish UI like the case.
    await loginAs(page, tenant, 'manager', { locale: 'pl' });
    await expect(page).toHaveURL(/\/manage$/);

    // The case's entry point: the „Role” section of the manager panel.
    await page.locator('a[href="/manage/roles"]').first().click();
    await expect(page).toHaveURL(/\/manage\/roles$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Role', exact: true })).toBeVisible();

    // 1. The plan lock the case asked to confirm is now shown upfront: the
    //    missing feature is named and the page points at the organization plans.
    await expect(
      page.getByText('Kreator ról nie jest dostępny w Twoim planie', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Twój obecny plan nie obejmuje kreatora ról. Ulepsz plan, aby tworzyć własne role i uprawnienia.',
        { exact: true },
      ),
    ).toBeVisible();

    // „Nowa rola” and the write column are not offered at all on Launch, so the
    // failing create dialog/toast of the case is unreachable by design.
    await expect(page.getByRole('button', { name: 'Nowa rola', exact: true })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Akcje', exact: true })).toHaveCount(0);

    // 2. The list itself stays readable for a plan-locked org: the case's page is
    //    not blocked, only its writes. The three system roles are rendered.
    for (const column of ['Nazwa', 'Typ', 'Członkowie', 'Uprawnienia']) {
      await expect(
        page.getByRole('columnheader', { name: column, exact: true }),
        `column ${column}`,
      ).toBeVisible();
    }
    const roles = await getData<OrgRoleRow[]>(page, '/api/v1/organization/roles');
    expect(roles.map((role) => role.name).sort(), 'system roles of this org').toEqual([
      'admin',
      'member',
      'teacher',
    ]);
    for (const role of roles) await expect(roleRow(page, role.name)).toBeVisible();

    // The gate is the `role.builder` feature, and this org's plan lacks it. Both
    // facts come from the same session, not from a pinned global plan row.
    const features = await getData<FeatureSet>(page, '/api/v1/features/me');
    expect(features.features, 'role.builder must be absent on Launch').not.toContain(
      'role.builder',
    );
    const plan = await getData<PlanInfo>(page, '/api/v1/me/plan');
    expect(plan.key, 'the seeded organization plan').toBe('launch');
    expect(plan.features, 'Launch does not include role.builder').not.toContain('role.builder');

    // 3. The operation the case performs is still rejected by the API: 403 and
    //    nothing is created. This is the guarantee the case asks to confirm.
    const create = await page.request.post('/api/v1/organization/roles', {
      data: { name: ROLE_NAME, description: ROLE_DESCRIPTION },
    });
    expect(create.status(), 'POST /api/v1/organization/roles on Launch').toBe(403);
    expect(await create.json()).toEqual({ success: false, error: 'FORBIDDEN' });

    const afterCreate = await getData<OrgRoleRow[]>(page, '/api/v1/organization/roles');
    expect(
      afterCreate.some((role) => role.name === ROLE_NAME),
      'the rejected role must not exist',
    ).toBe(false);
    expect(afterCreate).toHaveLength(roles.length);

    // Adjacent write path of the same locked surface: renaming a role is gated by
    // the same feature check, before any role-specific rule runs.
    const adminRole = roles.find((role) => role.name === 'admin');
    if (!adminRole) throw new Error('seeded org has no admin role');
    const update = await page.request.put(`/api/v1/organization/roles/${adminRole.id}`, {
      data: { name: 'Asystent' },
    });
    expect(update.status(), 'PUT /api/v1/organization/roles/:id on Launch').toBe(403);
    expect(await update.json()).toEqual({ success: false, error: 'FORBIDDEN' });

    const afterUpdate = await getData<OrgRoleRow[]>(page, '/api/v1/organization/roles');
    expect(
      afterUpdate.find((role) => role.id === adminRole.id)?.name,
      'the admin role keeps its name',
    ).toBe('admin');

    // 4. „Zobacz plany” answers the case's „czy UI informuje o konieczności zmiany
    //    planu”: it opens the organization plan catalogue, where this org's
    //    current plan is marked and the plans that include „Kreator Ról” are listed.
    await page.getByRole('button', { name: 'Zobacz plany', exact: true }).click();
    await expect(page).toHaveURL(/\/pricing\/org$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Wybierz Swój Plan', exact: true }),
    ).toBeVisible();

    const currentPlanCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText('Obecny Plan', { exact: true }) });
    await expect(currentPlanCard).toHaveCount(1);
    await expect(currentPlanCard.locator('[data-slot="card-title"]')).toHaveText(plan.name);

    const upgradePlans = await getData<PlanInfo[]>(page, '/api/v1/subscription-plans?for=manager');
    const entitled = upgradePlans.filter((candidate) =>
      candidate.features.includes('role.builder'),
    );
    expect(
      entitled.length,
      'the catalogue offers at least one plan with role.builder',
    ).toBeGreaterThan(0);
    for (const candidate of entitled) {
      await expect(
        page.locator('[data-slot="card-title"]', { hasText: candidate.name }),
        `plan card ${candidate.name}`,
      ).toHaveCount(1);
    }
    // The feature the locked card promises is listed on those plan cards.
    await expect(page.getByText('Kreator Ról', { exact: true }).first()).toBeVisible();

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
