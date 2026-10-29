import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * MGR-SEAT-02 — assigning a seat to a member.
 *
 * Prerequisite (reconciled with the tenant seeder): the seat pools from MGR-SEAT-01
 * („pula z MGR-SEAT-01”) — purchased seats that nobody holds yet. The legacy manual
 * seed (`manager@dev.local`, password `pass`) is never used.
 *
 * Tenant: `qa/tests/profiles/MGR-SEAT-02.json` declares the `content` profile, so the
 * suite seeds one organization with its admin (`manager`), teacher and member
 * (`student`) plus the default group **before Playwright starts**:
 *
 *   bun scripts/qa-tenant.ts --all --run <suffix>
 *   bun scripts/qa-tenant.ts MGR-SEAT-02 --fresh
 *
 * The profile stays on the free Launch plan on purpose: the case checks that a member
 * has **no** AI entitlement before the seat and receives the seat plan's features
 * after it, and Hub already grants `ai.chat` to every member.
 *
 * The spec then provisions the rest through the product API: it promotes the teacher
 * account to the org's `teacher` role (so the picker's tier matrix has all three
 * roles), clears any assignment a previous run left behind, and buys the pools the
 * MGR-SEAT-01 precondition needs — one per tier so the role/tier filtering is
 * observable: Ace (student tier, 3), Creator (educator tier, 3), Campus (manager
 * tier, 1). Nothing global is written — no settings, feature flags, plans or platform
 * rows — and no other case's tenant is touched.
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

const CASE = 'MGR-SEAT-02';

/**
 * Full names the `content` profile gives its three accounts (`scripts/qa-tenant.ts`
 * → `buildAccount`). The member picker renders `full_name` + the org role.
 */
const NAMES = {
  manager: 'QA manager',
  teacher: 'QA teacher',
  student: 'QA student',
} as const;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Real login through the API, then boot the app with the locale the case's copy
 * is written in and the tenant's organization active (the cookie the app writes
 * on org creation / switch). Resolves only after the dashboard has resolved
 * `/api/v1/features/me`, so a sidebar assertion cannot pass on the provisional
 * "no features yet" state.
 */
async function signIn(page: Page, tenant: QaTenant, role: QaRole, landing: RegExp): Promise<void> {
  const featuresResolved = page.waitForResponse(
    (res) => res.url().includes('/api/v1/features/me'),
    { timeout: 20_000 },
  );
  await loginAs(page, tenant, role, { locale: 'pl', waitFor: landing });
  await featuresResolved;
  await page.waitForLoadState('networkidle');
}

/** The seeded account ids, as the case's API assertions reference them. */
function userId(tenant: QaTenant, role: QaRole): string {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user.id;
}

/**
 * The `content` profile enrols the teacher with the org's default `member` role; the
 * case's tier matrix needs a real `teacher` role as well (educator tier). Promote the
 * account through the product's own member endpoint.
 */
async function ensureTeacherRole(page: Page, tenant: QaTenant): Promise<void> {
  const roles = (
    await json<Array<{ id: string; name: string }>>(
      await page.request.get('/api/v1/organization/roles'),
    )
  ).data;
  const teacherRole = roles.find((role) => role.name === 'teacher');
  if (!teacherRole) throw new Error('tenant org has no teacher role');
  const response = await page.request.put('/api/v1/organization/members', {
    data: { targetUserId: userId(tenant, 'teacher'), newOrgRoleId: teacherRole.id },
  });
  expect(response.status(), 'PUT /api/v1/organization/members (teacher role)').toBe(200);
}

/**
 * The MGR-SEAT-01 state: nobody holds a seat. A repeated run on the same seeded
 * tenant would otherwise inherit the previous run's assignment (and then refuse the
 * new one as a duplicate), so the spec releases every seat through the API first.
 */
async function resetSeats(page: Page): Promise<void> {
  const assignments = (
    await json<Assignment[]>(await page.request.get('/api/v1/organization/seats/assignments'))
  ).data;
  for (const assignment of assignments) {
    const response = await page.request.delete(
      `/api/v1/organization/seats/assignments/${assignment.id}`,
    );
    expect(response.status(), `DELETE assignment ${assignment.id}`).toBe(200);
  }
}

/**
 * Buy one pool per tier, or resize the pool an earlier run on this tenant left
 * behind: the case's precondition is exactly `quantity` seats, none assigned.
 */
async function ensurePool(page: Page, entry: (typeof POOLS)[number]): Promise<Pool> {
  const existing = (
    await json<Pool[]>(await page.request.get('/api/v1/organization/seats/pools'))
  ).data.find((pool) => pool.planKey === entry.planKey);
  const response = existing
    ? await page.request.put(`/api/v1/organization/seats/pools/${existing.id}`, {
        data: { total: entry.quantity },
      })
    : await page.request.post('/api/v1/organization/seats/pools', {
        data: { planKey: entry.planKey, quantity: entry.quantity },
      });
  const body = await json<Pool>(response);
  expect(body.data, `pool ${entry.planKey}`).toMatchObject({
    planKey: entry.planKey,
    total: entry.quantity,
    assigned: 0,
  });
  return body.data;
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
async function pickMember(page: Page, dialog: Locator, name: string): Promise<void> {
  await dialog.getByRole('combobox').nth(0).click();
  await page.getByRole('option', { name: new RegExp(escapeRegExp(name)) }).click();
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
  let catalog: PlanInfo[];
  let pools: Map<string, Pool>;

  test('a manager assigns a tier-matched seat and the member is upgraded', async ({
    page,
    request,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.org, `${CASE} needs the seeded organization`).toBeTruthy();
    expect(tenant.users.teacher, `${CASE} needs the seeded teacher`).toBeTruthy();
    expect(tenant.users.student, `${CASE} needs the seeded member`).toBeTruthy();

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
    await signIn(page, tenant, 'manager', /\/manage$/);
    await ensureTeacherRole(page, tenant);
    // The case's tier matrix counts on one admin, one teacher and one member.
    const members = (
      await json<Array<{ id: string; orgRoleName: string }>>(
        await page.request.get('/api/v1/organization/members'),
      )
    ).data;
    expect(
      new Set(members.map((member) => member.orgRoleName)),
      'the tenant has an admin, a teacher and a member',
    ).toEqual(new Set(['admin', 'teacher', 'member']));

    await resetSeats(page);
    pools = new Map();
    for (const entry of POOLS) {
      pools.set(entry.planKey, await ensurePool(page, entry));
    }

    // ── Before: the member holds no seat ─────────────────────────────────────
    await signOut(page);
    await signIn(page, tenant, 'student', /\/app$/);

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
    await signIn(page, tenant, 'manager', /\/manage$/);

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
        `${NAMES.manager} (admin)`,
        `${NAMES.teacher} (teacher)`,
        `${NAMES.student} (member)`,
      ].sort(),
    );

    // The plan picker is not usable before a member is chosen, and says so.
    const planPicker = dialog.getByRole('combobox').nth(1);
    await expect(planPicker).toBeDisabled();
    await expect(dialog.getByText(COPY.selectMemberFirst)).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.assign, exact: true })).toBeDisabled();

    // Only the pools matching the picked member's tier are offered.
    await pickMember(page, dialog, NAMES.student);
    await expect(planPicker).toBeEnabled();
    expect(await planOptions(page, dialog), 'student member sees only the student pool').toEqual([
      `${ace.name} (0/${pools.get('ace')!.total})`,
    ]);

    await pickMember(page, dialog, NAMES.teacher);
    expect(await planOptions(page, dialog), 'teacher sees only the educator pool').toEqual([
      `${creator.name} (0/${pools.get('creator')!.total})`,
    ]);

    await pickMember(page, dialog, NAMES.manager);
    expect(await planOptions(page, dialog), 'admin sees only the manager pool').toEqual([
      `${campus.name} (0/${pools.get('campus')!.total})`,
    ]);

    // Pick the member the case assigns a seat to, then the matching plan.
    await pickMember(page, dialog, NAMES.student);
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
    await expect(assignmentRows.first()).toContainText(NAMES.student);
    await expect(assignmentRows.first()).toContainText(ace.name);

    // The same state through the API the page calls.
    const assignments = (
      await json<Assignment[]>(await page.request.get('/api/v1/organization/seats/assignments'))
    ).data;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      userId: userId(tenant, 'student'),
      poolId: pools.get('ace')!.id,
      planKey: 'ace',
      userEmail: tenant.users.student!.email,
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
      [`${NAMES.manager} (admin)`, `${NAMES.teacher} (teacher)`].sort(),
    );
    await reopen.getByRole('button', { name: COPY.cancel }).click();
    await expect(reopen).toBeHidden();

    // 4. Server-side guards behind the pickers: one seat per member, tier must match.
    const duplicate = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'student'), poolId: pools.get('ace')!.id },
    });
    expect(duplicate.status(), 'second seat for the same member').toBe(429);
    expect(await duplicate.json()).toMatchObject({
      success: false,
      error: 'USAGE_LIMIT_EXCEEDED',
    });

    const wrongTier = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'student'), poolId: pools.get('creator')!.id },
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
    await signIn(page, tenant, 'student', /\/app$/);

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
