import {
  AccountType,
  ENTITLEMENT_KEYS,
  type LimitKey,
  type RequestContext,
  type ResolvedEntitlements,
} from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { requireFeature } from '@studiq/server/lib/features';
import {
  EntitlementResolver,
  entitlementResolver,
  type EntitlementLimitsSource,
  isUserOverrideActive,
} from '@studiq/server/services/entitlement.resolver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function chain(result: unknown) {
  const resolved = { data: result, error: null };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.filter = vi.fn(() => c);
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

type FlagRow = { key: string; is_enabled: boolean };

function allFlagsOn(keys: readonly string[] = ENTITLEMENT_KEYS): FlagRow[] {
  return keys.map((key) => ({ key, is_enabled: true }));
}

/** Plan → entitlement keys, served by an `eq`-aware `plan_entitlements` mock. */
const PLANS: Record<string, readonly string[]> = {
  base: ['flashcards', 'quiz'],
  ace: ['flashcards', 'quiz', 'ai.chat', 'advanced.stats'],
  pro: ['flashcards', 'quiz', 'ai.chat', 'advanced.stats'],
  hub: ['flashcards', 'quiz', 'ai.chat', 'quiz.builder', 'advanced.stats', 'branding'],
  launch: ['flashcards', 'quiz'],
  campus: ['flashcards', 'quiz', 'ai.chat', 'advanced.stats'],
  seat: ['ai.chat', 'advanced.stats', 'quiz.builder'],
};

/** Unlimited by default so the quota-0 filter passes; override per test. */
function limitsWith(values: Partial<Record<LimitKey, number>> = {}): EntitlementLimitsSource {
  return {
    getEffectiveLimit: (_ctx: RequestContext, key: LimitKey) => Promise.resolve(values[key] ?? -1),
  };
}

/** A `plan_entitlements` chain whose `eq('plan_key', …)` picks the plan's rows. */
function planChain() {
  const c = chain([]);
  c.eq = vi.fn((_column: string, planKey: string) =>
    chain((PLANS[planKey] ?? []).map((key) => ({ entitlement_key: key }))),
  );
  return c;
}

describe('EntitlementResolver', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    resolver = new EntitlementResolver(() => Promise.resolve(mock), limitsWith());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Standard table mock: a verified member of `org-1` unless `member: false`. */
  function mockTables(opts: {
    member?: boolean;
    roleProfile?: string | null;
    roleRows?: Array<{ feature_key: string; is_enabled?: boolean }>;
    orgPlan?: string | null;
    seatPlanKey?: string | null;
    personalPlanKey?: string | null;
    overrides?: Array<{ feature_key: string; is_enabled: boolean; expires_at?: string | null }>;
    flags?: FlagRow[];
  }) {
    mock.from.mockImplementation((table: string) => {
      if (table === 'org_members') {
        return chain(opts.member === false ? null : { organization_id: 'org-1' });
      }
      if (table === 'org_roles') return chain({ entitlement_profile: opts.roleProfile ?? 'none' });
      if (table === 'org_role_features') return chain(opts.roleRows ?? []);
      if (table === 'organizations') return chain({ plan: opts.orgPlan ?? null });
      if (table === 'plan_entitlements') return planChain();
      if (table === 'org_seat_assignments') {
        return chain(opts.seatPlanKey ? { pool_id: 'pool-1' } : null);
      }
      if (table === 'org_seat_pools') return chain({ plan_key: opts.seatPlanKey ?? null });
      if (table === 'profiles') return chain({ personal_plan_key: opts.personalPlanKey ?? null });
      if (table === 'user_feature_overrides') return chain(opts.overrides ?? []);
      if (table === 'entitlement_flags') return chain(opts.flags ?? allFlagsOn());
      return chain(null);
    });
  }

  describe('precedence chain', () => {
    it('grants the profile ceiling on the org plan (all profile)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      mockTables({ roleProfile: 'all', orgPlan: 'hub' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual([
        'ai.chat',
        'flashcards',
        'quiz',
        'quiz.builder',
        'advanced.stats',
        'branding',
      ]);
    });

    it('intersects the seat plan with the org ceiling (seat adds only ceiling keys)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };
      mockTables({
        roleProfile: 'all',
        orgPlan: 'launch',
        seatPlanKey: 'seat',
        // `seat` carries ai.chat/advanced.stats/quiz.builder; the launch
        // ceiling only carries flashcards/quiz, so the seat adds nothing.
        personalPlanKey: null,
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual(['flashcards', 'quiz']);
      expect(sources.seat).toEqual({ planKey: 'seat', origin: 'seat' });
    });

    it('adds seat keys that are in the ceiling on top of a learner profile', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      mockTables({ roleProfile: 'learner', orgPlan: 'hub', seatPlanKey: 'seat' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      // learner ∩ hub = ai.chat, flashcards, quiz, branding; the seat plan
      // (ai.chat, advanced.stats, quiz.builder) is intersected with the hub
      // ceiling and adds advanced.stats + quiz.builder.
      expect(entitlements).toEqual([
        'ai.chat',
        'flashcards',
        'quiz',
        'quiz.builder',
        'advanced.stats',
        'branding',
      ]);
    });

    it('ignores non-catalog keys in plan rows', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      mock.from.mockImplementation((table: string) => {
        if (table === 'org_members') return chain({ organization_id: 'org-1' });
        if (table === 'org_roles') return chain({ entitlement_profile: 'all' });
        if (table === 'org_role_features') return chain([]);
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_entitlements') {
          return chain(
            ['flashcards', 'quiz', 'org.manage', 'member.manage', 'role.builder'].map((f) => ({
              entitlement_key: f,
            })),
          );
        }
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'profiles') return chain(null);
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual(['flashcards', 'quiz']);
    });

    it('lets the profile grant the ceiling and role rows only revoke (D19)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };
      mockTables({
        roleProfile: 'all',
        orgPlan: 'launch',
        roleRows: [
          // An enabled row adds nothing since the markers left the catalog
          // (2b-7): `ai.chat` is not in the launch ceiling, so a row that
          // granted it would show up below. The revoked row must win over the
          // profile grant.
          { feature_key: 'ai.chat', is_enabled: true },
          { feature_key: 'quiz', is_enabled: false },
        ],
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual(['flashcards']);
      expect(sources.revokedRoleRows).toEqual(['quiz']);
    });

    it('does not add non-portable personal keys inside an org (whitelist, D3)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };
      mockTables({ roleProfile: 'none', orgPlan: 'launch', personalPlanKey: 'base' });

      const { entitlements, sources } = await resolver.resolveEntitlements(ctx);
      // `base` carries only flashcards/quiz, both `personalPortable: false`:
      // inside an org the personal layer adds nothing.
      expect(entitlements).toEqual([]);
      expect(sources.personal).toEqual({ planKey: 'base', origin: 'personal' });
    });

    it('adds portable personal keys on top of the org entitlement (paid PRO in a free org)', async () => {
      // A `member` role on `launch` gets `flashcards`/`quiz`; a personal `pro`
      // must still grant `ai.chat` (personalPortable).
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      mockTables({ roleProfile: 'learner', orgPlan: 'launch', personalPlanKey: 'pro' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz', 'advanced.stats']);
    });

    it('does not let a personal plan grant an org-scoped key inside an org', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      // `branding` is org-scoped and not portable: a personal plan carrying it
      // must not hand it to a member inside an org (the EDU-02 regression
      // shape). The portable keys of the same plan (ai.chat, quiz.builder,
      // advanced.stats) do carry over.
      mockTables({ roleProfile: 'learner', orgPlan: 'launch', personalPlanKey: 'hub' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual([
        'ai.chat',
        'flashcards',
        'quiz',
        'quiz.builder',
        'advanced.stats',
      ]);
      expect(entitlements).not.toContain('branding');
    });

    it('keeps an org-scoped key the org layer itself grants', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };
      mockTables({ roleProfile: 'all', orgPlan: 'hub', personalPlanKey: 'base' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toContain('branding');
    });

    it('ignores a manager mirrored personal plan inside an org (#228)', async () => {
      const ctx = {
        ...baseCtx,
        accountType: AccountType.MANAGER,
        activeOrgId: 'org-1',
        orgRoleId: 'role-member',
      };
      mockTables({ roleProfile: 'learner', orgPlan: 'hub', personalPlanKey: 'campus' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      // learner ∩ hub, and the mirrored manager plan adds nothing.
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz', 'branding']);
    });

    it('treats a non-member active_org_id as no org context (verified membership)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      mockTables({ member: false, roleProfile: 'all', orgPlan: 'hub', personalPlanKey: null });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual([]);
      expect(mock.from).not.toHaveBeenCalledWith('org_roles');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('returns personal plan features when not in org context', async () => {
      mockTables({ personalPlanKey: 'ace' });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz', 'advanced.stats']);
      // No active org → the org layer (and the membership read) is skipped.
      expect(mock.from).not.toHaveBeenCalledWith('org_members');
      expect(mock.from).not.toHaveBeenCalledWith('org_roles');
    });

    it('applies the whole personal plan outside an org, including org-scoped keys', async () => {
      mockTables({ personalPlanKey: 'hub' });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual([
        'ai.chat',
        'flashcards',
        'quiz',
        'quiz.builder',
        'advanced.stats',
        'branding',
      ]);
    });

    it('resolves nothing when the org role is missing (no role = ∅)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: null };
      mockTables({ roleProfile: 'all', orgPlan: 'hub', personalPlanKey: null });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual([]);
      expect(mock.from).not.toHaveBeenCalledWith('org_roles');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('lets an explicit revoke row beat the profile ceiling', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };
      mockTables({
        roleProfile: 'all',
        orgPlan: 'launch',
        roleRows: [{ feature_key: 'quiz', is_enabled: false }],
      });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual(['flashcards']);
    });

    it('applies user_feature_overrides as the strongest plan layer', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };
      mockTables({
        roleProfile: 'all',
        orgPlan: 'hub',
        overrides: [
          { feature_key: 'branding', is_enabled: false },
          { feature_key: 'ai.chat', is_enabled: true },
        ],
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(ctx);
      // the profile granted branding, the override removes it
      expect(entitlements).toEqual([
        'ai.chat',
        'flashcards',
        'quiz',
        'quiz.builder',
        'advanced.stats',
      ]);
      expect(sources.overrides).toEqual(['ai.chat']);
      expect(sources.revokedOverrides).toEqual(['branding']);
    });

    it('ignores an expired user override grant (#382)', async () => {
      mockTables({
        personalPlanKey: 'base',
        overrides: [
          {
            feature_key: 'ai.chat',
            is_enabled: true,
            expires_at: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['flashcards', 'quiz']);
    });

    it('ignores an expired user override revoke (#382)', async () => {
      mockTables({
        personalPlanKey: 'base',
        overrides: [
          {
            feature_key: 'quiz',
            is_enabled: false,
            expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['flashcards', 'quiz']);
    });

    it('applies a user override whose expiry is still in the future', async () => {
      mockTables({
        personalPlanKey: 'base',
        overrides: [
          {
            feature_key: 'ai.chat',
            is_enabled: true,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            feature_key: 'quiz',
            is_enabled: false,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          },
        ],
      });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['ai.chat', 'flashcards']);
    });

    it('selects expires_at so expiry can be evaluated', async () => {
      let selected: string | null = null;
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_entitlements') return planChain();
        if (table === 'user_feature_overrides') {
          const overrides = chain([]);
          // Record the projection the resolver asks for, then answer with the empty list.
          return Object.assign(overrides, {
            select: vi.fn((columns: string) => {
              selected = columns;
              return overrides;
            }),
          });
        }
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      await resolver.resolveEntitlements(baseCtx);
      expect(selected).toContain('expires_at');
    });

    it('returns empty when no entitlement source yields features', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_entitlements') return chain([]);
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual([]);
    });
  });

  describe('flag gate (kill switch only, fails closed)', () => {
    it('removes a surface key whose flag is disabled', async () => {
      mockTables({
        personalPlanKey: 'ace',
        flags: [
          { key: 'flashcards', is_enabled: true },
          { key: 'quiz', is_enabled: true },
          { key: 'ai.chat', is_enabled: false },
          { key: 'advanced.stats', is_enabled: true },
        ],
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['flashcards', 'quiz', 'advanced.stats']);
      expect(sources.flagsOff).toEqual(['ai.chat']);
    });

    it('removes a surface key whose flag row is missing (fail closed, D8)', async () => {
      mockTables({
        personalPlanKey: 'ace',
        // Only `ai.chat` has a row; `advanced.stats` is missing → removed.
        flags: [{ key: 'ai.chat', is_enabled: true }],
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz']);
      expect(sources.flagsOff).toEqual(['advanced.stats']);
    });

    it('never gates baseline keys, even without a flag row (D9)', async () => {
      mockTables({ personalPlanKey: 'base', flags: [] });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['flashcards', 'quiz']);
    });

    it('lets an active override beat a kill switch on its key (D26)', async () => {
      mockTables({
        personalPlanKey: 'base',
        overrides: [{ feature_key: 'ai.chat', is_enabled: true }],
        flags: [
          { key: 'flashcards', is_enabled: true },
          { key: 'quiz', is_enabled: true },
          // The kill switch is OFF, but the active override owns the key.
          { key: 'ai.chat', is_enabled: false },
        ],
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toContain('ai.chat');
      // The flag pass skipped the override-owned key entirely.
      expect(sources.flagsOff).toEqual([]);
    });

    it('an override revoke stays revoked even when the flag is on (D26, both directions)', async () => {
      mockTables({
        personalPlanKey: 'ace',
        overrides: [{ feature_key: 'ai.chat', is_enabled: false }],
        // All surface flags on, including ai.chat: the active override revoke
        // is the final word on the key.
        flags: allFlagsOn(),
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).not.toContain('ai.chat');
      expect(sources.revokedOverrides).toEqual(['ai.chat']);
      expect(sources.flagsOff).toEqual([]);
    });
  });

  describe('quota-0 exclusion (§6.1)', () => {
    it('excludes an entitlement whose quota limit resolves to 0', async () => {
      resolver = new EntitlementResolver(
        () => Promise.resolve(mock),
        limitsWith({ max_ai_tokens_per_day: 0 }),
      );
      mockTables({ personalPlanKey: 'ace' });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      // `ai.chat` is granted by the plan but its quota is 0 → not effective.
      expect(entitlements).toEqual(['flashcards', 'quiz', 'advanced.stats']);
    });

    it('keeps the entitlement when its quota is unlimited (-1)', async () => {
      resolver = new EntitlementResolver(
        () => Promise.resolve(mock),
        limitsWith({ max_ai_tokens_per_day: -1 }),
      );
      mockTables({ personalPlanKey: 'ace' });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toContain('ai.chat');
    });

    it('requireFeature: resolves an effective key, rejects FORBIDDEN outside the resolved set and for a quota-0 key', async () => {
      // `ai.chat` is absent from the fixture because its quota resolved to 0:
      // a quota-0 key never reaches the resolved set (§6.1), so requireFeature
      // must reject it exactly like any other non-effective key.
      const fixture: ResolvedEntitlements = {
        entitlements: ['flashcards', 'quiz', 'advanced.stats'],
        limits: {},
        sources: {
          org: null,
          seat: null,
          personal: { planKey: 'ace', origin: 'personal' },
          overrides: [],
          revokedOverrides: [],
          revokedRoleRows: [],
          flagsOff: [],
        },
        plan: { primary: 'ace', sources: [{ planKey: 'ace', origin: 'personal' }] },
      };
      const spy = vi.spyOn(entitlementResolver, 'resolveEntitlements').mockResolvedValue(fixture);

      await expect(requireFeature(baseCtx, 'flashcards')).resolves.toBeUndefined();

      const outside = await requireFeature(baseCtx, 'quiz.builder').catch((e: unknown) => e);
      expect(outside).toBeInstanceOf(AppError);
      expect(outside).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

      await expect(requireFeature(baseCtx, 'ai.chat')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });

      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  describe('limits narrowing (step 8 resolves only the quotas the enabled entitlements need)', () => {
    it('resolves only the quota keys of the enabled entitlements', async () => {
      const getEffectiveLimit = vi.fn((_ctx: RequestContext, _key: LimitKey) =>
        Promise.resolve(-1),
      );
      resolver = new EntitlementResolver(() => Promise.resolve(mock), { getEffectiveLimit });
      // `base` grants flashcards + quiz, the override adds ai.chat: no other
      // entitlement is enabled, so only their three quotas may be resolved.
      mockTables({
        personalPlanKey: 'base',
        overrides: [{ feature_key: 'ai.chat', is_enabled: true }],
      });

      const { entitlements, limits } = await resolver.resolveEntitlements(baseCtx);

      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz']);
      const resolvedKeys = getEffectiveLimit.mock.calls.map((call) => call[1]);
      expect(resolvedKeys).toHaveLength(3);
      expect(new Set(resolvedKeys)).toEqual(
        new Set(['max_ai_tokens_per_day', 'max_flashcards', 'max_quiz_attempts_per_day']),
      );
      expect(Object.keys(limits).toSorted()).toEqual(
        ['max_ai_tokens_per_day', 'max_flashcards', 'max_quiz_attempts_per_day'].toSorted(),
      );
    });

    it('calls getEffectiveLimit zero times when no entitlement is enabled', async () => {
      const getEffectiveLimit = vi.fn((_ctx: RequestContext, _key: LimitKey) =>
        Promise.resolve(-1),
      );
      resolver = new EntitlementResolver(() => Promise.resolve(mock), { getEffectiveLimit });
      mockTables({ personalPlanKey: null });

      const { entitlements, limits } = await resolver.resolveEntitlements(baseCtx);

      expect(entitlements).toEqual([]);
      expect(getEffectiveLimit).not.toHaveBeenCalled();
      expect(limits).toEqual({});
    });

    it('still excludes a quota-0 entitlement under the narrowed computation', async () => {
      const getEffectiveLimit = vi.fn((_ctx: RequestContext, key: LimitKey) =>
        Promise.resolve(key === 'max_ai_tokens_per_day' ? 0 : -1),
      );
      resolver = new EntitlementResolver(() => Promise.resolve(mock), { getEffectiveLimit });
      mockTables({ personalPlanKey: 'ace' });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);

      // `ace` enables ai.chat, flashcards, quiz, advanced.stats; ai.chat's
      // quota resolves to 0, so it is not effective even though its quota was
      // one of the resolved keys.
      expect(entitlements).toEqual(['flashcards', 'quiz', 'advanced.stats']);
      expect(new Set(getEffectiveLimit.mock.calls.map((call) => call[1]))).toEqual(
        new Set(['max_ai_tokens_per_day', 'max_flashcards', 'max_quiz_attempts_per_day']),
      );
    });
  });

  describe('per-request memo', () => {
    it('resolves once per request context (memoized on the ctx object)', async () => {
      mockTables({ personalPlanKey: 'ace' });
      const ctx: RequestContext = { ...baseCtx };

      const first = await resolver.resolveEntitlements(ctx);
      const fromCallsAfterFirst = vi.mocked(mock.from).mock.calls.length;
      const second = await resolver.resolveEntitlements(ctx);

      expect(second).toBe(first);
      expect(vi.mocked(mock.from).mock.calls.length).toBe(fromCallsAfterFirst);
    });

    it('resolves again for a different ctx object', async () => {
      mockTables({ personalPlanKey: 'ace' });

      await resolver.resolveEntitlements({ ...baseCtx });
      const fromCallsAfterFirst = vi.mocked(mock.from).mock.calls.length;
      await resolver.resolveEntitlements({ ...baseCtx });

      expect(vi.mocked(mock.from).mock.calls.length).toBeGreaterThan(fromCallsAfterFirst);
    });

    it('retries with a fresh resolution after a rejected one (evicted from the memo)', async () => {
      let clientCalls = 0;
      const flakyFactory = () => {
        clientCalls += 1;
        return clientCalls === 1 ? Promise.reject(new Error('db down')) : Promise.resolve(mock);
      };
      const retryResolver = new EntitlementResolver(flakyFactory, limitsWith());
      mockTables({ personalPlanKey: 'ace' });
      const ctx: RequestContext = { ...baseCtx };

      await expect(retryResolver.resolveEntitlements(ctx)).rejects.toThrow('db down');
      const second = await retryResolver.resolveEntitlements(ctx);

      expect(clientCalls).toBe(2);
      expect(second.entitlements).toContain('ai.chat');
    });
  });

  describe('isUserOverrideActive', () => {
    const now = Date.parse('2026-10-25T12:00:00.000Z');

    it('treats missing expiry as permanent', () => {
      expect(isUserOverrideActive(null, now)).toBe(true);
      expect(isUserOverrideActive(undefined, now)).toBe(true);
    });

    it('applies a future expiry and ignores one at or before now', () => {
      expect(isUserOverrideActive('2026-10-25T12:00:01.000Z', now)).toBe(true);
      expect(isUserOverrideActive('2026-10-25T12:00:00.000Z', now)).toBe(false); // <= now
      expect(isUserOverrideActive('2026-10-14T12:00:00+00:00', now)).toBe(false);
    });

    it('keeps an unparseable expiry applied (defensive)', () => {
      expect(isUserOverrideActive('not-a-date', now)).toBe(true);
    });
  });
});
