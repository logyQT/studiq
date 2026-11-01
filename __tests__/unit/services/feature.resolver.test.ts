import { AccountType, type RequestContext } from '@studiq/authz';
import {
  FEATURES,
  FeatureResolver,
  isUserOverrideActive,
  rolloutBucket,
} from '@studiq/server/services/feature.resolver';
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
    it('adds seat plan features on top of org-role base (additive upgrade)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      const seatFeatures = ['flashcards', 'quiz', 'quiz.builder', 'documents', 'ai.chat'];

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'team' });
        if (table === 'org_role_features') {
          // Admin role has org.manage, so isSeatedAdmin = true
          return chain([
            { feature_key: 'org.manage', is_enabled: true },
            { feature_key: 'flashcards', is_enabled: true },
            { feature_key: 'quiz', is_enabled: true },
          ]);
        }
        if (table === 'plan_features') {
          return chain(seatFeatures.map((f) => ({ feature_key: f })));
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // Seat features added on top; org.manage kept because admin
      expect(features).toContain('ai.chat');
      expect(features).toContain('org.manage');
      expect(features).toContain('flashcards');
    });

    it('strips admin-only features from seat upgrade for non-admin roles', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };
      const seatFeatures = [
        'flashcards',
        'quiz',
        'quiz.builder',
        'documents',
        'ai.chat',
        'org.manage',
        'member.manage',
        'role.builder',
      ];

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'campus' });
        if (table === 'org_role_features') {
          // Teacher role: no org.manage → not admin
          return chain([
            { feature_key: 'flashcards', is_enabled: true },
            { feature_key: 'quiz', is_enabled: true },
          ]);
        }
        if (table === 'plan_features') {
          return chain(seatFeatures.map((f) => ({ feature_key: f })));
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // Seat plan grants org.manage/member.manage/role.builder, but they
      // must be stripped for a non-admin role.
      expect(features).not.toContain('org.manage');
      expect(features).not.toContain('member.manage');
      expect(features).not.toContain('role.builder');
      // Non-admin features from the seat should still be present
      expect(features).toContain('ai.chat');
      expect(features).toContain('flashcards');
    });

    it('gives seat plan features when user has no org-role features', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-orphan' };
      const seatFeatures = ['flashcards', 'quiz', 'ai.chat'];

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'ace' });
        if (table === 'org_role_features') return chain([]);
        if (table === 'plan_features') {
          return chain(seatFeatures.map((f) => ({ feature_key: f })));
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['ai.chat', 'flashcards', 'quiz']);
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
      // The personal plan fills an empty org entitlement, but org-scoped
      // capability (`group.manage`) is still an org-role decision.
      expect(features).toEqual(['flashcards', 'quiz']);
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

    it('falls back to the org plan when the org role has zero rows (custom role)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-custom' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') return chain([]);
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'flashcards' },
            { feature_key: 'quiz' },
            { feature_key: 'branding' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards', 'quiz', 'branding']);
      // The personal plan is layered on top, but this profile has none set.
      expect(mock.from).toHaveBeenCalledWith('profiles');
    });

    it('adds a student personal plan on top of the org entitlement (paid PRO in a free org)', async () => {
      // `student1` in the seed: personal `pro`, org on free `launch` whose
      // member role has no `ai.chat`. The purchase must still grant it.
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'flashcards' }, { feature_key: 'quiz' }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'pro' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'ai.chat' },
            { feature_key: 'advanced.stats' },
            { feature_key: 'documents' },
            { feature_key: 'flashcards' },
            { feature_key: 'quiz' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['ai.chat', 'flashcards', 'quiz', 'documents', 'advanced.stats']);
    });

    it('does not let a personal plan escalate admin-only keys in an org', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'flashcards', is_enabled: true }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'hub' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'ai.chat' },
            { feature_key: 'member.manage' },
            { feature_key: 'role.builder' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // `member` is not an org admin: the structure privileges are stripped.
      expect(features).toEqual(['ai.chat', 'flashcards']);
    });

    it('does not let a personal plan grant org-scoped capability inside an org', async () => {
      // `lite` (the free educator plan) includes `group.manage`. A `member`
      // role must not gain it just because it is the member's personal plan —
      // that is an org-role decision (EDU-02 regression).
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'flashcards', is_enabled: true }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'lite' });
        if (table === 'plan_features') {
          return chain([
            { feature_key: 'flashcards' },
            { feature_key: 'quiz' },
            { feature_key: 'group.manage' },
            { feature_key: 'member.manage' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards', 'quiz']);
    });

    it('keeps an org-scoped feature the role itself grants', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([
            { feature_key: 'flashcards', is_enabled: true },
            { feature_key: 'group.manage', is_enabled: true },
          ]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'lite' });
        if (table === 'plan_features') {
          return chain([{ feature_key: 'group.manage' }, { feature_key: 'quiz' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // group.manage survives because the org role granted it.
      expect(features).toEqual(['flashcards', 'quiz', 'group.manage']);
    });

    it('ignores a manager mirrored personal plan inside an org (#228)', async () => {
      const ctx = {
        ...baseCtx,
        accountType: AccountType.MANAGER,
        activeOrgId: 'org-1',
        orgRoleId: 'role-member',
      };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'flashcards', is_enabled: true }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'campus' });
        if (table === 'plan_features') return chain([{ feature_key: 'ai.chat' }]);
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards']);
    });

    it('still applies the personal plan when there is no active org', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_features') {
          return chain([{ feature_key: 'flashcards' }, { feature_key: 'branding' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['flashcards', 'branding']);
      // No active org → the org-plan layer is skipped entirely.
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('keeps role rows authoritative over the org plan when present', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') {
          return chain([
            { feature_key: 'flashcards', is_enabled: true },
            { feature_key: 'quiz', is_enabled: true },
          ]);
        }
        // The org plan would grant branding — role rows must still win.
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'plan_features') return chain([{ feature_key: 'branding' }]);
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards', 'quiz']);
      expect(features).not.toContain('branding');
      // Role rows are non-empty → the org-plan layer is never consulted.
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
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

    it('ignores an expired user override grant (#382)', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_features')
          return chain([{ feature_key: 'flashcards' }, { feature_key: 'quiz' }]);
        if (table === 'user_feature_overrides')
          return chain([
            {
              feature_key: 'ai.chat',
              is_enabled: true,
              expires_at: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['flashcards', 'quiz']);
    });

    it('ignores an expired user override revoke (#382)', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_features')
          return chain([{ feature_key: 'flashcards' }, { feature_key: 'quiz' }]);
        if (table === 'user_feature_overrides')
          return chain([
            {
              feature_key: 'quiz',
              is_enabled: false,
              expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            },
          ]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['flashcards', 'quiz']);
    });

    it('applies a user override whose expiry is still in the future', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_features')
          return chain([{ feature_key: 'flashcards' }, { feature_key: 'quiz' }]);
        if (table === 'user_feature_overrides')
          return chain([
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
          ]);
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['ai.chat', 'flashcards']);
    });

    it('selects expires_at so expiry can be evaluated', async () => {
      let selected: string | null = null;
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_features') return chain([{ feature_key: 'flashcards' }]);
        if (table === 'user_feature_overrides') {
          const c = chain([]);
          const originalSelect = c.select as ReturnType<typeof vi.fn>;
          c.select = vi.fn((columns: string) => {
            selected = columns;
            return originalSelect(columns);
          });
          return c;
        }
        if (table === 'feature_flags') return chain(allFlagsOn());
        return chain(null);
      });

      await resolver.getEnabledFeatures(baseCtx);
      expect(selected).toContain('expires_at');
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
