import { AccountType, type RequestContext } from '@studiq/authz';
import { LimitsResolver } from '@studiq/server/services/limits.resolver';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Chain whose terminal result depends on the filters applied via `.eq()`.
 * Used to distinguish the personal-plan and org-plan `plan_limits` lookups,
 * which differ only by the `plan_key` filter.
 */
function filteredChain(resolve: (filters: Record<string, string>) => unknown) {
  const filters: Record<string, string> = {};
  const resolved = () => ({ data: resolve(filters), error: null });
  const terminal = vi.fn(() => Promise.resolve(resolved()));
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn((column: string, value: string) => {
    filters[column] = value;
    return c;
  });
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
    Promise.resolve(resolved()).then(onfulfilled);
  return c;
}

describe('LimitsResolver', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let resolver: LimitsResolver;

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
    resolver = new LimitsResolver(async () => mock as any);
  });

  describe('getEffectiveLimit', () => {
    it('returns personal plan limit when not in org', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_limits') return chain({ limit_value: 100 });
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(baseCtx, 'max_flashcards');
      expect(limit).toBe(100);
    });

    it('returns max of personal and org plan limits when in org', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'plan_limits') {
          return filteredChain((f) =>
            f.plan_key === 'hub' ? { limit_value: 500 } : { limit_value: 100 },
          );
        }
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_flashcards');
      expect(limit).toBe(500);
      // The dropped per-org snapshot (#229) must never be queried again.
      expect(mock.from).not.toHaveBeenCalledWith('org_limits');
    });

    it('uses the org plan limit when the user has no personal plan', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'profiles') return chain({ personal_plan_key: null });
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_limits') return chain({ limit_value: 50 });
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_questions');
      expect(limit).toBe(50);
    });

    it('derives the org limit from organizations.plan -> plan_limits, not a snapshot', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_limits') return chain({ limit_value: 10 });
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_decks');
      expect(limit).toBe(10);
      expect(mock.from).toHaveBeenCalledWith('organizations');
    });

    it('returns the seated plan limit and ignores the org plan', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'campus' });
        if (table === 'plan_limits') return chain({ limit_value: 999 });
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_flashcards');
      expect(limit).toBe(999);
      expect(mock.from).not.toHaveBeenCalledWith('profiles');
      expect(mock.from).not.toHaveBeenCalledWith('org_limits');
    });

    it('returns -1 when any limit is unlimited', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'profiles') return chain({ personal_plan_key: 'pro' });
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'plan_limits') {
          return filteredChain((f) =>
            f.plan_key === 'pro' ? { limit_value: -1 } : { limit_value: 500 },
          );
        }
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_flashcards');
      expect(limit).toBe(-1);
    });

    it('returns 0 when no limits found', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_limits') return chain(null);
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(baseCtx, 'nonexistent_limit');
      expect(limit).toBe(0);
    });
  });

  describe('checkOrgLimit', () => {
    it('uses the injected client, so a pre-membership caller still sees the plan (#191)', async () => {
      const adminFrom = vi.fn((table: string) => {
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_limits') return chain({ limit_value: 40 });
        return chain(null);
      });
      const admin = { from: adminFrom } as any;

      await expect(
        resolver.checkOrgLimit('org-1', 'max_students', 10, 1, admin),
      ).resolves.toBeUndefined();

      expect(adminFrom).toHaveBeenCalledWith('organizations');
      expect(adminFrom).not.toHaveBeenCalledWith('org_limits');
      // The user-session client would see nothing (RLS) and silently return
      // "unlimited", which is the #182 regression this guards against.
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('throws when the injected client reports the org is at capacity', async () => {
      const admin = {
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain({ plan: 'launch' });
          if (table === 'plan_limits') return chain({ limit_value: 40 });
          return chain(null);
        }),
      } as any;

      await expect(resolver.checkOrgLimit('org-1', 'max_students', 40, 1, admin)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
    });

    it('keeps the slot when the org is one below capacity', async () => {
      const admin = {
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain({ plan: 'launch' });
          if (table === 'plan_limits') return chain({ limit_value: 40 });
          return chain(null);
        }),
      } as any;

      await expect(
        resolver.checkOrgLimit('org-1', 'max_students', 39, 1, admin),
      ).resolves.toBeUndefined();
    });

    it('defaults to unlimited (-1) when the org plan defines no such limit', async () => {
      const admin = {
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain({ plan: 'launch' });
          if (table === 'plan_limits') return chain(null);
          return chain(null);
        }),
      } as any;

      await expect(
        resolver.checkOrgLimit('org-1', 'max_unknown', 999_999, 1, admin),
      ).resolves.toBeUndefined();
    });
  });

  describe('checkLimit', () => {
    it('does not throw when under limit', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_limits') return chain({ limit_value: 100 });
        return chain(null);
      });

      await expect(resolver.checkLimit(baseCtx, 'max_flashcards', 50)).resolves.toBeUndefined();
    });

    it('throws when over limit', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_limits') return chain({ limit_value: 100 });
        return chain(null);
      });

      await expect(resolver.checkLimit(baseCtx, 'max_flashcards', 100)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
    });

    it('does not throw when limit is -1 (unlimited)', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'pro' });
        if (table === 'plan_limits') return chain({ limit_value: -1 });
        return chain(null);
      });

      await expect(resolver.checkLimit(baseCtx, 'max_flashcards', 999999)).resolves.toBeUndefined();
    });
  });
});
