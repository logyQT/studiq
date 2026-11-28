import { AccountType, type EntitlementKey, type RequestContext } from '@studiq/authz';
import { EntitlementResolver } from '@studiq/server/services/entitlement.resolver';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockResolverTables } from '#test/helpers/entitlement-resolver-mock';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

// The resolver contract (ADR-0015 §5.3/§6.1, D18/D19), after 2b-7 removed the
// four legacy management markers from the catalog and phase 7 dropped the
// revoke store:
//
//   verified membership → profile (all | learner | none) ∩ plan ceiling
//     → seat plan (its own keys, D38)
//     → personal plan (personalPortable whitelist inside an org)
//     → overrides → flags (fail closed) → quota-0 exclusion
//
// Expected arrays are literals, deliberately: deriving them from `ENTITLEMENTS`
// or `LEARNER_ENTITLEMENTS` would make the assertions restate the production
// constant instead of pinning the resolved outcome.

type EntitlementRows = Record<string, readonly string[]>;

const PLANS: EntitlementRows = {
  // A `hub` organization: the whole remaining catalog.
  hub: ['flashcards', 'quiz', 'ai.chat', 'quiz.templates', 'stats.insights', 'branding'],
  launch: ['flashcards', 'quiz'],
  // Seat plans carry seat-eligible (personal-scope) surface keys only.
  seat: ['ai.chat', 'stats.insights'],
  seatHub: ['ai.chat', 'quiz.templates', 'branding'],
};

type Scenario = {
  name: string;
  /** Defaults to `org-1`; `null` is the "no org cookie" case. */
  activeOrgId?: string | null;
  /** Defaults to a real membership row; `false` is the forged-cookie case. */
  member?: boolean;
  orgRoleId: string | null;
  profile: string | null;
  plan: keyof typeof PLANS;
  seatPlanKey?: string;
  expected: EntitlementKey[];
};

const CASES: Scenario[] = [
  {
    name: 'admin/all on hub: the whole plan ceiling',
    orgRoleId: 'role-admin',
    profile: 'all',
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights', 'branding'],
  },
  {
    name: 'admin/all on launch: the launch ceiling',
    orgRoleId: 'role-admin',
    profile: 'all',
    plan: 'launch',
    expected: ['flashcards', 'quiz'],
  },
  {
    name: 'teacher/all on hub: the ceiling, identical to admin',
    orgRoleId: 'role-teacher',
    profile: 'all',
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights', 'branding'],
  },
  {
    name: 'member/learner on hub: exactly the learner set',
    orgRoleId: 'role-member',
    profile: 'learner',
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'branding'],
  },
  {
    name: 'member/learner on launch: learner set intersected with the plan',
    orgRoleId: 'role-member',
    profile: 'learner',
    plan: 'launch',
    expected: ['flashcards', 'quiz'],
  },
  {
    name: 'custom role/none on hub: nothing (no seat)',
    orgRoleId: 'role-custom',
    profile: 'none',
    plan: 'hub',
    expected: [],
  },
  {
    name: 'custom role/none with a seat on hub: the seat ∩ ceiling only',
    orgRoleId: 'role-custom',
    profile: 'none',
    plan: 'hub',
    seatPlanKey: 'seatHub',
    expected: ['ai.chat', 'quiz.templates', 'branding'],
  },
  {
    name: 'no verified role, orgRoleId null: nothing, even on hub',
    activeOrgId: 'org-1',
    orgRoleId: null,
    // A profile the resolver must never reach: the guard, not a `none` answer,
    // is what makes the missing role fail closed.
    profile: 'all',
    plan: 'hub',
    expected: [],
  },
  {
    name: 'forged active_org_id, no membership row: no org layer, nothing',
    activeOrgId: 'org-1',
    member: false,
    orgRoleId: 'role-admin',
    profile: 'all',
    plan: 'hub',
    expected: [],
  },
  {
    name: 'custom role/all on hub: the ceiling',
    orgRoleId: 'role-custom',
    profile: 'all',
    plan: 'hub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights', 'branding'],
  },
  {
    name: 'seated learner on launch: the seat grants its own keys (D38)',
    orgRoleId: 'role-member',
    profile: 'learner',
    plan: 'launch',
    seatPlanKey: 'seat',
    expected: ['ai.chat', 'flashcards', 'quiz', 'stats.insights'],
  },
  {
    name: 'seated learner on hub: the seat adds its own keys beyond the learner set',
    orgRoleId: 'role-member',
    profile: 'learner',
    plan: 'hub',
    seatPlanKey: 'seatHub',
    expected: ['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'branding'],
  },
];

function buildClient(scenario: Scenario) {
  const mock = mockSupabaseClient();

  mockResolverTables(mock, {
    member: scenario.member,
    orgPlan: scenario.plan,
    roleProfile: scenario.profile,
    seatPlanKey: scenario.seatPlanKey,
    personalPlanKey: null,
    planEntitlements: PLANS,
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

describe('EntitlementResolver org entitlement profile (D18/D19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A loop rather than `it.each`: vitest truncates long `$name` titles, and an
  // exact title is what the mutation gate runs by name.
  for (const scenario of CASES) {
    it(scenario.name, async () => {
      const mock = buildClient(scenario);
      const resolver = new EntitlementResolver(() => Promise.resolve(mock));

      const { entitlements } = await resolver.resolveEntitlements(ctxFor(scenario));

      expect(entitlements).toEqual(scenario.expected);
    });
  }

  it('does not read the role or the plan when there is no verified role', async () => {
    const scenario = CASES.find((c) => c.name.startsWith('no verified role'))!;
    const mock = buildClient(scenario);
    const resolver = new EntitlementResolver(() => Promise.resolve(mock));

    await resolver.resolveEntitlements(ctxFor(scenario));

    expect(mock.from).not.toHaveBeenCalledWith('org_roles');
    expect(mock.from).not.toHaveBeenCalledWith('organizations');
  });

  it('does not read the org tables when the membership row is missing (forged cookie)', async () => {
    const scenario = CASES.find((c) => c.name.startsWith('forged active_org_id'))!;
    const mock = buildClient(scenario);
    const resolver = new EntitlementResolver(() => Promise.resolve(mock));

    await resolver.resolveEntitlements(ctxFor(scenario));

    expect(mock.from).not.toHaveBeenCalledWith('org_roles');
    expect(mock.from).not.toHaveBeenCalledWith('organizations');
    expect(mock.from).not.toHaveBeenCalledWith('org_seat_assignments');
  });

  it('treats an unknown profile value as none, fail-closed', async () => {
    const scenario: Scenario = {
      name: 'unknown profile',
      orgRoleId: 'role-custom',
      profile: 'teacher',
      plan: 'hub',
      expected: [],
    };
    const mock = buildClient(scenario);
    const resolver = new EntitlementResolver(() => Promise.resolve(mock));

    const { entitlements } = await resolver.resolveEntitlements(ctxFor(scenario));

    expect(entitlements).toEqual([]);
  });
});
