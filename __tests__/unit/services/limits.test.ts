import { AccountType, type LimitKey, type RequestContext } from '@studiq/authz';
import {
  AI_TOKENS_LIMIT_KEY,
  checkLimit,
  checkOrgLimit,
  getEffectiveLimit,
  getUsage,
  limitsResolver,
} from '@studiq/server/services/limits';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chain, mockResolverTables } from '#test/helpers/entitlement-resolver-mock';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { asSupabaseClient } from '#test/helpers/supabase-double';

/** A key outside the catalogue: the helpers must fail closed instead of trusting it. */
function unlistedLimitKey(key: string): LimitKey {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the runtime contract is wider than LimitKey; feeding it an unlisted key is the point of the test
  return key as LimitKey;
}

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

/** A fresh ctx object per call: the singleton memoizes per ctx (per request). */
function freshCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return { ...baseCtx, ...overrides };
}

const ORG_LIMITS: Partial<Record<LimitKey, number>> = {
  max_flashcards: 2000,
  max_ai_tokens_per_day: 200000,
  max_students: 50,
  max_groups: 20,
};

const PERSONAL_LIMITS: Partial<Record<LimitKey, number>> = {
  max_flashcards: 100,
  max_ai_tokens_per_day: 0,
  max_students: -1,
  max_groups: -1,
};

describe('limits wrappers over the single resolver (phase 3b)', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('getEffectiveLimit', () => {
    it('reads the composed limit from the resolver (personal plan outside an org)', async () => {
      mockResolverTables(mock, { personalPlanKey: 'base', planLimits: { base: PERSONAL_LIMITS } });

      await expect(getEffectiveLimit(freshCtx(), 'max_flashcards')).resolves.toBe(100);
      await expect(getEffectiveLimit(freshCtx(), 'max_students')).resolves.toBe(0);
    });

    it('reads the max of org and personal for a verified member', async () => {
      mockResolverTables(mock, {
        orgPlan: 'hub',
        roleProfile: 'learner',
        personalPlanKey: 'base',
        planLimits: { hub: ORG_LIMITS, base: PERSONAL_LIMITS },
      });
      const ctx = freshCtx({ activeOrgId: 'org-1', orgRoleId: 'role-member' });

      await expect(getEffectiveLimit(ctx, 'max_flashcards')).resolves.toBe(2000);
      await expect(getEffectiveLimit(ctx, 'max_ai_tokens_per_day')).resolves.toBe(200000);
      await expect(getEffectiveLimit(ctx, 'max_groups')).resolves.toBe(20);
    });

    it('returns 0 for an unknown limit key, fail closed', async () => {
      await expect(
        getEffectiveLimit(freshCtx(), unlistedLimitKey('nonexistent_limit')),
      ).resolves.toBe(0);
      expect(mock.from).not.toHaveBeenCalled();
    });
  });

  describe('checkLimit', () => {
    it('does not throw when under limit', async () => {
      mockResolverTables(mock, { personalPlanKey: 'base', planLimits: { base: PERSONAL_LIMITS } });

      await expect(checkLimit(freshCtx(), 'max_flashcards', 50)).resolves.toBeUndefined();
    });

    it('throws USAGE_LIMIT_EXCEEDED when over limit', async () => {
      mockResolverTables(mock, { personalPlanKey: 'base', planLimits: { base: PERSONAL_LIMITS } });

      await expect(checkLimit(freshCtx(), 'max_flashcards', 100)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
      await expect(checkLimit(freshCtx(), 'max_flashcards', 99, 2)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
    });

    it('does not throw when the composed limit is -1, unlimited', async () => {
      mockResolverTables(mock, {
        personalPlanKey: 'pro',
        planLimits: { pro: { ...PERSONAL_LIMITS, max_flashcards: -1 } },
      });

      await expect(checkLimit(freshCtx(), 'max_flashcards', 999_999)).resolves.toBeUndefined();
    });
  });

  describe('checkOrgLimit (explicit org, service-role path)', () => {
    it('uses the injected client, so a pre-membership caller still sees the plan (#191)', async () => {
      const adminFrom = vi.fn((table: string) => {
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_limits') return chain({ limit_value: 40 });
        return chain(null);
      });
      const admin = asSupabaseClient({ from: adminFrom });

      await expect(checkOrgLimit('org-1', 'max_students', 10, 1, admin)).resolves.toBeUndefined();

      expect(adminFrom).toHaveBeenCalledWith('organizations');
      // The user-session client would see nothing (RLS) and silently return
      // "unlimited", which is the #182 regression this guards against.
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('throws when the injected client reports the org is at capacity', async () => {
      const admin = asSupabaseClient({
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain({ plan: 'launch' });
          if (table === 'plan_limits') return chain({ limit_value: 40 });
          return chain(null);
        }),
      });

      await expect(checkOrgLimit('org-1', 'max_students', 40, 1, admin)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
    });

    it('keeps the slot when the org is one below capacity', async () => {
      const admin = asSupabaseClient({
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain({ plan: 'launch' });
          if (table === 'plan_limits') return chain({ limit_value: 40 });
          return chain(null);
        }),
      });

      await expect(checkOrgLimit('org-1', 'max_students', 39, 1, admin)).resolves.toBeUndefined();
    });

    it('blocks at 0 when the org plan defines no such limit, fail closed', async () => {
      const admin = asSupabaseClient({
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain({ plan: 'launch' });
          if (table === 'plan_limits') return chain(null);
          return chain(null);
        }),
      });

      await expect(checkOrgLimit('org-1', 'max_students', 0, 1, admin)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
    });

    it('treats an unknown organization as NOT_FOUND', async () => {
      const admin = asSupabaseClient({
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain(null);
          return chain(null);
        }),
      });

      await expect(checkOrgLimit('org-missing', 'max_students', 0, 1, admin)).rejects.toThrow(
        'NOT_FOUND',
      );
      expect(admin.from).not.toHaveBeenCalledWith('plan_limits');
    });

    it('enforces max_groups from the org plan boundaries', async () => {
      const admin = asSupabaseClient({
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain({ plan: 'hub' });
          if (table === 'plan_limits') return chain({ limit_value: 20 });
          return chain(null);
        }),
      });

      await expect(checkOrgLimit('org-1', 'max_groups', 19, 1, admin)).resolves.toBeUndefined();
      await expect(checkOrgLimit('org-1', 'max_groups', 20, 1, admin)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
    });
  });

  describe('getUsage', () => {
    it('reports the composed limit and the effective primary plan in an org context', async () => {
      mockResolverTables(mock, {
        orgPlan: 'hub',
        roleProfile: 'learner',
        personalPlanKey: 'base',
        planLimits: { hub: ORG_LIMITS, base: PERSONAL_LIMITS },
      });
      const baseImpl: (table: string) => unknown = vi.mocked(mock.from).getMockImplementation()!;
      mock.from.mockImplementation((table: string) =>
        table === 'user_daily_activity'
          ? chain({ ai_input_tokens: 10, ai_output_tokens: 5 })
          : baseImpl(table),
      );
      const ctx = freshCtx({ activeOrgId: 'org-1', orgRoleId: 'role-member' });

      const usage = await getUsage(ctx, AI_TOKENS_LIMIT_KEY);

      expect(usage.current).toBe(15);
      expect(usage.limit).toBe(200000);
      // The effective primary is the org plan in a verified org (phase 3b);
      // the union's `sources` ride on resolveEntitlements.
      expect(usage.plan).toBe('hub');
      expect(usage.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00/);
    });

    it('reports the personal plan as primary outside an org', async () => {
      mockResolverTables(mock, {
        personalPlanKey: 'base',
        planLimits: { base: { ...PERSONAL_LIMITS, max_ai_tokens_per_day: 5000 } },
      });
      const baseImpl: (table: string) => unknown = vi.mocked(mock.from).getMockImplementation()!;
      mock.from.mockImplementation((table: string) =>
        table === 'user_daily_activity' ? chain(null) : baseImpl(table),
      );

      const usage = await getUsage(freshCtx(), AI_TOKENS_LIMIT_KEY);

      expect(usage.current).toBe(0);
      expect(usage.limit).toBe(5000);
      expect(usage.plan).toBe('base');
    });
  });

  it('limitsResolver keeps the call-site shape of the deleted LimitsResolver', () => {
    expect(Object.keys(limitsResolver).toSorted()).toEqual(
      [
        'checkLimit',
        'checkOrgLimit',
        'getEffectiveLimit',
        'getUsage',
        'trackTokenUsage',
      ].toSorted(),
    );
  });
});
