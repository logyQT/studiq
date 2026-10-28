import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
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
 * MGR-MEM-05 — managing a member's group membership from the members table.
 *
 * Prerequisite (reconciled with the tenant seeder): a manager whose organization
 * has two groups, `O1G1` and `O1G2`, plus a student who starts in `O1G1`. Each
 * group owns one group-visible deck, so the student's membership has an
 * observable effect on what content they see. The legacy manual seed
 * (`manager@dev.local`, `pass`) is never used.
 *
 * Tenant: `tenantKey('qa/cases/MGR-MEM-05.md', 'MGR-MEM-05 group membership', 'qa-shared')`
 * plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/group/
 * deck id is `tenantId(key, entity)`, so an independent run gets a brand-new
 * organization and nothing leaks between runs.
 *
 * The case's acceptance points, confirmed on the shared app during the walk:
 * 1. „Zarządzaj grupami” opens the dialog „Zarządzaj grupami: <member>” with one
 *    checkbox per organization group; checking a group reveals its role select
 *    („Nauczyciel” / „Członek”).
 * 2. Saving the move (`O1G1` unchecked, `O1G2` checked as „Nauczyciel”) shows the
 *    toast „Przynależność do grup zaktualizowana” and the row's „Grupy” column
 *    lists only the new group.
 * 3. The change is real and scoped: the API reports the student as a `teacher` of
 *    `O1G2` and no longer in `O1G1`, the group counters move accordingly, other
 *    members keep their groups, and the student's deck list switches from the
 *    `O1G1` deck to the `O1G2` deck.
 *
 * Nothing global is written: no admin setting, feature flag, plan, platform stat
 * or singleton row. The two group decks and the manager's teacher membership in
 * `O1G2` (needed to create group-visible content there) are seeded into this
 * case's own tenant only.
 */

const CASE_FILE = 'qa/cases/MGR-MEM-05.md';
const TITLE = 'MGR-MEM-05 group membership';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;

const GROUP1 = 'O1G1';
const GROUP2 = 'O1G2';
const DECK1_NAME = 'O1G1 deck';
const DECK2_NAME = 'O1G2 deck';

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface MemberGroup {
  id: string;
  name: string;
  role: 'teacher' | 'member';
}

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  groups: MemberGroup[];
}

interface OrgGroup {
  id: string;
  name: string;
  memberCount: number;
  teacherCount: number;
}

interface CaseTenant {
  key: string;
  org: { id: string; name: string };
  manager: SeedAccount;
  teacher: SeedAccount;
  student: SeedAccount;
  group1: { id: string; name: string };
  group2: { id: string; name: string };
  deck1: { id: string; name: string };
  deck2: { id: string; name: string };
}

function parseDotEnv(path: string): Record<string, string> {
  try {
    const values: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
    return values;
  } catch {
    return {};
  }
}

/**
 * Resolve the shared Supabase admin credentials. `QA_SUPABASE_*` wins; otherwise
 * the routine `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, then the
 * worker's `qa/env.json` (the shared stack this tile talks to), then the app's
 * own `apps/web/.env` — which is the only source in CI, where the app and the
 * database are on the default local ports — and finally the shared local defaults.
 */
function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }
  const fromAppEnv = parseDotEnv(join(process.cwd(), 'apps', 'web', '.env'));

  return {
    url:
      process.env.QA_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      fromEnvJson ??
      fromAppEnv.NEXT_PUBLIC_SUPABASE_URL ??
      LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      fromAppEnv.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

/**
 * Seed the case's organization: admin manager + teacher + student, the case's two
 * groups, and one group-visible deck per group. The student starts in `O1G1` (the
 * seeder enrolls every member there); the manager additionally teaches `O1G2` so
 * that group-visible content can be created for it through the product API rules.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const key = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;
  const org = { id: tenantId(key, 'org'), name: `qa-mgr-mem05-${RUN_SUFFIX}` };
  const manager = buildAccount(key, 'manager', 'manager', { name: 'QA manager' });
  const teacher = buildAccount(key, 'teacher', 'educator', { name: 'QA teacher' });
  const student = buildAccount(key, 'student', 'student', { name: 'QA student' });
  const group1 = { id: tenantId(key, 'group:o1g1'), name: GROUP1, isDefault: true };
  const group2 = { id: tenantId(key, 'group:o1g2'), name: GROUP2, isDefault: false };
  const deck1 = { id: tenantId(key, 'deck:o1g1'), name: DECK1_NAME };
  const deck2 = { id: tenantId(key, 'deck:o1g2'), name: DECK2_NAME };

  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key,
    org,
    defaultGroup: group1,
    extraGroups: [group2],
    owner: manager,
    members: [teacher, student],
    ownerOrgRole: 'admin',
  });

  // The manager teaches both groups, mirroring a manager who owns the content of
  // each group; the seeder only enrolls the owner in the default group.
  const { error: managerGroupError } = await db.from('group_members').upsert(
    {
      id: tenantId(key, 'gm:manager:o1g2'),
      group_id: group2.id,
      user_id: seeded.owner.id,
      role: 'teacher',
    },
    { onConflict: 'id' },
  );
  if (managerGroupError) {
    throw new Error(`seed ${key}: manager in ${GROUP2} ${managerGroupError.message}`);
  }

  const { error: deckError } = await db.from('flashcard_decks').upsert(
    [
      {
        id: deck1.id,
        organization_id: org.id,
        created_by: seeded.owner.id,
        name: deck1.name,
        visibility: 'group' as const,
      },
      {
        id: deck2.id,
        organization_id: org.id,
        created_by: seeded.owner.id,
        name: deck2.name,
        visibility: 'group' as const,
      },
    ],
    { onConflict: 'id' },
  );
  if (deckError) throw new Error(`seed ${key}: decks ${deckError.message}`);

  const { error: deckGroupsError } = await db.from('deck_groups').upsert(
    [
      { deck_id: deck1.id, group_id: group1.id },
      { deck_id: deck2.id, group_id: group2.id },
    ],
    { onConflict: 'deck_id,group_id' },
  );
  if (deckGroupsError) throw new Error(`seed ${key}: deck_groups ${deckGroupsError.message}`);

  return {
    key,
    org,
    manager: seeded.owner,
    teacher: seeded.members[0],
    student: seeded.members[1],
    group1: { id: group1.id, name: group1.name },
    group2: { id: group2.id, name: group2.name },
    deck1,
    deck2,
  };
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

/** The active-org cookie the org-scoped endpoints resolve the organization from. */
async function pinActiveOrg(page: Page, baseURL: string, orgId: string): Promise<void> {
  const { hostname } = new URL(baseURL);
  await page
    .context()
    .addCookies([
      { name: 'active_org_id', value: orgId, domain: hostname, path: '/', httpOnly: true },
    ]);
}

/** Real login through the API, so the session cookie lives in the page context. */
async function loginAsManager(page: Page, tenant: CaseTenant, baseURL: string): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: tenant.manager.email, password: tenant.manager.password },
  });
  expect(response.status(), `login ${tenant.manager.email}`).toBe(200);
  await pinPolish(page, baseURL);
  await pinActiveOrg(page, baseURL, tenant.org.id);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/manage$/);
}

/** A separate student session, so the manager's cookies are never replaced. */
async function loginAsStudent(
  browser: Browser,
  tenant: CaseTenant,
  baseURL: string,
): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: tenant.student.email, password: tenant.student.password },
  });
  expect(response.status(), `login ${tenant.student.email}`).toBe(200);
  await pinPolish(page, baseURL);
  await pinActiveOrg(page, baseURL, tenant.org.id);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/app$/);
  return page;
}

async function apiData<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as { success: boolean; data: T };
  expect(body.success, `GET ${path} success`).toBe(true);
  return body.data;
}

function listMembers(page: Page): Promise<OrgMember[]> {
  return apiData<OrgMember[]>(page, '/api/v1/organization/members');
}

function listGroups(page: Page): Promise<OrgGroup[]> {
  return apiData<OrgGroup[]>(page, '/api/v1/organization/groups');
}

async function groupMemberRoles(
  page: Page,
  groupId: string,
): Promise<Array<{ userId: string; role: string }>> {
  return apiData<Array<{ userId: string; role: string }>>(
    page,
    `/api/v1/organization/groups/${groupId}/members`,
  );
}

async function deckNames(page: Page): Promise<string[]> {
  const body = await apiData<{ items: Array<{ name: string }> }>(
    page,
    '/api/v1/flashcards/decks?limit=100',
  );
  return body.items.map((deck) => deck.name).sort();
}

/** The table row for one member, anchored on the unique seeded e-mail. */
function memberRow(page: Page, email: string) {
  return page.getByRole('row').filter({ has: page.getByText(email, { exact: true }) });
}

/** One group line inside the „Zarządzaj grupami” dialog: checkbox + label + role select. */
function dialogGroup(dialog: ReturnType<Page['getByRole']>, name: string) {
  return dialog.getByText(name, { exact: true }).locator('xpath=..');
}

/** A deck card heading; the card renders once per breakpoint, so only visible ones count. */
function deckHeading(page: Page, name: string) {
  return page.getByRole('heading', { name, exact: true }).filter({ visible: true });
}

test.describe('@case:MGR-MEM-05 @area:MGR @prio:P2 member group membership management', () => {
  let tenant: CaseTenant;

  test.beforeAll(async () => {
    tenant = await seedCaseTenant();
    console.log(`MGR-MEM-05 tenant key: ${tenant.key} (org ${tenant.org.id})`);
  });

  test('moves a student between groups and the student sees the new group content', async ({
    page,
    browser,
    baseURL,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const origin = baseURL ?? 'http://localhost:3010';

    // --- Before: the student belongs to O1G1 and sees only its deck ---------
    const studentPage = await loginAsStudent(browser, tenant, origin);
    try {
      await studentPage.goto('/app/flashcards');
      await expect(deckHeading(studentPage, tenant.deck1.name)).toBeVisible();
      await expect(deckHeading(studentPage, tenant.deck2.name)).toHaveCount(0);
      expect(await deckNames(studentPage), 'student deck list before the move').toEqual([
        tenant.deck1.name,
      ]);

      // --- Step 1: open „Zarządzaj grupami” for the student -----------------
      await loginAsManager(page, tenant, origin);
      // Enter the page the way a user does (dashboard → sidebar), so the active
      // organization settles before the org-scoped list requests.
      await page.goto('/manage');
      await expect(page).toHaveURL(/\/manage$/);
      await page.locator('a[href="/manage/members"]').first().click();
      await expect(page).toHaveURL(/\/manage\/members$/);
      await expect(page.getByRole('heading', { name: 'Członkowie', exact: true })).toBeVisible();

      const row = memberRow(page, tenant.student.email);
      await expect(row).toBeVisible();
      await expect(row.getByRole('cell').nth(2), 'groups before the move').toContainText(GROUP1);
      await expect(row.getByRole('cell').nth(2), 'groups before the move').not.toContainText(
        GROUP2,
      );

      await row.getByRole('button', { name: 'Zarządzaj grupami' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText('Zarządzaj grupami: QA student', { exact: true }),
      ).toBeVisible();

      const group1 = dialogGroup(dialog, GROUP1);
      const group2 = dialogGroup(dialog, GROUP2);
      await expect(group1.getByRole('checkbox'), `${GROUP1} is checked`).toBeChecked();
      await expect(group2.getByRole('checkbox'), `${GROUP2} is unchecked`).not.toBeChecked();
      await expect(group1.getByRole('combobox'), `${GROUP1} role`).toHaveText('Członek');

      // --- Step 2: check O1G2, pick the teacher role, uncheck O1G1, save ---
      await group2.getByRole('checkbox').click();
      await expect(group2.getByRole('checkbox')).toBeChecked();
      await group2.getByRole('combobox').click();
      await expect(page.getByRole('option')).toHaveCount(2);
      await expect(page.getByRole('option', { name: 'Członek' })).toBeVisible();
      await page.getByRole('option', { name: 'Nauczyciel' }).click();
      await expect(group2.getByRole('combobox'), `${GROUP2} role`).toHaveText('Nauczyciel');

      await group1.getByRole('checkbox').click();
      await expect(group1.getByRole('checkbox')).not.toBeChecked();
      await expect(group1.getByRole('combobox'), `${GROUP1} role select is gone`).toHaveCount(0);

      await dialog.getByRole('button', { name: 'Zapisz' }).click();
      await expect(
        page.getByText('Przynależność do grup zaktualizowana', { exact: true }),
      ).toBeVisible();
      await expect(dialog).toBeHidden();

      // The row now lists only the new group.
      await expect(row.getByRole('cell').nth(2), 'groups after the move').toContainText(GROUP2);
      await expect(row.getByRole('cell').nth(2), 'groups after the move').not.toContainText(GROUP1);

      // Reopening proves the saved state: O1G2 checked as „Nauczyciel”, O1G1 off.
      await row.getByRole('button', { name: 'Zarządzaj grupami' }).click();
      const reopened = page.getByRole('dialog');
      await expect(reopened).toBeVisible();
      await expect(dialogGroup(reopened, GROUP2).getByRole('checkbox')).toBeChecked();
      await expect(dialogGroup(reopened, GROUP2).getByRole('combobox')).toHaveText('Nauczyciel');
      await expect(dialogGroup(reopened, GROUP1).getByRole('checkbox')).not.toBeChecked();
      await reopened.getByRole('button', { name: 'Anuluj' }).click();
      await expect(reopened).toBeHidden();

      // --- The server state matches, and only the student moved -------------
      const members = await listMembers(page);
      const student = members.find((member) => member.email === tenant.student.email);
      if (!student) throw new Error('the seeded student is missing from /organization/members');
      expect(student.groups, 'student groups after the move').toEqual([
        { id: tenant.group2.id, name: GROUP2, role: 'teacher' },
      ]);

      const group1Roles = await groupMemberRoles(page, tenant.group1.id);
      expect(
        group1Roles.some((member) => member.userId === tenant.student.id),
        'student is out of O1G1',
      ).toBe(false);
      expect(
        group1Roles.find((member) => member.userId === tenant.manager.id)?.role,
        'the manager still teaches O1G1',
      ).toBe('teacher');
      expect(
        group1Roles.find((member) => member.userId === tenant.teacher.id)?.role,
        'the other member keeps the O1G1 membership',
      ).toBe('member');

      const group2Roles = await groupMemberRoles(page, tenant.group2.id);
      expect(
        group2Roles.find((member) => member.userId === tenant.student.id)?.role,
        'student is a teacher in O1G2',
      ).toBe('teacher');

      const groups = await listGroups(page);
      const group1Counts = groups.find((group) => group.id === tenant.group1.id);
      const group2Counts = groups.find((group) => group.id === tenant.group2.id);
      expect(group1Counts, 'O1G1 counts after the move').toMatchObject({
        memberCount: 2,
        teacherCount: 1,
      });
      expect(group2Counts, 'O1G2 counts after the move').toMatchObject({
        memberCount: 2,
        teacherCount: 2,
      });

      // The other members' „Grupy” cells did not change as a side effect.
      const managerCell = memberRow(page, tenant.manager.email).getByRole('cell').nth(2);
      await expect(managerCell).toContainText(GROUP1);
      await expect(managerCell).toContainText(GROUP2);
      const teacherCell = memberRow(page, tenant.teacher.email).getByRole('cell').nth(2);
      await expect(teacherCell).toContainText(GROUP1);
      await expect(teacherCell).not.toContainText(GROUP2);

      // --- Step 3: the student now sees the O1G2 content, not O1G1 ---------
      expect(await deckNames(studentPage), 'student deck list after the move').toEqual([
        tenant.deck2.name,
      ]);
      await studentPage.goto('/app/flashcards');
      await expect(deckHeading(studentPage, tenant.deck2.name)).toBeVisible();
      await expect(deckHeading(studentPage, tenant.deck1.name)).toHaveCount(0);
    } finally {
      await studentPage.context().close();
    }

    expect(pageErrors, 'uncaught page errors during the membership change').toEqual([]);
  });
});
