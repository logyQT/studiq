import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { FEATURES, FeatureResolver, rolloutBucket } from '@/server/services/feature.resolver';
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

type FlagRow = { key: string; is_enabled: boolean; rollout_percentage: number };

function allFlagsOn(keys: readonly string[] = FEATURES): FlagRow[] {
  return keys.map((key) => ({ key, is_enabled: true, rollout_percentage: 100 }));
}

describe('FeatureResolver', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let resolver: FeatureResolver;

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
    resolver = new FeatureResolver(async () => mock as any);
  });

  describe('precedence chain', () => {
    it('returns all features for SYS_ADMIN with no rollout gating', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const ctx = { ...baseCtx, accountType: AccountType.SYS_ADMIN };
      const res = await resolver.resolveFeatures(ctx);
      expect(res.features).toEqual([...FEATURES]);
      expect(res.rollout).toEqual({});
    });

    it('uses seat plan entitlement when the user is seated in an org', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };
      const teamFeatures = ['flashcards', 'quiz', 'quiz.builder', 'group.manage', 'member.manage', 'documents'];

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'team' });
        if (table === 'plan_features') {
          return chain(teamFeatures.map((f) => ({ feature_key: f })));
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      // Seat plan wins over the org role features, which are never consulted
      // for a seated user. Result is FEATURES-canonical order.
      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards', 'quiz', 'quiz.builder', 'documents', 'group.manage', 'member.manage']);
    });

    it('treats org role features as the authoritative entitlement in org context', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([
            { feature_key: 'group.manage', is_enabled: true },
            { feature_key: 'member.manage', is_enabled: false },
            { feature_key: 'ai.chat', is_enabled: true },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['ai.chat', 'group.manage']);
    });

    it('falls back to personal plan when org role features are empty', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') return chain([]);
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'flashcards' },
            { feature_key: 'quiz' },
            { feature_key: 'group.manage' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards', 'quiz', 'group.manage']);
    });

    it('returns personal plan features when not in org context', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'flashcards' },
            { feature_key: 'quiz' },
            { feature_key: 'ai.chat' },
            { feature_key: 'advanced.stats' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['ai.chat', 'flashcards', 'quiz', 'advanced.stats']);
    });

    it('applies user_feature_overrides as the strongest layer', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'group.manage', is_enabled: true }]);
        }
        if (table === 'user_feature_overrides') {
          return chain([
            { feature_key: 'group.manage', is_enabled: false },
            { feature_key: 'ai.chat', is_enabled: true },
          ]);
        }
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // role granted group.manage, override removes it and adds ai.chat
      expect(features).toEqual(['ai.chat']);
    });

    it('returns empty when no entitlement source yields features', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_features') return chain([]);
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual([]);
    });
  });

  describe('global flag gate (kill switch)', () => {
    it('removes a feature whose global flag is disabled', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'flashcards' },
            { feature_key: 'quiz' },
            { feature_key: 'ai.chat' },
            { feature_key: 'advanced.stats' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') {
          return chain([
            { key: 'flashcards', is_enabled: true, rollout_percentage: 100 },
            { key: 'quiz', is_enabled: true, rollout_percentage: 100 },
            { key: 'ai.chat', is_enabled: false, rollout_percentage: 100 },
            { key: 'advanced.stats', is_enabled: true, rollout_percentage: 100 },
          ]);
        }
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['flashcards', 'quiz', 'advanced.stats']);
    });
  });

  describe('rollout percentage', () => {
    it('excludes a feature when the user bucket misses the rollout', async () => {
      const ctx = { ...baseCtx };
      const bucket = rolloutBucket(ctx.userId, 'ai.chat');
      // rollout = bucket → enabled only when bucket < rollout, so exactly disabled
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'flashcards' },
            { feature_key: 'quiz' },
            { feature_key: 'ai.chat' },
            { feature_key: 'advanced.stats' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') {
          return chain([
            { key: 'flashcards', is_enabled: true, rollout_percentage: 100 },
            { key: 'quiz', is_enabled: true, rollout_percentage: 100 },
            { key: 'ai.chat', is_enabled: true, rollout_percentage: bucket },
            { key: 'advanced.stats', is_enabled: true, rollout_percentage: 100 },
          ]);
        }
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards', 'quiz', 'advanced.stats']);
    });

    it('includes a rolled-out feature hit and reports its percentage', async () => {
      const ctx = { ...baseCtx };
      const bucket = rolloutBucket(ctx.userId, 'ai.chat');
      // rollout = bucket + 1 → bucket < rollout, so enabled and reported
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'flashcards' },
            { feature_key: 'quiz' },
            { feature_key: 'ai.chat' },
            { feature_key: 'advanced.stats' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') {
          return chain([
            { key: 'flashcards', is_enabled: true, rollout_percentage: 100 },
            { key: 'quiz', is_enabled: true, rollout_percentage: 100 },
            { key: 'ai.chat', is_enabled: true, rollout_percentage: bucket + 1 },
            { key: 'advanced.stats', is_enabled: true, rollout_percentage: 100 },
          ]);
        }
        return chain(null);
      });

      const res = await resolver.resolveFeatures(ctx);
      expect(res.features).toEqual(['ai.chat', 'flashcards', 'quiz', 'advanced.stats']);
      expect(res.rollout).toEqual({ 'ai.chat': bucket + 1 });
    });

    it('is deterministic for the same user and key', () => {
      expect(rolloutBucket('user-1', 'ai.chat')).toBe(rolloutBucket('user-1', 'ai.chat'));
      expect(rolloutBucket('user-1', 'ai.chat')).not.toBe(rolloutBucket('user-1', 'quiz'));
      expect(rolloutBucket('user-1', 'ai.chat')).not.toBe(rolloutBucket('user-2', 'ai.chat'));
      expect(rolloutBucket('x', 'y')).toBeGreaterThanOrEqual(0);
      expect(rolloutBucket('x', 'y')).toBeLessThan(100);
    });
  });

  describe('requireFeature', () => {
    it('returns success when feature is enabled', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'group.manage', is_enabled: true }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const result = await resolver.requireFeature(ctx, 'group.manage');
      expect(result.success).toBe(true);
    });

    it('returns failure when feature is not enabled', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'group.manage', is_enabled: true }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const result = await resolver.requireFeature(ctx, 'role.builder');
      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });
  });
});