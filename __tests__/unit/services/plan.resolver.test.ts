import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { PlanResolver } from '@/server/services/plan.resolver';
import type { RequestContext } from '@/lib/request-context';
import { AccountType } from '@/types';

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

describe('PlanResolver (limits)', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let resolver: PlanResolver;

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
    resolver = new PlanResolver(async () => mock as any);
  });

  describe('getEffectiveLimit', () => {
    it('returns -1 for SYS_ADMIN', async () => {
      const ctx = { ...baseCtx, accountType: AccountType.SYS_ADMIN };
      const limit = await resolver.getEffectiveLimit(ctx, 'max_flashcards');
      expect(limit).toBe(-1);
    });

    it('returns personal plan limit when not in org', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_limits') return chain({ limit_value: 100 });
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(baseCtx, 'max_flashcards');
      expect(limit).toBe(100);
    });

    it('returns max of personal and org limits when in org', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_limits') return chain({ limit_value: 100 });
        if (table === 'org_limits') return chain({ max_value: 500 });
        return chain(null);
      });

      const limit = await resolver.getEffectiveLimit(ctx, 'max_flashcards');
      expect(limit).toBe(500);
    });

    it('returns -1 when any limit is unlimited', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'pro' });
        if (table === 'plan_limits') return chain({ limit_value: -1 });
        if (table === 'org_limits') return chain({ max_value: 500 });
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

  describe('checkLimit', () => {
    it('does not throw when under limit', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_limits') return chain({ limit_value: 100 });
        return chain(null);
      });

      await expect(
        resolver.checkLimit(baseCtx, 'max_flashcards', 50),
      ).resolves.toBeUndefined();
    });

    it('throws when over limit', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_limits') return chain({ limit_value: 100 });
        return chain(null);
      });

      await expect(
        resolver.checkLimit(baseCtx, 'max_flashcards', 100),
      ).rejects.toThrow('USAGE_LIMIT_EXCEEDED');
    });

    it('does not throw when limit is -1 (unlimited)', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'pro' });
        if (table === 'plan_limits') return chain({ limit_value: -1 });
        return chain(null);
      });

      await expect(
        resolver.checkLimit(baseCtx, 'max_flashcards', 999999),
      ).resolves.toBeUndefined();
    });
  });
});