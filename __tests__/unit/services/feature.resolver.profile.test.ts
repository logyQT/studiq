import { AccountType, type EntitlementKey, type RequestContext } from '@studiq/authz';
import { FeatureResolver } from '@studiq/server/services/feature.resolver';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

// The phase-2a-1 resolver contract (ADR-0015 §5.3/§6.1, D18/D19):
//
//   profile (all | learner | none) ∩ plan ceiling
//     → legacy rows (markers grant, is_enabled=false revokes)
//     → seat plan (additive) → admin-only strip for a seated non-admin.
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
  // A `hub` organization: all six surfaced keys plus the three plan-shaped
  // markers (`org.manage` arrives through a launch→hub upgrade, not the plan).
  hub: [
    'flashcards',
    'quiz',
    'ai.chat',
    'quiz.builder',
    'group.manage',
    'member.manage',
    'role.builder',
    'advanced.stats',
    'branding',
  ],
  launch: ['flashcards', 'quiz', 'group.manage', 'member.manage', 'org.manage'],
  // Seat plans carry surface keys plus the management markers the resolver
  // must strip from a non-admin.
  seat: [
    'ai.chat',
    'advanced.stats',
    'group.manage',
    'member.manage',
    'role.builder',
    'org.manage',
  ],
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
    name: 'admin/all on hub: surface ceiling plus the rows management markers',
    orgRoleId: 'role-admin',
    profile: 'all',
    rows: [
      { feature_key: 'group.manage', is_enabled: true },
      { feature_key: 'member.manage', is_enabled: true },
      { feature_key: 'org.manage', is_enabled: true },
      { feature_key: 'role.builder', is_enabled: true },
    ],
    plan: 'hub',
    expected: [
      'ai.chat',
      'flashcards',
      'quiz',
      'quiz.builder',
      'org.manage',
      'group.manage',
      'member.manage',
      'role.builder',
      'advanced.stats',
      'branding',
    ],
  },
  {
    name: 'admin/all on launch: plan ceiling plus the rows markers, and an enabled non-marker row adds nothing',
    orgRoleId: 'role-admin',
    profile: 'all',
    rows: [
      { feature_key: 'flashcards', is_enabled: true },
      { feature_key: 'quiz', is_enabled: true },
      { feature_key: 'group.manage', is_enabled: true },
      { feature_key: 'member.manage', is_enabled: true },
      { feature_key: 'org.manage', is_enabled: true },
      // Not in the launch ceiling, and a non-marker: the profile is
      // authoritative for it, so this row must not grant it.
      { feature_key: 'ai.chat', is_enabled: true },
    ],
    plan: 'launch',
    expected: ['flashcards', 'quiz', 'org.manage', 'group.manage', 'member.manage'],
  },
  {
    name: 'teacher/all on hub: admin minus member.manage and role.builder, the D6/FP-04 line',
    orgRoleId: 'role-teacher',
    profile: 'all',
    rows: [
      { feature_key: 'org.manage', is_enabled: true },
      { feature_key: 'group.manage', is_enabled: true },
    ],
    plan: 'hub',
    expected: [
      'ai.chat',
      'flashcards',
      'quiz',
      'quiz.builder',
      'org.manage',
      'group.manage',
      'advanced.stats',
      'branding',
    ],
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
    name: 'custom role/all with zero rows on hub: ceiling surface keys, no markers',
    orgRoleId: 'role-custom',
    profile: 'all',
    rows: [],
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'quiz.builder', 'advanced.stats', 'branding'],
  },
  {
    name: 'seated non-admin: keeps a seat-only key, loses the three admin-only markers',
    orgRoleId: 'role-member',
    profile: 'learner',
    rows: [],
    plan: 'hub',
    seatPlanKey: 'seat',
    expected: ['ai.chat', 'flashcards', 'quiz', 'group.manage', 'advanced.stats', 'branding'],
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
