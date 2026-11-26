import { isEntitlementKey, LEARNER_ENTITLEMENTS } from '@studiq/authz';
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import {
  loadTenant,
  loginAs,
  tenantUser,
  type QaRole,
  type QaTenant,
} from '#test/qa/fixtures/tenant';

/**
 * MGR-SEAT-02 — assigning a seat to a member (the positive seat-upgrade story).
 *
 * Prerequisite (reconciled with the tenant seeder): the seat pools bought at run
 * time — purchased seats that nobody holds yet. The legacy manual seed
 * (`manager@dev.local`, password `pass`) is never used.
 *
 * Tenant: `__tests__/qa/profiles/MGR-SEAT-02.json` declares the `content` profile
 * **on the `hub` plan** with an explicit roster — manager (`admin`), teacher
 * (`teacher`), `student` and `student2` (both `member`):
 *
 *   bun scripts/qa-tenant.ts MGR-SEAT-02 --fresh
 *
 * Hub is the org ceiling that already carries `ai.chat` and `branding` (the
 * learner set) plus the non-learner `stats.insights`, so a seat can visibly
 * **raise** the member's entitlements (ADR-0015 §5.4: seat ∩ ceiling) and the
 * user-scope AI-token limit (`max(org, seat, personal)`, D4/D30).
 *
 * The spec provisions the pools through the product API — one per individual plan
 * so the unfiltered picker is observable: Free ×1, Plus ×3, Pro ×3, Max ×2 —
 * clears any assignment a previous run left behind, and assigns the **`pro`**
 * seat to `student` through the UI.
 * Nothing global is written — no settings, feature flags, plans or platform
 * rows — and no other case's tenant is touched.
 *
 * Acceptance points:
 * 1. „Przydziel miejsce” opens a dialog whose seat-plan picker stays disabled until
 *    a member is chosen. After a member is picked it offers **every** pool of the
 *    org: a personal plan has no audience since #1193, so persona no longer
 *    filters the picker.
 * 2. „Przydziel” shows the toast „Miejsce przydzielone pomyślnie”, a new row in
 *    „Przydziały” for that member with the seat plan, and the pool moves from
 *    2/0/2 to 2/1/1 (assigned +1, available −1); the other pools are untouched.
 * 3. After the seat the member's `/api/v1/me/entitlements` differs from before by
 *    **exactly the hub ceiling's non-learner keys, `quiz.templates` and
 *    `stats.insights`** (seat ∩ hub ceiling); `/api/v1/me/plan` is the seat plan
 *    `pro` with `max_ai_tokens_per_day === 500000`, and
 *    `/api/v1/ai/usage` reports `limit: 500000` with `plan: 'hub'` (the effective
 *    primary stays the org plan, D30) — the seat raises the AI limit from hub's
 *    200000. `student2` (no seat) keeps 200000 and no `stats.insights`: the seat
 *    is per-member, not org-wide.
 * 4. Adjacent regression: the guards behind the pickers hold server-side — a
 *    second seat for the same member is rejected (429 `USAGE_LIMIT_EXCEEDED`) and
 *    a different member accepts any pool, including one whose plan used to name
 *    another persona (201). The member drops out of the picker once seated.
 */

declare global {
  interface Window {
    qaToasts?: string[];
  }
}

const CASE = 'MGR-SEAT-02';

/**
 * Full names the declared roster gives its accounts (`scripts/seed/qa.ts` →
 * `buildAccount` defaults to `QA <key>`, which collides as a substring the
 * moment one key is a prefix of another — the picker's option match is a
 * regex, so `QA student` also matched `QA student2` in 3d).
 */
const NAMES = {
  manager: 'QA seat manager',
  teacher: 'QA seat teacher',
  student: 'QA seat student',
  student2: 'QA seat control',
} as const;

/**
 * One pool per individual plan, so the picker's unfiltered list is provable
 * rather than a sample of one. Since #1193 a personal plan carries no audience,
 * so every pool is offerable to any member.
 */
const POOLS = [
  { planKey: 'base', quantity: 1 },
  { planKey: 'spark', quantity: 3 },
  { planKey: 'ace', quantity: 3 },
  { planKey: 'pro', quantity: 2 },
] as const;

/** The seat assigned to `student` in step 1: a non-learner key it adds is `stats.insights`. */
const SEAT_PLAN_KEY = 'pro';

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
  scope: string;
  audience: string | null;
  seatEligible: boolean;
  isActive: boolean;
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
 * `/api/v1/me/entitlements`, so a sidebar assertion cannot pass on the provisional
 * "no entitlements yet" state.
 */
async function signIn(page: Page, tenant: QaTenant, role: QaRole, landing: RegExp): Promise<void> {
  const entitlementsResolved = page.waitForResponse(
    (res) => res.url().includes('/api/v1/me/entitlements'),
    { timeout: 20_000 },
  );
  await loginAs(page, tenant, role, { locale: 'pl', waitFor: landing });
  await entitlementsResolved;
  await page.waitForLoadState('networkidle');
}

/** The seeded account ids, as the case's API assertions reference them. */
function userId(tenant: QaTenant, role: QaRole): string {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user.id;
}

/**
 * The MGR-SEAT-01 state: nobody holds a seat. A repeated run on the same seeded
 * tenant would otherwise inherit the previous run's assignment (and then refuse the
 * new one as a duplicate), so the spec releases every seat through the API first.
 */
async function resetSeats(page: Page): Promise<void> {
  const assignments = (
    await readEnvelope<Assignment[]>(
      await page.request.get('/api/v1/organization/seats/assignments'),
    )
  ).data;
  for (const assignment of assignments) {
    const response = await page.request.delete(
      `/api/v1/organization/seats/assignments/${assignment.id}`,
    );
    expect(response.status(), `DELETE assignment ${assignment.id}`).toBe(200);
  }
}

/**
 * Buy one pool per audience, or resize the pool an earlier run on this tenant left
 * behind: the case's precondition is exactly `quantity` seats, none assigned.
 */
async function ensurePool(page: Page, entry: (typeof POOLS)[number]): Promise<Pool> {
  const existing = (
    await readEnvelope<Pool[]>(await page.request.get('/api/v1/organization/seats/pools'))
  ).data.find((pool) => pool.planKey === entry.planKey);
  const response = existing
    ? await page.request.put(`/api/v1/organization/seats/pools/${existing.id}`, {
        data: { total: entry.quantity },
      })
    : await page.request.post('/api/v1/organization/seats/pools', {
        data: { planKey: entry.planKey, quantity: entry.quantity },
      });
  const body = await readEnvelope<Pool>(response);
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
    if (window.qaToasts) return;
    const recorded: string[] = [];
    window.qaToasts = recorded;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll<HTMLElement>('[data-sonner-toast]')) {
        const text = node.innerText.trim();
        if (text && !recorded.includes(text)) recorded.push(text);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}

function expectToast(page: Page, text: string) {
  return expect
    .poll(() => page.evaluate(() => window.qaToasts ?? []), { timeout: 10_000 })
    .toContain(text);
}

/** The cells of one pool row in „Pule miejsc”: plan, purchased, assigned, available. */
async function poolRow(page: Page, planName: string): Promise<string[]> {
  const row = page
    .locator('table')
    .first()
    .getByRole('row', { name: new RegExp(escapeRegExp(planName)) });
  const cells = (await row.getByRole('cell').allInnerTexts()).map((cell) => cell.trim());
  // The available cell also renders the „Mało” badge, so a low pool reads
  // `1Mało`; the counter is the part before the badge.
  if (cells.length === 4) cells[3] = cells[3].replace(/Mało$/, '');
  return cells;
}

/**
 * The pool row equals `expected`, retried until it does.
 *
 * A one-shot `poolRow()` read right after a mutation races the table's refetch:
 * the row is briefly absent (the observed flake read `[]`), then comes back with
 * the new counters. Poll the value instead of reading it once.
 */
async function expectPoolRow(
  page: Page,
  planName: string,
  expected: string[],
  message: string,
): Promise<void> {
  await expect.poll(() => poolRow(page, planName), { message }).toEqual(expected);
}

async function readEnvelope<T>(response: APIResponse): Promise<ApiBody<T>> {
  expect(response.status(), `${response.url()} answered ${response.status()}`).toBeLessThan(400);
  return json<ApiBody<T>>(response);
}

/** Pick one member in the „Przydziel miejsce” dialog. */
async function pickMember(page: Page, dialog: Locator, name: string): Promise<void> {
  await dialog.getByRole('combobox').nth(0).click();
  await page.getByRole('option', { name: new RegExp(escapeRegExp(name)) }).click();
}

/** Read the seat-plan options offered for the member picked in the same dialog. */
async function planOptions(page: Page, dialog: Locator): Promise<string[]> {
  await dialog.getByRole('combobox').nth(1).click();
  // The listbox is portalled and animated: read it only once it is on screen,
  // otherwise `allInnerTexts()` can return the previous (empty) state.
  await expect(page.getByRole('listbox')).toBeVisible();
  const labels = (await page.getByRole('option').allInnerTexts()).map(normalize);
  // Close the listbox without choosing anything.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  return labels;
}

/** Read the member options of the assign dialog without choosing one. */
async function memberOptions(page: Page, dialog: Locator): Promise<string[]> {
  await dialog.getByRole('combobox').nth(0).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  const labels = (await page.getByRole('option').allInnerTexts()).map(normalize);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  return labels;
}

test.describe('@case:MGR-SEAT-02 @area:MGR @prio:P2 assigning a seat to a member', () => {
  test('a manager assigns a seat and the seat raises exactly the non-learner keys within the org ceiling', async ({
    page,
    request,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.plan, `${CASE} needs its tenant org on the hub plan`).toBe('hub');
    expect(tenant.org, `${CASE} needs the seeded organization`).toBeTruthy();
    for (const role of ['manager', 'teacher', 'student', 'student2'] as const) {
      expect(tenant.users[role], `${CASE} needs the seeded ${role}`).toBeTruthy();
    }

    // The seat plans are shared catalog data: read them, never write them. The
    // spec derives the member's expected features/limits from the catalog instead
    // of hard-coding plan contents.
    const catalog = (
      await readEnvelope<PlanInfo[]>(await request.get('/api/v1/subscription-plans'))
    ).data;
    const plan = (key: string): PlanInfo => {
      const found = catalog.find((entry) => entry.key === key);
      if (!found) throw new Error(`subscription-plans: no ${key} plan in the catalog`);
      return found;
    };
    const hub = plan('hub');
    const base = plan('base');
    const spark = plan('spark');
    const ace = plan('ace');
    const pro = plan(SEAT_PLAN_KEY);
    // Catalog facts the story leans on: hub carries the learner keys plus the
    // non-learner `quiz.templates` and `stats.insights`; the seat plan carries
    // both too and raises the AI token budget above hub's.
    expect(hub.features, 'catalog: Hub must carry stats.insights').toContain('stats.insights');
    expect(pro.features, 'catalog: Max must carry stats.insights').toContain('stats.insights');
    expect(pro.features, 'catalog: Max must carry quiz.templates').toContain('quiz.templates');
    expect(pro.limits.max_ai_tokens_per_day, 'catalog: Max raises the AI budget').toBe(500_000);
    expect(hub.limits.max_ai_tokens_per_day, 'catalog: Hub caps AI tokens at 200000').toBe(200_000);
    // The unseated member's feature set is the learner profile ∩ the hub ceiling.
    const learnerOnHub = hub.features.filter(
      (key) => isEntitlementKey(key) && LEARNER_ENTITLEMENTS.includes(key),
    );
    expect(learnerOnHub.toSorted(), 'fixture: learner ∩ hub').toEqual(
      ['ai.chat', 'branding', 'flashcards', 'quiz'].toSorted(),
    );

    // ── Precondition (MGR-SEAT-01): four pools, one per audience, nobody seated ──
    await signIn(page, tenant, 'manager', /\/manage$/);
    // The roster now carries the persona: the seats page filters pools by it.
    const members = (
      await readEnvelope<Array<{ id: string; orgRoleName: string; accountType: string }>>(
        await page.request.get('/api/v1/organization/members'),
      )
    ).data;
    expect(
      members.map((member) => [member.orgRoleName, member.accountType]).toSorted(),
      'the tenant roster pairs each org role with its account type',
    ).toEqual(
      [
        ['admin', 'manager'],
        ['member', 'student'],
        ['member', 'student'],
        ['teacher', 'educator'],
      ].toSorted(),
    );

    await resetSeats(page);
    const pools = new Map<string, Pool>();
    for (const entry of POOLS) {
      pools.set(entry.planKey, await ensurePool(page, entry));
    }

    // ── Before: the member holds no seat ─────────────────────────────────────
    await signOut(page);
    await signIn(page, tenant, 'student', /\/app$/);

    const beforeEntitlements = (
      await readEnvelope<{ entitlements: string[] }>(
        await page.request.get('/api/v1/me/entitlements'),
      )
    ).data.entitlements;
    expect(beforeEntitlements.toSorted(), 'the unseated member resolves learner ∩ hub').toEqual(
      learnerOnHub.toSorted(),
    );
    expect(beforeEntitlements, 'no seat yet: no stats.insights').not.toContain('stats.insights');
    const beforeUsage = (
      await readEnvelope<{ limit: number; plan: string }>(
        await page.request.get('/api/v1/ai/usage'),
      )
    ).data;
    expect(beforeUsage, 'the hub org caps the member AI budget before the seat').toEqual({
      current: expect.any(Number),
      limit: hub.limits.max_ai_tokens_per_day,
      plan: 'hub',
      resetsAt: expect.any(String),
    });

    // ── Step 1: the manager assigns the pro seat ─────────────────────────────
    await signOut(page);
    await signIn(page, tenant, 'manager', /\/manage$/);

    // Enter the page the way a manager does: dashboard → „Licencje”.
    await page.locator('a[href="/manage/seats"]').first().click();
    await expect(page).toHaveURL(/\/manage\/seats$/);
    await expect(page.getByRole('heading', { name: COPY.seatsTitle, exact: true })).toBeVisible();
    await watchToasts(page);

    // The purchased pools are listed with their counters.
    await expect(page.getByText(COPY.poolsTitle)).toBeVisible();
    for (const entry of POOLS) {
      const entryPlan = plan(entry.planKey);
      await expectPoolRow(
        page,
        entryPlan.name,
        [entryPlan.name, String(entry.quantity), '0', String(entry.quantity)],
        `pool row for ${entryPlan.name}`,
      );
    }

    await page.getByRole('button', { name: COPY.assignSeat }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Member picker: every org member is offered with its org role; all four are active.
    expect((await memberOptions(page, dialog)).toSorted()).toEqual(
      [
        `${NAMES.manager} (admin)`,
        `${NAMES.teacher} (teacher)`,
        `${NAMES.student} (member)`,
        `${NAMES.student2} (member)`,
      ].toSorted(),
    );

    // The plan picker is not usable before a member is chosen, and says so.
    const planPicker = dialog.getByRole('combobox').nth(1);
    await expect(planPicker).toBeDisabled();
    await expect(dialog.getByText(COPY.selectMemberFirst)).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.assign, exact: true })).toBeDisabled();

    // Every pool of the org is offerable to any member: a personal plan has no
    // audience since #1193, so the picker does not filter by persona.
    const expectedPools = POOLS.map(
      (entry) => `${plan(entry.planKey).name} (0/${pools.get(entry.planKey)!.total})`,
    ).toSorted();
    for (const member of [NAMES.student, NAMES.teacher, NAMES.manager]) {
      await pickMember(page, dialog, member);
      await expect(planPicker).toBeEnabled();
      expect(
        (await planOptions(page, dialog)).toSorted(),
        `${member} sees every pool of the org`,
      ).toEqual(expectedPools);
    }

    // Pick the member the case assigns a seat to, then the matching plan.
    await pickMember(page, dialog, NAMES.student);
    await expect(dialog.getByRole('button', { name: COPY.assign, exact: true })).toBeDisabled();
    await planPicker.click();
    await page.getByRole('option', { name: new RegExp(escapeRegExp(pro.name)) }).click();
    const assignButton = dialog.getByRole('button', { name: COPY.assign, exact: true });
    await expect(assignButton).toBeEnabled();
    await assignButton.click();

    // 2a. Toast.
    await expectToast(page, COPY.assignSuccess);
    await expect(dialog).toBeHidden();

    // 2b. The pool counters move: assigned +1, available −1; other pools untouched.
    await expectPoolRow(
      page,
      pro.name,
      [pro.name, String(pools.get('pro')!.total), '1', String(pools.get('pro')!.total - 1)],
      'the assigned pool moves to 1 assigned',
    );
    await expectPoolRow(
      page,
      ace.name,
      [ace.name, String(pools.get('ace')!.total), '0', String(pools.get('ace')!.total)],
      'the other pool is untouched',
    );
    await expectPoolRow(
      page,
      spark.name,
      [spark.name, String(pools.get('spark')!.total), '0', String(pools.get('spark')!.total)],
      'the Plus pool is untouched',
    );
    await expectPoolRow(
      page,
      base.name,
      [base.name, String(pools.get('base')!.total), '0', String(pools.get('base')!.total)],
      'the Free pool is untouched',
    );

    // 2c. A new row in „Przydziały” for that member with the seat plan.
    await expect(page.getByText(COPY.assignmentsTitle)).toBeVisible();
    const assignmentRows = page.locator('table').nth(1).locator('tbody tr');
    await expect(assignmentRows).toHaveCount(1);
    await expect(assignmentRows.first()).toContainText(NAMES.student);
    await expect(assignmentRows.first()).toContainText(pro.name);

    // The same state through the API the page calls.
    const assignments = (
      await readEnvelope<Assignment[]>(
        await page.request.get('/api/v1/organization/seats/assignments'),
      )
    ).data;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      userId: userId(tenant, 'student'),
      poolId: pools.get('pro')!.id,
      planKey: SEAT_PLAN_KEY,
      userEmail: tenantUser(tenant, 'student').email,
    });
    const poolsAfterAssign = (
      await readEnvelope<Pool[]>(await page.request.get('/api/v1/organization/seats/pools'))
    ).data;
    expect(poolsAfterAssign.find((pool) => pool.planKey === SEAT_PLAN_KEY)).toMatchObject({
      total: pools.get('pro')!.total,
      assigned: 1,
    });

    // The seated member no longer appears in the assign picker.
    await page.getByRole('button', { name: COPY.assignSeat }).click();
    const reopen = page.getByRole('dialog');
    expect((await memberOptions(page, reopen)).toSorted()).toEqual(
      [
        `${NAMES.manager} (admin)`,
        `${NAMES.teacher} (teacher)`,
        `${NAMES.student2} (member)`,
      ].toSorted(),
    );
    await reopen.getByRole('button', { name: COPY.cancel }).click();
    await expect(reopen).toBeHidden();

    // 4. Server-side guards behind the pickers: one seat per member; a pool
    //    accepts any member because the plan has no audience.
    const duplicate = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'student'), poolId: pools.get('pro')!.id },
    });
    expect(duplicate.status(), 'second seat for the same member').toBe(429);
    expect(await duplicate.json()).toMatchObject({
      success: false,
      error: 'USAGE_LIMIT_EXCEEDED',
    });

    const crossPersona = await page.request.post('/api/v1/organization/seats/assignments', {
      data: { userId: userId(tenant, 'teacher'), poolId: pools.get('base')!.id },
    });
    expect(crossPersona.status(), 'an educator accepts a personal-plan pool').toBe(201);

    const poolsAfterGuards = (
      await readEnvelope<Pool[]>(await page.request.get('/api/v1/organization/seats/pools'))
    ).data;
    expect(poolsAfterGuards.map((pool) => [pool.planKey, pool.assigned]).toSorted()).toEqual(
      [
        ['base', 1],
        ['spark', 0],
        ['ace', 0],
        ['pro', 1],
      ].toSorted(),
    );
    expect(
      (
        await readEnvelope<Assignment[]>(
          await page.request.get('/api/v1/organization/seats/assignments'),
        )
      ).data,
      'the seed plus the cross-persona assignment only',
    ).toHaveLength(2);

    // ── Step 2: the seated member's entitlements and limits ──────────────────
    await signOut(page);
    await signIn(page, tenant, 'student', /\/app$/);

    // ADR-0015 §5.4: seat entitlements are intersected with the org ceiling, so
    // on the hub org the pro seat adds the non-learner keys the hub ceiling
    // carries — `quiz.templates` and `stats.insights` — and no other key.
    const afterEntitlements = (
      await readEnvelope<{ entitlements: string[] }>(
        await page.request.get('/api/v1/me/entitlements'),
      )
    ).data.entitlements;
    expect(
      afterEntitlements.toSorted(),
      "the seat ∩ hub ceiling adds the hub ceiling's non-learner keys, nothing else",
    ).toEqual([...learnerOnHub, 'quiz.templates', 'stats.insights'].toSorted());
    expect(afterEntitlements).toContain('stats.insights');
    expect(afterEntitlements).toContain('ai.chat');

    // The seat is the member's effective plan (D28/D34): /me/plan resolves `pro`
    // with the seat plan's own AI budget and the raised feature set.
    const memberPlan = (await readEnvelope<PlanInfo>(await page.request.get('/api/v1/me/plan')))
      .data;
    expect(memberPlan.key).toBe(SEAT_PLAN_KEY);
    expect(memberPlan.limits.max_ai_tokens_per_day, 'max(org, seat, personal): 500000 wins').toBe(
      500_000,
    );
    expect(memberPlan.features, 'the effective plan carries the seat-added key').toContain(
      'stats.insights',
    );

    // The AI usage view reports the raised limit with the org plan as the
    // effective primary (D30): the seat raised the budget from hub's 200000 to
    // Max's 500000.
    const afterUsage = (
      await readEnvelope<{ limit: number; plan: string }>(
        await page.request.get('/api/v1/ai/usage'),
      )
    ).data;
    expect(afterUsage.limit, 'the seat raises the AI limit above hub’s 200000').toBe(500_000);
    expect(afterUsage.plan, 'the effective primary stays the org plan').toBe('hub');

    // ── The control member: the seat is per-member, not org-wide ─────────────
    await signOut(page);
    await signIn(page, tenant, 'student2', /\/app$/);

    const controlEntitlements = (
      await readEnvelope<{ entitlements: string[] }>(
        await page.request.get('/api/v1/me/entitlements'),
      )
    ).data.entitlements;
    expect(controlEntitlements.toSorted(), 'the unseated control keeps learner ∩ hub').toEqual(
      learnerOnHub.toSorted(),
    );
    expect(controlEntitlements, 'no seat: no stats.insights').not.toContain('stats.insights');

    const controlPlan = (await readEnvelope<PlanInfo>(await page.request.get('/api/v1/me/plan')))
      .data;
    expect(controlPlan.key, 'the unseated member resolves their personal plan').toBe('base');
    expect(
      controlPlan.limits.max_ai_tokens_per_day,
      'max(org, personal) without a seat stays at hub’s 200000',
    ).toBe(hub.limits.max_ai_tokens_per_day);
    const controlUsage = (
      await readEnvelope<{ limit: number; plan: string }>(
        await page.request.get('/api/v1/ai/usage'),
      )
    ).data;
    expect(controlUsage.limit).toBe(200_000);
    expect(controlUsage.plan).toBe('hub');

    expect(pageErrors, 'uncaught page errors while assigning and using the seat').toEqual([]);
  });
});
