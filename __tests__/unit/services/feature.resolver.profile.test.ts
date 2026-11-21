import { AccountType, type EntitlementKey, type RequestContext } from '@studiq/authz';
import { FeatureResolver } from '@studiq/server/services/feature.resolver';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

// The phase-2a-1 resolver contract (ADR-0015 §5.3/§6.1, D18/D19), after 2b-7
// removed the four legacy management markers from the catalog:
//
//   profile (all | learner | none) ∩ plan ceiling
//     → legacy rows (is_enabled=false revokes only — enabled rows add nothing)
//     → seat plan (additive)
//
// Expected arrays are literals, deliberately: deriving them from `ENTITLEMENTS`
// or `LEARNER_ENTITLEMENTS` would make the assertions restate the production
// constant instead of pinning the resolved outcome.

function chain(result: unknown) {
  const resolved = { data: result, error: null };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.single = terminal;
  c.maybeSingle = terminal;
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.then = (onfulfilled: (value: unknown) => unknown) =>
    Promise.resolve(resolved).then(onfulfilled);
  return c;
}

type EntitlementRows = Record<string, readonly string[]>;

const PLANS: EntitlementRows = {
  // A `hub` organization: the whole remaining catalog.
  hub: ['flashcards', 'quiz', 'ai.chat', 'quiz.builder', 'advanced.stats', 'branding'],
  launch: ['flashcards', 'quiz'],
  // Seat plans carry seat-eligible (personal-scope) surface keys only.
  seat: ['ai.chat', 'advanced.stats'],
};

type Scenario = {
  name: string;
  /** Defaults to `org-1`; `null` is the "no verified membership" case. */
  activeOrgId?: string | null;
  orgRoleId: string | null;
  profile: string | null;
  rows: Array<{ feature_key: string; is_enabled?: boolean }>;
  plan: keyof typeof PLANS;
  seatPlanKey?: string;
  expected: EntitlementKey[];
};

const CASES: Scenario[] = [
  {
    name: 'admin/all on hub: the whole plan ceiling',
    orgRoleId: 'role-admin',
    profile: 'all',
    rows: [],
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'quiz.builder', 'advanced.stats', 'branding'],
  },
  {
    name: 'admin/all on launch: the launch ceiling, and an enabled role row adds nothing',
    orgRoleId: 'role-admin',
    profile: 'all',
    rows: [
      { feature_key: 'flashcards', is_enabled: true },
      // Not in the launch ceiling: the profile is authoritative, so this row
      // must not grant it.
      { feature_key: 'ai.chat', is_enabled: true },
    ],
    plan: 'launch',
    expected: ['flashcards', 'quiz'],
  },
  {
    name: 'teacher/all on hub: the ceiling, identical to admin',
    orgRoleId: 'role-teacher',
    profile: 'all',
    rows: [],
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'quiz.builder', 'advanced.stats', 'branding'],
  },
  {
    name: 'member/learner on hub: exactly the learner set',
    orgRoleId: 'role-member',
    profile: 'learner',
    rows: [
      { feature_key: 'flashcards', is_enabled: true },
      { feature_key: 'ai.chat', is_enabled: true },
    ],
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'branding'],
  },
  {
    name: 'member/learner on launch: learner set intersected with the plan',
    orgRoleId: 'role-member',
    profile: 'learner',
    rows: [{ feature_key: 'flashcards', is_enabled: true }],
    plan: 'launch',
    expected: ['flashcards', 'quiz'],
  },
  {
    name: 'custom role/none with zero rows on hub: nothing',
    orgRoleId: 'role-custom',
    profile: 'none',
    rows: [],
    plan: 'hub',
    expected: [],
  },
  {
    name: 'no verified role, orgRoleId null: nothing, even on hub',
    activeOrgId: 'org-1',
    orgRoleId: null,
    // A profile the resolver must never reach: the guard, not a `none` answer,
    // is what makes the missing role fail closed.
    profile: 'all',
    rows: [],
    plan: 'hub',
    expected: [],
  },
  {
    name: 'custom role/all with zero rows on hub: the ceiling',
    orgRoleId: 'role-custom',
    profile: 'all',
    rows: [],
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'quiz.builder', 'advanced.stats', 'branding'],
  },
  {
    name: 'seated learner on launch: the seat plan adds seat-only keys on top of the learner set',
    orgRoleId: 'role-member',
    profile: 'learner',
    rows: [],
    plan: 'launch',
    seatPlanKey: 'seat',
    expected: ['ai.chat', 'flashcards', 'quiz', 'advanced.stats'],
  },
];

function buildClient(scenario: Scenario) {
  const mock = mockSupabaseClient();

  mock.from.mockImplementation((table: string) => {
    if (table === 'org_roles') return chain({ entitlement_profile: scenario.profile });
    if (table === 'org_role_features') return chain(scenario.rows);
    if (table === 'organizations') return chain({ plan: scenario.plan });
    if (table === 'plan_entitlements') {
      const c = chain([]);
      c.eq = vi.fn((_column: string, planKey: string) =>
        chain((PLANS[planKey] ?? []).map((key) => ({ entitlement_key: key }))),
      );
      return c;
    }
    if (table === 'org_seat_assignments') {
      return chain(scenario.seatPlanKey ? { pool_id: 'pool-1' } : null);
    }
    if (table === 'org_seat_pools') return chain({ plan_key: scenario.seatPlanKey ?? null });
    if (table === 'profiles') return chain(null);
    if (table === 'user_feature_overrides') return chain([]);
    if (table === 'entitlement_flags') return chain([]);
    return chain(null);
  });

  return mock;
}

function ctxFor(scenario: Scenario): RequestContext {
  return {
    userId: 'user-1',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: scenario.activeOrgId === undefined ? 'org-1' : scenario.activeOrgId,
    orgRoleId: scenario.orgRoleId,
    groupIds: [],
    permissionScopes: {},
  };
}

describe('FeatureResolver org entitlement profile (D18/D19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A loop rather than `it.each`: vitest truncates long `$name` titles, and an
  // exact title is what the mutation gate runs by name.
  for (const scenario of CASES) {
    it(scenario.name, async () => {
      const mock = buildClient(scenario);
      const resolver = new FeatureResolver(() => Promise.resolve(mock));

      const features = await resolver.getEnabledFeatures(ctxFor(scenario));

      expect(features).toEqual(scenario.expected);
    });
  }

  it('does not read the plan for a none profile', async () => {
    const scenario = CASES.find((c) => c.name.startsWith('custom role/none'))!;
    const mock = buildClient(scenario);
    const resolver = new FeatureResolver(() => Promise.resolve(mock));

    await resolver.getEnabledFeatures(ctxFor(scenario));

    expect(mock.from).not.toHaveBeenCalledWith('organizations');
    expect(mock.from).not.toHaveBeenCalledWith('plan_entitlements');
  });

  it('does not read the role or the plan when there is no verified role', async () => {
    const scenario = CASES.find((c) => c.name.startsWith('no verified role'))!;
    const mock = buildClient(scenario);
    const resolver = new FeatureResolver(() => Promise.resolve(mock));

    await resolver.getEnabledFeatures(ctxFor(scenario));

    expect(mock.from).not.toHaveBeenCalledWith('org_roles');
    expect(mock.from).not.toHaveBeenCalledWith('org_role_features');
    expect(mock.from).not.toHaveBeenCalledWith('organizations');
  });

  it('treats an unknown profile value as none, fail-closed', async () => {
    const scenario: Scenario = {
      name: 'unknown profile',
      orgRoleId: 'role-custom',
      profile: 'teacher',
      rows: [],
      plan: 'hub',
      expected: [],
    };
    const mock = buildClient(scenario);
    const resolver = new FeatureResolver(() => Promise.resolve(mock));

    const features = await resolver.getEnabledFeatures(ctxFor(scenario));

    expect(features).toEqual([]);
  });
});
