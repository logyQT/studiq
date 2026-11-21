import { AccountType, type LimitKey, type RequestContext } from '@studiq/authz';
import { EntitlementResolver } from '@studiq/server/services/entitlement.resolver';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allFlagsOn,
  type FlagRow,
  mockResolverTables,
} from '#test/helpers/entitlement-resolver-mock';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

/**
 * ADR-0015 §6.2 truth table, pinned against the in-resolver composition
 * (phase 3b): `scope:'user'` keys take `max(org, seat, personal)` with `-1`
 * short-circuiting, `scope:'org'` keys come from the verified org's plan only,
 * a missing `plan_limits` row is `0`, and membership is verified before the
 * seat plan is consulted.
 */

const ORG_LIMITS: Partial<Record<LimitKey, number>> = {
  max_flashcards: 2000,
  max_decks: 200,
  max_questions: 1000,
  max_question_banks: 100,
  max_quiz_attempts_per_day: -1,
  max_ai_tokens_per_day: 200000,
  max_students: 50,
  max_groups: 20,
};

const SEAT_LIMITS: Partial<Record<LimitKey, number>> = {
  max_flashcards: 100,
  max_decks: 10,
  max_questions: 50,
  max_question_banks: 5,
  max_quiz_attempts_per_day: 10,
  max_ai_tokens_per_day: 0,
  // The seed quirk: a personal/seat plan carries `-1` for org-scope keys
  // (#233 note in the design); org capacity must never read them.
  max_students: -1,
  max_groups: -1,
};

const PERSONAL_LIMITS: Partial<Record<LimitKey, number>> = {
  max_flashcards: 100,
  max_decks: 10,
  max_questions: 50,
  max_question_banks: 5,
  max_quiz_attempts_per_day: 10,
  max_ai_tokens_per_day: 0,
  max_students: -1,
  max_groups: -1,
};

describe('EntitlementResolver limits composition (ADR-0015 §6.2)', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let resolver: EntitlementResolver;

  const baseCtx: RequestContext = {
    userId: 'user-1',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  const memberCtx = (overrides: Partial<RequestContext> = {}): RequestContext => ({
    ...baseCtx,
    activeOrgId: 'org-1',
    orgRoleId: 'role-member',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    resolver = new EntitlementResolver(() => Promise.resolve(mock));
  });

  it('row 1: no org — user keys come from the personal plan, org keys are 0', async () => {
    mockResolverTables(mock, {
      personalPlanKey: 'base',
      planLimits: { base: PERSONAL_LIMITS },
    });

    const { limits } = await resolver.resolveEntitlements(baseCtx);

    expect(limits.max_flashcards).toBe(100);
    expect(limits.max_ai_tokens_per_day).toBe(0);
    expect(limits.max_students).toBe(0);
    expect(limits.max_groups).toBe(0);
    expect(mock.from).not.toHaveBeenCalledWith('org_members');
  });

  it('row 2: org member unseated — user keys are max of org and personal, org keys from the org plan', async () => {
    mockResolverTables(mock, {
      orgPlan: 'hub',
      roleProfile: 'learner',
      personalPlanKey: 'base',
      planLimits: { hub: ORG_LIMITS, base: PERSONAL_LIMITS },
    });

    const { limits } = await resolver.resolveEntitlements(memberCtx());

    // org hub 2000 vs personal base 100 → the org is the floor, max wins.
    expect(limits.max_flashcards).toBe(2000);
    // hub 200000 vs base 0 → the hub allowance survives.
    expect(limits.max_ai_tokens_per_day).toBe(200000);
    // Org-scope keys come from the org plan only.
    expect(limits.max_students).toBe(50);
    expect(limits.max_groups).toBe(20);
  });

  it('row 3: org member seated — user keys are max of org, seat and personal, org keys never see the seat', async () => {
    mockResolverTables(mock, {
      orgPlan: 'hub',
      roleProfile: 'learner',
      seatPlanKey: 'base',
      personalPlanKey: 'base',
      planLimits: { hub: ORG_LIMITS, base: { ...SEAT_LIMITS, ...PERSONAL_LIMITS } },
    });

    const { limits, sources } = await resolver.resolveEntitlements(memberCtx());

    // max(hub 2000, seat 100, personal 100) = 2000.
    expect(limits.max_flashcards).toBe(2000);
    // max(hub 200000, seat 0, personal 0) = 200000 — the seat's 0 never wins.
    expect(limits.max_ai_tokens_per_day).toBe(200000);
    // The seat carries -1 for org-scope keys; org capacity must stay the org
    // plan's 50/20, never the seat's "unlimited".
    expect(limits.max_students).toBe(50);
    expect(limits.max_groups).toBe(20);
    expect(sources.seat).toEqual({ planKey: 'base', origin: 'seat' });
  });

  it('row 4: org manager — the personal plan is excluded, user keys come from the org plan only', async () => {
    mockResolverTables(mock, {
      orgPlan: 'launch',
      roleProfile: 'all',
      personalPlanKey: 'campus', // unlimited mirrored org plan (#228)
      planLimits: {
        launch: { ...ORG_LIMITS, max_flashcards: 100, max_ai_tokens_per_day: 0 },
        campus: { max_flashcards: -1, max_ai_tokens_per_day: -1, max_students: -1 },
      },
    });

    const { limits } = await resolver.resolveEntitlements(
      memberCtx({ accountType: AccountType.MANAGER }),
    );

    // The manager's stale personal `campus` (-1) must not widen anything.
    expect(limits.max_flashcards).toBe(100);
    expect(limits.max_ai_tokens_per_day).toBe(0);
    expect(limits.max_students).toBe(50);
  });

  it('row 5: forged active_org_id with a stale seat row — personal for user keys, 0 for org keys, the seat is never read', async () => {
    mockResolverTables(mock, {
      member: false, // no org_members row for the cookie's org
      orgPlan: 'hub',
      roleProfile: 'all',
      seatPlanKey: 'base', // stale seat row in the foreign org
      personalPlanKey: 'base',
      planLimits: { hub: ORG_LIMITS, base: PERSONAL_LIMITS },
    });

    const { limits, sources } = await resolver.resolveEntitlements(memberCtx());

    // Membership is verified before anything else: the forged cookie lands in
    // the "no org" row even though a seat row exists.
    expect(limits.max_flashcards).toBe(100);
    expect(limits.max_students).toBe(0);
    expect(limits.max_groups).toBe(0);
    expect(sources.org).toBeNull();
    expect(sources.seat).toBeNull();
    expect(mock.from).toHaveBeenCalledWith('org_members');
    expect(mock.from).not.toHaveBeenCalledWith('org_seat_assignments');
  });

  it('row 6: a missing plan_limits row is 0 in every path', async () => {
    mockResolverTables(mock, {
      orgPlan: 'launch',
      roleProfile: 'learner',
      personalPlanKey: 'base',
      // `launch` defines only max_flashcards; every other key is missing.
      planLimits: { launch: { max_flashcards: 100 }, base: { max_decks: 10 } },
    });

    const { limits } = await resolver.resolveEntitlements(memberCtx());

    expect(limits.max_flashcards).toBe(100); // present row still resolves
    expect(limits.max_decks).toBe(10); // personal `base` defines it, the org row is missing → max(0, 10)
    expect(limits.max_questions).toBe(0); // missing in both org and personal
    expect(limits.max_groups).toBe(0); // missing org-scope row
    expect(limits.max_ai_tokens_per_day).toBe(0);
  });

  it('row 6b: outside an org a personal plan missing the row is 0, not unlimited', async () => {
    mockResolverTables(mock, { personalPlanKey: 'base', planLimits: { base: {} } });

    const { limits } = await resolver.resolveEntitlements(baseCtx);

    expect(limits.max_flashcards).toBe(0);
  });

  it('unlimited -1 short-circuits the max and wins over every finite layer', async () => {
    mockResolverTables(mock, {
      orgPlan: 'hub',
      roleProfile: 'learner',
      seatPlanKey: 'base',
      personalPlanKey: 'pro',
      planLimits: {
        hub: ORG_LIMITS,
        base: SEAT_LIMITS,
        pro: { ...PERSONAL_LIMITS, max_flashcards: -1, max_ai_tokens_per_day: -1 },
      },
    });

    const { limits } = await resolver.resolveEntitlements(memberCtx());

    expect(limits.max_flashcards).toBe(-1);
    expect(limits.max_ai_tokens_per_day).toBe(-1);
    // Org-scope keys are untouched by the -1 personal/seat rows.
    expect(limits.max_students).toBe(50);
  });

  it('phase-3 exit case: a base seat in a hub org keeps the hub allowance — ai.chat on with the hub limit, never 0', async () => {
    mockResolverTables(mock, {
      orgPlan: 'hub',
      roleProfile: 'learner',
      seatPlanKey: 'base',
      personalPlanKey: null,
      planEntitlements: {
        hub: ['flashcards', 'quiz', 'ai.chat', 'quiz.builder', 'advanced.stats', 'branding'],
        base: ['flashcards', 'quiz'],
      },
      planLimits: { hub: ORG_LIMITS, base: SEAT_LIMITS },
    });

    const { entitlements, limits } = await resolver.resolveEntitlements(memberCtx());

    // The seat's max_ai_tokens_per_day = 0 must not zero the hub allowance:
    // max(hub 200000, seat 0) = 200000, so ai.chat stays effective.
    expect(limits.max_ai_tokens_per_day).toBe(200000);
    expect(entitlements).toContain('ai.chat');
  });

  it('a seat plan can raise a user-scope limit above org and personal', async () => {
    mockResolverTables(mock, {
      orgPlan: 'launch',
      roleProfile: 'learner',
      seatPlanKey: 'ace',
      personalPlanKey: 'base',
      planLimits: {
        launch: { ...ORG_LIMITS, max_flashcards: 100, max_ai_tokens_per_day: 0 },
        ace: { ...SEAT_LIMITS, max_flashcards: 2000, max_ai_tokens_per_day: 200000 },
        base: PERSONAL_LIMITS,
      },
    });

    const { limits } = await resolver.resolveEntitlements(memberCtx());

    // max(launch 100, ace 2000, base 100) = 2000 — the seat is a layer, not a ceiling.
    expect(limits.max_flashcards).toBe(2000);
    expect(limits.max_ai_tokens_per_day).toBe(200000);
  });

  it('a personal plan raises but never lowers a user-scope limit inside an org', async () => {
    mockResolverTables(mock, {
      orgPlan: 'launch',
      roleProfile: 'learner',
      personalPlanKey: 'pro',
      planEntitlements: { launch: ['flashcards', 'quiz'], pro: ['flashcards', 'quiz', 'ai.chat'] },
      planLimits: {
        launch: { ...ORG_LIMITS, max_flashcards: 100, max_ai_tokens_per_day: 0 },
        pro: { ...PERSONAL_LIMITS, max_flashcards: -1, max_ai_tokens_per_day: -1 },
      },
    });

    const { limits } = await resolver.resolveEntitlements(memberCtx());

    expect(limits.max_flashcards).toBe(-1); // pro raises the launch floor of 100
    expect(limits.max_ai_tokens_per_day).toBe(-1);
  });

  it('one resolution issues exactly seven queries — one per table, no per-limit fan-out', async () => {
    mockResolverTables(mock, {
      orgPlan: 'hub',
      roleProfile: 'learner',
      seatPlanKey: 'base',
      personalPlanKey: 'pro',
      planLimits: { hub: ORG_LIMITS, base: SEAT_LIMITS, pro: PERSONAL_LIMITS },
    });

    await resolver.resolveEntitlements(memberCtx());

    const tables = vi.mocked(mock.from).mock.calls.map((call) => String(call[0]));
    expect(tables).toHaveLength(7);
    expect(new Set(tables)).toEqual(
      new Set([
        'org_members',
        'org_seat_assignments',
        'profiles',
        'plan_entitlements',
        'plan_limits',
        'user_feature_overrides',
        'entitlement_flags',
      ]),
    );
    // Three layer plans, still one batched catalog read each.
    expect(tables.filter((t) => t === 'plan_limits')).toHaveLength(1);
    expect(tables.filter((t) => t === 'plan_entitlements')).toHaveLength(1);
  });

  it('outside an org one resolution issues five queries (no org-layer reads at all)', async () => {
    mockResolverTables(mock, { personalPlanKey: 'base', planLimits: { base: PERSONAL_LIMITS } });

    await resolver.resolveEntitlements(baseCtx);

    const tables = vi.mocked(mock.from).mock.calls.map((call) => String(call[0]));
    expect(tables).toHaveLength(5);
    expect(tables).not.toContain('org_members');
    expect(tables).not.toContain('org_seat_assignments');
  });

  it('flags still apply on top of the composed limits (a kill-switched surface key is off)', async () => {
    const flags: FlagRow[] = allFlagsOn().map((f) =>
      f.key === 'ai.chat' ? { ...f, is_enabled: false } : f,
    );
    mockResolverTables(mock, {
      personalPlanKey: 'ace',
      planEntitlements: { ace: ['flashcards', 'quiz', 'ai.chat', 'advanced.stats'] },
      planLimits: { ace: { ...PERSONAL_LIMITS, max_ai_tokens_per_day: 200000 } },
      flags,
    });

    const { entitlements, limits } = await resolver.resolveEntitlements(baseCtx);

    expect(limits.max_ai_tokens_per_day).toBe(200000);
    expect(entitlements).not.toContain('ai.chat');
  });
});
