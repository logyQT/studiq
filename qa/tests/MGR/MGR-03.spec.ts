import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
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
 * MGR-03 — organization data must not mix when the manager switches the active
 * organization from the sidebar switcher.
 *
 * Prerequisite (reconciled with the tenant seeder): a manager who administers **two**
 * organizations. The legacy manual seed (`manager@dev.local`, password `pass`,
 * WSB Merito / UE Wrocław) is never used. The case's own tenant provides, per org, a
 * distinct student, two groups and one pending invitation:
 *
 * - org A — S1 + teacher T1, groups `O1G1` / `O1G2`, pending invite for
 *   `mgr03-invite-a-<run>`
 * - org B — S2 only, groups `O2G1` / `O2G2`, pending invite for `mgr03-invite-b-<run>`
 *
 * The two orgs deliberately have different member counts (3 vs 2, teachers 1 vs 0), so
 * a counter that leaked from the other organization cannot coincide with the expected
 * one.
 *
 * Tenant: `tenantKey('qa/cases/MGR-03.md', <title>, 'qa-shared')::<run>` with one
 * `::org-a` / `::org-b` suffix per organization so the two graphs cannot collide on
 * `org_members.id`. Every account/org/group/invitation id is `tenantId(key, entity)`,
 * so a run is reproducible by pinning `QA_RUN_SUFFIX`; by default the suffix is
 * fresh, which gives each independent run its own pair of organizations.
 *
 * Acceptance points:
 * 1. Switching at the top of the sidebar lands back on `/manage` and the overview
 *    (member counts + „Ostatni członkowie”) describes the newly active org.
 * 2. `/manage/members`, `/manage/groups` and `/manage/invites` show only the active
 *    org's rows — the other org's student, groups and invitation never appear.
 * 3. The switch persists across a reload, and switching back restores the first org's
 *    data on the same three pages.
 */

const CASE_FILE = 'qa/cases/MGR-03.md';
const TITLE = 'MGR-03 organization data isolation';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface QaOrg {
  id: string;
  name: string;
  /** Two groups each, matching the case's `O1G*` / `O2G*` plural. */
  groups: [string, string];
  student: SeedAccount;
  inviteEmail: string;
  /** Dashboard counters this org must show — different per org on purpose. */
  counts: { total: number; teachers: number; students: number };
}

interface TwoOrgTenant {
  key: string;
  manager: SeedAccount;
  orgA: QaOrg;
  orgB: QaOrg;
}

/**
 * Resolve the shared Supabase admin credentials. The worker's `qa/env.json` wins over
 * `process.env`: the repository `.env` names the per-slot stack, which is not running
 * in the shared QA setup, and `bun` auto-loads it.
 */
function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: { supabaseUrl?: string } | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = JSON.parse(raw) as { supabaseUrl?: string };
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url: process.env.QA_SUPABASE_URL ?? fromEnvJson?.supabaseUrl ?? LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

async function seedOrg(params: {
  db: ReturnType<typeof createSeedDb>;
  key: string;
  name: string;
  groups: [string, string];
  owner: SeedAccount;
  student: SeedAccount;
  /** Enrolled with the org's `teacher` role (org A only), so the counters differ. */
  teacher?: SeedAccount;
  invite: { id: string; email: string };
}): Promise<QaOrg> {
  const { db, key, name, groups, owner, student, teacher, invite } = params;
  const members = teacher ? [student, teacher] : [student];

  const seeded = await seedTenantGraph(db, {
    key,
    org: { id: tenantId(key, 'org'), name },
    defaultGroup: { id: tenantId(key, 'group:default'), name: groups[0], isDefault: true },
    extraGroups: [{ id: tenantId(key, 'group:second'), name: groups[1], isDefault: false }],
    owner,
    members,
    ownerOrgRole: 'admin',
  });

  // `seedTenantGraph` enrols every `members` entry with the org's `member` role; the
  // case needs one org with a teacher, so promote that tenant-local membership.
  if (teacher) {
    const promoted = await db
      .from('org_members')
      .update({ org_role_id: seeded.roleIds.teacher! })
      .eq('organization_id', seeded.orgId!)
      .eq('user_id', teacher.id);
    if (promoted.error) {
      throw new Error(`seed ${key}: org_members(teacher) ${promoted.error.message}`);
    }
    const groupRole = await db
      .from('group_members')
      .update({ role: 'teacher' })
      .eq('group_id', tenantId(key, 'group:default'))
      .eq('user_id', teacher.id);
    if (groupRole.error) {
      throw new Error(`seed ${key}: group_members(teacher) ${groupRole.error.message}`);
    }
  }

  // `/api/v1/organization/groups` lists a group only when it has a teacher member, so
  // the second group needs the manager enrolled as its teacher.
  const secondGroupTeacher = await db.from('group_members').upsert(
    {
      id: tenantId(key, 'gm:second:owner'),
      group_id: tenantId(key, 'group:second'),
      user_id: owner.id,
      role: 'teacher',
    },
    { onConflict: 'id' },
  );
  if (secondGroupTeacher.error) {
    throw new Error(`seed ${key}: group_members(second group) ${secondGroupTeacher.error.message}`);
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invitation = await db.from('invitations').upsert(
    {
      id: invite.id,
      email: invite.email,
      token: `qa-mgr03-${invite.id.replace(/-/g, '').slice(0, 24)}`,
      organization_id: seeded.orgId!,
      target_org_role_id: seeded.roleIds.member!,
      inviter_id: owner.id,
      expires_at: expiresAt,
      is_accepted: false,
    },
    { onConflict: 'id' },
  );
  if (invitation.error) {
    throw new Error(`seed ${key}: invitations ${invitation.error.message}`);
  }

  return {
    id: seeded.orgId!,
    name,
    groups,
    student: seeded.members[0],
    inviteEmail: invite.email,
    counts: { total: 1 + members.length, teachers: teacher ? 1 : 0, students: 1 },
  };
}

/** Both organizations of the case, with one manager who is admin in each. Idempotent. */
async function seedCaseTenant(): Promise<TwoOrgTenant> {
  const base = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const keyA = `${base}::org-a`;
  const keyB = `${base}::org-b`;

  // One account, two memberships: the manager is built from org A's key and passed to
  // both graphs, so both organizations resolve to the same user.
  const manager = buildAccount(keyA, 'manager', 'manager', { name: 'QA MGR-03 manager' });
  const studentA = buildAccount(keyA, 'student-a', 'student', {
    name: `QA MGR-03 S1 ${RUN_SUFFIX}`,
  });
  const teacherA = buildAccount(keyA, 'teacher-a', 'educator', {
    name: `QA MGR-03 T1 ${RUN_SUFFIX}`,
  });
  const studentB = buildAccount(keyB, 'student-b', 'student', {
    name: `QA MGR-03 S2 ${RUN_SUFFIX}`,
  });

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const orgA = await seedOrg({
    db,
    key: keyA,
    name: `QA MGR-03 A ${RUN_SUFFIX}`,
    groups: [`O1G1-${RUN_SUFFIX}`, `O1G2-${RUN_SUFFIX}`],
    owner: manager,
    student: studentA,
    teacher: teacherA,
    invite: {
      id: tenantId(keyA, 'invite:a'),
      email: `mgr03-invite-a-${RUN_SUFFIX}@test.local`,
    },
  });

  const orgB = await seedOrg({
    db,
    key: keyB,
    name: `QA MGR-03 B ${RUN_SUFFIX}`,
    groups: [`O2G1-${RUN_SUFFIX}`, `O2G2-${RUN_SUFFIX}`],
    owner: manager,
    student: studentB,
    invite: {
      id: tenantId(keyB, 'invite:b'),
      email: `mgr03-invite-b-${RUN_SUFFIX}@test.local`,
    },
  });

  return { key: base, manager, orgA, orgB };
}

/**
 * Real login through the API, then boot the app with the locale the case's copy is
 * written in and the case's first organization active. Logs any previous user out
 * first, so the run never inherits a session from another worker.
 */
async function signInAs(
  page: Page,
  baseURL: string,
  account: SeedAccount,
  orgId: string,
): Promise<void> {
  await page.request.post('/api/v1/auth/logout');

  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: orgId, domain: hostname, path: '/', httpOnly: true },
  ]);

  await page.goto('/manage');
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
}

/** The sidebar's organization switcher, addressed by the organization it shows. */
function orgSwitcher(page: Page, orgName: string): Locator {
  return page.getByRole('button', { name: orgName });
}

/** Step 1 of the case: pick the other organization from the switcher at the top. */
async function switchToOrg(page: Page, fromOrgName: string, toOrgName: string): Promise<void> {
  await orgSwitcher(page, fromOrgName).click();
  await page.getByRole('menuitem', { name: toOrgName }).click();
  await expect(orgSwitcher(page, toOrgName)).toBeVisible();
}

/** Value rendered by a dashboard `StatCard` (title paragraph → value paragraph). */
function statValue(page: Page, title: string): Locator {
  return page.getByText(title, { exact: true }).locator('..').locator('p').nth(1);
}

/** The active org's overview: totals and „Ostatni członkowie”. */
async function expectOverviewShows(page: Page, org: QaOrg, other: QaOrg): Promise<void> {
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
  await expect(orgSwitcher(page, org.name)).toBeVisible();

  // Counters describe this org only; the two orgs have different counts, so a leaked
  // figure from the other organization cannot match by coincidence.
  await expect(statValue(page, 'Łączna liczba członków')).toHaveText(String(org.counts.total));
  await expect(statValue(page, 'Wykładowcy')).toHaveText(String(org.counts.teachers));
  await expect(statValue(page, 'Studenci')).toHaveText(String(org.counts.students));

  await expect(page.getByText('Ostatni członkowie')).toBeVisible();
  await expect(page.getByText(org.student.name!, { exact: true })).toBeVisible();
  await expect(page.getByText(other.student.name!, { exact: true })).toHaveCount(0);
}

/** Step 2 of the case: the three admin lists only carry the active org's rows. */
async function expectOrgListsShow(page: Page, org: QaOrg, other: QaOrg): Promise<void> {
  // Members: the count, the student of this org and their group badges.
  await page.goto('/manage/members');
  await expect(page.getByRole('heading', { name: 'Członkowie' })).toBeVisible();
  await expect(page.getByText(`${org.counts.total} łącznie`)).toBeVisible();

  const membersTable = page.getByRole('table');
  await expect(membersTable.getByText(org.student.email)).toBeVisible();
  await expect(membersTable.getByText(org.student.name!, { exact: true })).toBeVisible();
  for (const group of org.groups) {
    await expect(
      membersTable.getByText(group, { exact: true }).first(),
      `member list group ${group}`,
    ).toBeVisible();
  }
  await expect(page.getByText(other.student.email)).toHaveCount(0);
  await expect(page.getByText(other.student.name!, { exact: true })).toHaveCount(0);

  // Groups: exactly this org's two groups, none of the other org's.
  await page.goto('/manage/groups');
  await expect(page.getByRole('heading', { name: 'Grupy' })).toBeVisible();

  const groupsTable = page.getByRole('table');
  for (const group of org.groups) {
    await expect(groupsTable.getByText(group, { exact: true }), `group row ${group}`).toHaveCount(
      1,
    );
  }
  for (const group of other.groups) {
    await expect(
      page.getByText(group, { exact: true }),
      `foreign group ${group} must not be listed`,
    ).toHaveCount(0);
  }

  // Invitations: only this org's pending invite.
  await page.goto('/manage/invites');
  await expect(page.getByRole('heading', { name: 'Zaproszenia' })).toBeVisible();

  const invitesTable = page.getByRole('table');
  await expect(invitesTable.getByText(org.inviteEmail)).toBeVisible();
  await expect(invitesTable.getByText('Oczekujące')).toBeVisible();
  await expect(page.getByText(other.inviteEmail)).toHaveCount(0);
}

test.describe('@case:MGR-03 @area:MGR @prio:P2 organization data isolation', () => {
  test.setTimeout(180_000);

  let tenant: TwoOrgTenant;

  test.beforeAll(async () => {
    tenant = await seedCaseTenant();
    console.log(
      `MGR-03 tenant key: ${tenant.key} (manager ${tenant.manager.email}, ` +
        `org A ${tenant.orgA.id} / ${tenant.orgA.name}, org B ${tenant.orgB.id} / ` +
        `${tenant.orgB.name})`,
    );
  });

  test('switching the active organization swaps members, groups and invitations', async ({
    page,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';
    const { orgA, orgB } = tenant;

    // Start as the two-org manager with org A active.
    await signInAs(page, origin, tenant.manager, orgA.id);
    await expectOverviewShows(page, orgA, orgB);
    await expectOrgListsShow(page, orgA, orgB);

    // Step 1: switch from the top of the sidebar while on the overview. The route does
    // not change, so the data has to follow the active org instead of the mount.
    await page.goto('/manage');
    await expect(page).toHaveURL(/\/manage$/);
    await switchToOrg(page, orgA.name, orgB.name);

    // Step 2 (after the switch): still on /manage, and the overview describes org B.
    expect(new URL(page.url()).pathname).toBe('/manage');
    await expectOverviewShows(page, orgB, orgA);
    await expectOrgListsShow(page, orgB, orgA);

    // The switch is server state (the `active_org_id` cookie), so a reload keeps it.
    await page.goto('/manage/members');
    await expect(page.getByText(orgB.student.email)).toBeVisible();
    await page.reload();
    await expect(page.getByText(orgB.student.email)).toBeVisible();
    await expect(page.getByText(orgA.student.email)).toHaveCount(0);

    // Switching back from a subpage returns to /manage and restores org A's data.
    await switchToOrg(page, orgB.name, orgA.name);
    await expectOverviewShows(page, orgA, orgB);
    await expectOrgListsShow(page, orgA, orgB);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
