import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { shortHash, tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
} from '#test/helpers/tenant-seed';

/**
 * MGR-SEAT-02 — assigning a seat to a member.
 *
 * Prerequisite (reconciled with the tenant seeder): the seat pools from MGR-SEAT-01
 * („pula z MGR-SEAT-01”) — purchased seats that nobody holds yet. The legacy manual
 * seed (`manager@dev.local`, password `pass`) is never used.
 *
 * Tenant: `tenantKey('qa/cases/MGR-SEAT-02.md', <title>, 'qa-shared')::<run suffix>`.
 * Every org/user/role id is `tenantId(key, entity)`, so a run is reproducible by
 * pinning `QA_RUN_SUFFIX`; by default the suffix is fresh, which gives each
 * independent run its own organization, users and seat pools.
 *
 * The spec seeds its own graph through the shared helpers
 * (`__tests__/helpers/tenant-seed.ts`): one organization whose `admin` is the
 * manager, one `teacher` and one `member`. The pools are then bought through the
 * product's own API (`POST /api/v1/organization/seats/pools`) — the MGR-SEAT-01
 * precondition — one per tier so the role/tier filtering is observable:
 * Ace (student tier, 3), Creator (educator tier, 3), Campus (manager tier, 1).
 * Nothing global is written — no settings, feature flags, plans or platform rows —
 * and no other case's tenant is touched.
 *
 * Acceptance points:
 * 1. „Przydziel miejsce” opens a dialog whose seat-plan picker stays disabled until
 *    a member is chosen. After a member is picked it offers **exactly** the pools
 *    of that member's tier (student → Ace, teacher → Creator, admin → Campus), so
 *    an incompatible pool cannot be selected.
 * 2. „Przydziel” shows the toast „Miejsce przydzielone pomyślnie”, a new row in
 *    „Przydziały” for that member with the seat plan, and the pool moves from
 *    3/0/3 to 3/1/2 (assigned +1, available −1); the other pools are untouched.
 * 3. The member receives the seat plan's features and limits on their next login:
 *    the sidebar exposes the „Asystent Q” entry (`ai.chat`), `/app/ai` renders the
 *    composer instead of the plan gate, `/api/v1/me/plan` resolves the seat plan,
 *    and the AI-token limit becomes the seat plan's own limit. Admin-only features
 *    (`org.manage`/`member.manage`/`role.builder`) are never granted through the
 *    seat.
 * 4. Adjacent regression: the guards behind the pickers hold server-side — a
 *    second seat for the same member is rejected (`USAGE_LIMIT_EXCEEDED`) and a
 *    tier-mismatched pool is rejected (`BAD_REQUEST`), with the pool counters left
 *    unchanged. The member drops out of the picker once seated.
 *
 * Not asserted (out of scope, see the case's walk observations): a **teacher**
 * seated on an educator plan (Creator) keeps `member.manage`, because the resolver
 * treats any role already carrying `org.manage` as an admin. The case assigns a
 * seat to a member; the escalation path is noted in the case file rather than
 * encoded as a test.
 */

declare global {
  interface Window {
    __qaToasts?: string[];
  }
}

const CASE_FILE = 'qa/cases/MGR-SEAT-02.md';
const TITLE = 'MGR-SEAT-02 assigning a seat to a member';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}${randomTag(4)}`;
const KEY = `${tenantKey(CASE_FILE, TITLE, PROJECT)}::${RUN_SUFFIX}`;

const ORG_ID = tenantId(KEY, 'org');
const ORG_NAME = `qa-mgr-seat02-${RUN_SUFFIX}`;
const GROUP_ID = tenantId(KEY, 'group:default');
const GROUP_NAME = 'SEAT-02 G1';

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/**
 * One pool per tier, so the picker's filter is provable rather than a sample of
 * one: the `member` role is student tier, `teacher` is educator, `admin` is
 * manager (`ROLE_TIER_MAP` / `PLAN_TIER_MAP` in `seat.service.ts`).
 */
const POOLS = [
  { planKey: 'ace', quantity: 3 },
  { planKey: 'creator', quantity: 3 },
  { planKey: 'campus', quantity: 1 },
] as const;

/** Features a seat must never hand to a non-admin role (`ADMIN_ONLY_FEATURES`). */
const ADMIN_ONLY_FEATURES = ['org.manage', 'member.manage', 'role.builder'] as const;

/** Polish copy the case quotes; the fixture pins `NEXT_LOCALE=pl`. */
const COPY = {
  seatsTitle: 'Licencje miejsc',
  poolsTitle: 'Pule miejsc',
  assignmentsTitle: 'Przydziały',
  assignSeat: 'Przydziel miejsce',
  assign: 'Przydziel',
  assignSuccess: 'Miejsce przydzielone pomyślnie',
  selectMemberFirst: 'Najpierw wybierz członka',
  cancel: 'Anuluj',
  aiNav: 'Asystent Q',
  aiPlaceholder: 'Zapytaj Q',
  aiLocked: 'Asystent Q nie jest dostępny w Twoim planie',
} as const;

interface Pool {
  id: string;
  planKey: string;
  total: number;
  assigned: number;
}

interface Assignment {
  id: string;
  userId: string;
  poolId: string;
  planKey: string;
  userEmail: string;
  userFullName: string | null;
  assignedAt: string;
}

interface PlanInfo {
  key: string;
  name: string;
  features: string[];
  limits: Record<string, number>;
}

interface ApiBody<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface CaseTenant {
  key: string;
  org: { id: string; name: string };
  manager: SeedAccount;
  teacher: SeedAccount;
  student: SeedAccount;
}

/** Resolve the shared Supabase admin credentials (env → worker config → local defaults). */
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

function accountEmail(role: string): string {
  return `qa+${shortHash(`${KEY}:${role}`)}+${role}@test.local`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Seed the case's org: the manager as the only `admin`, a `teacher` and a
 * `member`. Seat rows are cleared for **this tenant only** so a pinned
 * `QA_RUN_SUFFIX` re-run starts from the MGR-SEAT-01 state again (pools nobody
 * holds) instead of inheriting the previous run's assignment.
 */
async function seedCaseTenant(): Promise<CaseTenant> {
  const db = createSeedDb(resolveSupabase());

  const manager = buildAccount(KEY, 'manager', 'manager', {
    email: accountEmail('manager'),
    name: `QA seat manager ${RUN_SUFFIX}`,
  });
  const teacher = buildAccount(KEY, 'teacher', 'educator', {
    email: accountEmail('teacher'),
    name: `QA seat teacher ${RUN_SUFFIX}`,
    orgRole: 'teacher',
  });
  const student = buildAccount(KEY, 'student', 'student', {
    email: accountEmail('student'),
    name: `QA seat student ${RUN_SUFFIX}`,
    orgRole: 'member',
  });

  const seeded = await seedTenantGraph(db, {
    key: KEY,
    org: { id: ORG_ID, name: ORG_NAME },
    defaultGroup: { id: GROUP_ID, name: GROUP_NAME, isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [teacher, student],
    ownerOrgRole: 'admin',
  });

  for (const [table, column] of [
    ['org_seat_assignments', 'organization_id'],
    ['org_seat_pools', 'organization_id'],
  ] as const) {
    const { error } = await db.from(table).delete().eq(column, ORG_ID);
    if (error) throw new Error(`seed ${KEY}: ${table} reset failed: ${error.message}`);
  }

  return {
    key: KEY,
    org: { id: ORG_ID, name: ORG_NAME },
    manager: seeded.owner,
    teacher: seeded.members[0],
    student: seeded.members[1],
  };
}

/**
 * Real login through the API, then boot the app with the locale the case's copy
 * is written in and the tenant's organization active (the cookie the app writes
 * on org creation / switch). Resolves only after the dashboard has resolved
 * `/api/v1/features/me`, so a sidebar assertion cannot pass on the provisional
 * "no features yet" state.
 */
async function signIn(
  page: Page,
  origin: string,
  user: SeedAccount,
  landing: RegExp,
): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: user.email, password: user.password },
  });
  expect(response.status(), `login ${user.email}`).toBe(200);

  const { hostname } = new URL(origin);
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' },
    { name: 'active_org_id', value: ORG_ID, domain: hostname, path: '/', httpOnly: true },
  ]);

  const featuresResolved = page.waitForResponse(
    (res) => res.url().includes('/api/v1/features/me'),
    { timeout: 20_000 },
  );
  await page.goto('/login');
  await page.waitForURL(landing, { timeout: 20_000 });
  await featuresResolved;
  await page.waitForLoadState('networkidle');
}

async function signOut(page: Page): Promise<void> {
  const response = await page.request.post('/api/v1/auth/logout');
  expect(response.status(), 'POST /api/v1/auth/logout').toBe(200);
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

/** The cells of one pool row in „Pule miejsc”: plan, purchased, assigned, available. */
async function poolRow(page: Page, planName: string): Promise<string[]> {
  const row = page
    .locator('table')
    .first()
    .getByRole('row', { name: new RegExp(escapeRegExp(planName)) });
  return (await row.getByRole('cell').allInnerTexts()).map((cell) => cell.trim());
}

async function json<T>(response: APIResponse): Promise<ApiBody<T>> {
  expect(response.status(), `${response.url()} answered ${response.status()}`).toBeLessThan(400);
  return (await response.json()) as ApiBody<T>;
}

/** Pick one member in the „Przydziel miejsce” dialog. */
async function pickMember(page: Page, dialog: Locator, member: SeedAccount): Promise<void> {
  await dialog.getByRole('combobox').nth(0).click();
  await page.getByRole('option', { name: new RegExp(escapeRegExp(member.name!)) }).click();
}

/** Read the seat-plan options offered for the member picked in the same dialog. */
async function planOptions(page: Page, dialog: Locator): Promise<string[]> {
  await dialog.getByRole('combobox').nth(1).click();
  const labels = (await page.getByRole('option').allInnerTexts()).map(normalize);
  // Close the listbox without choosing anything.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  return labels;
}

test.describe('@case:MGR-SEAT-02 @area:MGR @prio:P2 assigning a seat to a member', () => {
  let tenant: CaseTenant;
  let catalog: PlanInfo[];
  let pools: Map<string, Pool>;

  test.beforeAll(async () => {
    tenant = await seedCaseTenant();
    console.log(
      `MGR-SEAT-02 tenant key: ${tenant.key} (org ${tenant.org.id}, manager ${tenant.manager.email}, teacher ${tenant.teacher.email}, member ${tenant.student.email})`,
    );
  });

  test('a manager assigns a tier-matched seat and the member is upgraded', async ({
    page,
    request,
    baseURL,
  }) => {
    const origin = baseURL ?? 'http://localhost:3010';
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // The seat plans are shared catalog data: read them, never write them. The
    // spec derives the member's expected features/limits from the catalog instead
    // of hard-coding plan contents.
    catalog = (await json<PlanInfo[]>(await request.get('/api/v1/subscription-plans'))).data;
    const plan = (key: string): PlanInfo => {
      const found = catalog.find((entry) => entry.key === key);
      if (!found) throw new Error(`subscription-plans: no ${key} plan in the catalog`);
      return found;
    };
    const ace = plan('ace');
    const creator = plan('creator');
    const campus = plan('campus');
    // The case's own example: a premium seat plan grants AI.
    expect(ace.features, 'catalog: Ace must include ai.chat').toContain('ai.chat');
    expect(
      typeof ace.limits.max_ai_tokens_per_day,
      'catalog: Ace must declare an AI token limit',
    ).toBe('number');

    // ── Precondition (MGR-SEAT-01): three pools, one per tier, nobody seated ──
    await signIn(page, origin, tenant.manager, /\/manage$/);
    pools = new Map();
    for (const entry of POOLS) {
      const created = await page.request.post('/api/v1/organization/seats/pools', {
        data: { planKey: entry.planKey, quantity: entry.quantity },
      });
      expect(created.status(), `POST /api/v1/organization/seats/pools (${entry.planKey})`).toBe(
        201,
      );
      const body = await json<Pool>(created);
      expect(body.data).toMatchObject({ planKey: entry.planKey, total: entry.quantity });
      pools.set(entry.planKey, body.data);
    }

    // ── Before: the member holds no seat ─────────────────────────────────────
    await signOut(page);
    await signIn(page, origin, tenant.student, /\/app$/);

    const beforeResponse = await page.request.get('/api/v1/features/me');
    const beforeFeatures = (await json<{ features: string[] }>(beforeResponse)).data.features;
    expect(
      beforeFeatures,
      'fixture: the unseated member has no AI entitlement before the seat',
    ).not.toContain('ai.chat');
    const beforeUsage = (await json<{ limit: number }>(await page.request.get('/api/v1/ai/usage')))
      .data;

    // User-visible pre-state: no AI entry in the sidebar and the plan gate on /app/ai.
    await expect(page.getByRole('link', { name: COPY.aiNav })).toHaveCount(0);
    await page.goto('/app/ai');
    await expect(page.getByText(COPY.aiLocked)).toBeVisible();
    await expect(page.getByPlaceholder(COPY.aiPlaceholder)).toHaveCount(0);

    // ── Step 1: the manager assigns the seat ─────────────────────────────────
    await signOut(page);
    await signIn(page, origin, tenant.manager, /\/manage$/);

    // Enter the page the way a manager does: dashboard → „Licencje”.
    await page.locator('a[href="/manage/seats"]').first().click();
    await expect(page).toHaveURL(/\/manage\/seats$/);
    await expect(page.getByRole('heading', { name: COPY.seatsTitle, exact: true })).toBeVisible();
    await watchToasts(page);

    // The purchased pools are listed with their counters: 3/0/3, 3/0/3 and 1/0/1.
    await expect(page.getByText(COPY.poolsTitle)).toBeVisible();
    for (const entry of POOLS) {
      const entryPlan = plan(entry.planKey);
      expect(await poolRow(page, entryPlan.name), `pool row for ${entryPlan.name}`).toEqual([
        entryPlan.name,
        String(entry.quantity),
        '0',
        String(entry.quantity),
      ]);
    }

    await page.getByRole('button', { name: COPY.assignSeat }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Member picker: every org member is offered with its role; all three are actives.
    await dialog.getByRole('combobox').nth(0).click();
    const memberOptions = (await page.getByRole('option').allInnerTexts()).map(normalize);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    expect(memberOptions.sort()).toEqual(
      [
        `${tenant.manager.name} (admin)`,
        `${tenant.teacher.name} (teacher)`,
        `${tenant.student.name} (member)`,
      ].sort(),
    );

    // The plan picker is not usable before a member is chosen, and says so.
    const planPicker = dialog.getByRole('combobox').nth(1);
    await expect(planPicker).toBeDisabled();
    await expect(dialog.getByText(COPY.selectMemberFirst)).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.assign, exact: true })).toBeDisabled();

    // Only the pools matching the picked member's tier are offered.
    await pickMember(page, dialog, tenant.student);
    await expect(planPicker).toBeEnabled();
    expect(await planOptions(page, dialog), 'student member sees only the student pool').toEqual([
      `${ace.name} (0/${pools.get('ace')!.total})`,
    ]);

    await pickMember(page, dialog, tenant.teacher);
    expect(await planOptions(page, dialog), 'teacher sees only the educator pool').toEqual([
      `${creator.name} (0/${pools.get('creator')!.total})`,
    ]);

    await pickMember(page, dialog, tenant.manager);
    expect(await planOptions(page, dialog), 'admin sees only the manager pool').toEqual([
      `${campus.name} (0/${pools.get('campus')!.total})`,
    ]);

    // Pick the member the case assigns a seat to, then the matching plan.
    await pickMember(page, dialog, tenant.student);
    await expect(dialog.getByRole('button', { name: COPY.assign, exact: true })).toBeDisabled();
    await planPicker.click();
    await page.getByRole('option', { name: new RegExp(escapeRegExp(ace.name)) }).click();
    const assignButton = dialog.getByRole('button', { name: COPY.assign, exact: true });
    await expect(assignButton).toBeEnabled();
    await assignButton.click();

    // 2a. Toast.
    await expectToast(page, COPY.assignSuccess);
    await expect(dialog).toBeHidden();

    // 2b. The pool counters move: assigned +1, available −1; other pools untouched.
    const aceAfter = await poolRow(page, ace.name);
    expect(aceAfter).toEqual([
      ace.name,
      String(pools.get('ace')!.total),
      '1',
      String(pools.get('ace')!.total - 1),
    ]);
    expect(await poolRow(page, creator.name)).toEqual([
      creator.name,
      String(pools.get('creator')!.total),
      '0',
      String(pools.get('creator')!.total),
    ]);
    expect(await poolRow(page, campus.name)).toEqual([
      campus.name,
      String(pools.get('campus')!.total),
      '0',
      String(pools.get('campus')!.total),
    ]);

    // 2c. A new row in „Przydziały” for that member with the seat plan.
    await expect(page.getByText(COPY.assignmentsTitle)).toBeVisible();
    const assignmentRows = page.locator('table').nth(1).locator('tbody tr');
    await expect(assignmentRows).toHaveCount(1);
    await expect(assignmentRows.first()).toContainText(tenant.student.name!);
    await expect(assignmentRows.first()).toContainText(ace.name);

    // The same state through the API the page calls.
    const assignments = (
      await json<Assignment[]>(await page.request.get('/api/v1/organization/seats/assignments'))
    ).data;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      userId: tenant.student.id,
      poolId: pools.get('ace')!.id,
      planKey: 'ace',
      userEmail: tenant.student.email,
    });
    const poolsAfterAssign = (
      await json<Pool[]>(await page.request.get('/api/v1/organization/seats/pools'))
    ).data;
    expect(poolsAfterAssign.find((pool) => pool.planKey === 'ace')).toMatchObject({
      total: pools.get('ace')!.total,
      assigned: 1,
    });

    // The seated member no longer appears in the assign picker.
    await page.getByRole('button', { name: COPY.assignSeat }).click();
    const reopen = page.getByRole('dialog');
    await reopen.getByRole('combobox').nth(0).click();
    const remainingMembers = (await page.getByRole('option').allInnerTexts()).map(normalize);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    expect(remainingMembers.sort()).toEqual(
      [`${tenant.manager.name} (admin)`, `${tenant.teacher.name} (teacher)`].sort(),
    );
    await reopen.getByRole('button', { name: COPY.cancel }).click();
    await expect(reopen).toBeHidden();

    // 4. Server-side guards behind the pickers: one seat per member, tier must match.
    const duplicate = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: tenant.student.id, poolId: pools.get('ace')!.id },
    });
    expect(duplicate.status(), 'second seat for the same member').toBe(429);
    expect(await duplicate.json()).toMatchObject({
      success: false,
      error: 'USAGE_LIMIT_EXCEEDED',
    });

    const wrongTier = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: tenant.student.id, poolId: pools.get('creator')!.id },
    });
    expect(wrongTier.status(), 'educator seat for a student member').toBe(400);
    expect(await wrongTier.json()).toMatchObject({ success: false, error: 'BAD_REQUEST' });

    const poolsAfterGuards = (
      await json<Pool[]>(await page.request.get('/api/v1/organization/seats/pools'))
    ).data;
    expect(poolsAfterGuards.map((pool) => [pool.planKey, pool.assigned])).toEqual([
      ['ace', 1],
      ['campus', 0],
      ['creator', 0],
    ]);
    expect(
      (await json<Assignment[]>(await page.request.get('/api/v1/organization/seats/assignments')))
        .data,
      'the rejected requests created no assignment',
    ).toHaveLength(1);

    // ── Step 2: the member logs in and holds the seat plan ───────────────────
    await signOut(page);
    await signIn(page, origin, tenant.student, /\/app$/);

    // The seat plan's features are now live for the member.
    const afterFeatures = (
      await json<{ features: string[] }>(await page.request.get('/api/v1/features/me'))
    ).data.features;
    for (const key of beforeFeatures) {
      expect(afterFeatures, `additive: the member keeps ${key}`).toContain(key);
    }
    for (const key of ace.features) {
      if ((ADMIN_ONLY_FEATURES as readonly string[]).includes(key)) continue;
      expect(afterFeatures, `the member receives the seat plan feature ${key}`).toContain(key);
    }
    expect(afterFeatures, 'the case example: AI access from the premium seat').toContain('ai.chat');
    for (const key of ADMIN_ONLY_FEATURES) {
      expect(afterFeatures, `admin-only ${key} must not be granted through a seat`).not.toContain(
        key,
      );
    }

    // The seat plan is the member's effective plan, and its limits apply.
    const memberPlan = (await json<PlanInfo>(await page.request.get('/api/v1/me/plan'))).data;
    expect(memberPlan.key).toBe('ace');
    const afterUsage = (await json<{ limit: number }>(await page.request.get('/api/v1/ai/usage')))
      .data;
    expect(afterUsage.limit, 'the seat plan’s AI token limit applies').toBe(
      ace.limits.max_ai_tokens_per_day,
    );
    expect(afterUsage.limit).toBeGreaterThan(beforeUsage.limit);

    // User-visible effect: the AI entry appears and /app/ai is no longer gated.
    const aiNav = page.getByRole('link', { name: COPY.aiNav });
    await expect(aiNav).toHaveCount(1);
    await aiNav.click();
    await page.waitForURL(/\/app\/ai$/);
    await expect(page.getByPlaceholder(COPY.aiPlaceholder)).toBeVisible();
    await expect(page.getByText(COPY.aiLocked)).toHaveCount(0);

    expect(pageErrors, 'uncaught page errors while assigning and using the seat').toEqual([]);
  });
});
