import { AccountType, type RequestContext } from '@studiq/authz';
import { LimitsResolver } from '@studiq/server/services/limits.resolver';
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

  // #230 acceptance: the dropped snapshot table must never be queried again,
  // whichever path a case exercises.
  afterEach(() => {
    expect(mock.from).not.toHaveBeenCalledWith('org_limits');
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
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_members') return chain({ organization_id: 'org-1' });
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

    it('resolves the org plan for a member whose ctx has no orgRoleId', async () => {
      // Membership decides the org branch, not `orgRoleId`: a real org_members
      // row must still resolve the org plan when the ctx role id is missing.
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: null };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_members') return chain({ organization_id: 'org-1' });
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'plan_limits') {
          return filteredChain((f) =>
            f.plan_key === 'hub' ? { limit_value: 500 } : { limit_value: 100 },
          );
        }
        return chain(null);
      });

      await expect(resolver.getEffectiveLimit(ctx, 'max_flashcards')).resolves.toBe(500);
      expect(mock.from).toHaveBeenCalledWith('org_members');
    });

    it('uses the org plan limit when the user has no personal plan', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_members') return chain({ organization_id: 'org-1' });
        if (table === 'profiles') return chain({ personal_plan_key: null });
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_limits') return chain({ limit_value: 50 });
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_questions');
      expect(limit).toBe(50);
    });

    it('derives the org limit from organizations.plan -> plan_limits, not a snapshot', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      const planLimitFilters: Record<string, string>[] = [];

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_members') return chain({ organization_id: 'org-1' });
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_limits') {
          return filteredChain((filters) => {
            planLimitFilters.push({ ...filters });
            if (filters.limit_key !== 'max_decks') return null;
            return { limit_value: filters.plan_key === 'launch' ? 40 : 10 };
          });
        }
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_decks');
      // base (personal) = 10, launch (org) = 40 → max wins, so the org value can
      // only come from the org's plan, not the personal plan or a snapshot.
      expect(limit).toBe(40);
      expect(planLimitFilters).toEqual([
        { plan_key: 'base', limit_key: 'max_decks' },
        { plan_key: 'launch', limit_key: 'max_decks' },
      ]);
      expect(mock.from).toHaveBeenCalledWith('org_members');
      expect(mock.from).toHaveBeenCalledWith('organizations');
      expect(mock.from).not.toHaveBeenCalledWith('org_limits');
    });

    it('returns the seated plan limit and ignores the org plan', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'campus' });
        if (table === 'plan_limits') return chain({ limit_value: 999 });
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_flashcards');
      expect(limit).toBe(999);
      expect(mock.from).not.toHaveBeenCalledWith('profiles');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
      expect(mock.from).not.toHaveBeenCalledWith('org_members');
      expect(mock.from).not.toHaveBeenCalledWith('org_limits');
    });

    it('returns 0 when the seat plan does not define the limit', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'hub' });
        if (table === 'plan_limits') return chain(null);
        return chain(null);
      });

      await expect(resolver.getEffectiveLimit(ctx, 'max_unknown')).resolves.toBe(0);
      // Seat path is exclusive: no personal/org fallback.
      expect(mock.from).not.toHaveBeenCalledWith('profiles');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('ignores a spoofed active-org cookie without a verified membership', async () => {
      // `active_org_id` is client-controlled, so without an org_members row the
      // foreign org plan must not widen limits.
      const ctx = { ...baseCtx, activeOrgId: 'org-other', orgRoleId: null };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_members') return chain(null);
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'organizations') return chain({ plan: 'campus' });
        if (table === 'plan_limits') {
          return filteredChain((f) => ({ limit_value: f.plan_key === 'campus' ? -1 : 100 }));
        }
        return chain(null);
      });

      await expect(resolver.getEffectiveLimit(ctx, 'max_flashcards')).resolves.toBe(100);
      expect(mock.from).toHaveBeenCalledWith('org_members');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('returns -1 when any limit is unlimited', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_members') return chain({ organization_id: 'org-1' });
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

    it('treats an unknown organization as unlimited (-1)', async () => {
      const admin = {
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain(null);
          return chain(null);
        }),
      } as any;

      await expect(
        resolver.checkOrgLimit('org-missing', 'max_students', 999_999, 1, admin),
      ).resolves.toBeUndefined();
      expect(admin.from).not.toHaveBeenCalledWith('plan_limits');
    });

    it('enforces max_groups from the org plan boundaries', async () => {
      const admin = {
        from: vi.fn((table: string) => {
          if (table === 'organizations') return chain({ plan: 'hub' });
          if (table === 'plan_limits') return chain({ limit_value: 20 });
          return chain(null);
        }),
      } as any;

      await expect(
        resolver.checkOrgLimit('org-1', 'max_groups', 19, 1, admin),
      ).resolves.toBeUndefined();
      await expect(resolver.checkOrgLimit('org-1', 'max_groups', 20, 1, admin)).rejects.toThrow(
        'USAGE_LIMIT_EXCEEDED',
      );
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

  describe('getUsage', () => {
    it('reports the org-plan limit in org context while keeping the personal plan key', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_members') return chain({ organization_id: 'org-1' });
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'user_daily_activity') {
          return chain({ ai_input_tokens: 10, ai_output_tokens: 5 });
        }
        if (table === 'plan_limits') {
          return filteredChain((f) => ({
            limit_value: f.plan_key === 'hub' ? 200000 : 0,
          }));
        }
        return chain(null);
      });

      const usage = await resolver.getUsage(ctx, 'max_ai_tokens_per_day');
      expect(usage.limit).toBe(200000);
      expect(usage.current).toBe(15);
      // API shape is unchanged: `plan` stays the personal plan key.
      expect(usage.plan).toBe('base');
    });
  });
});
