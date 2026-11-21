import { AccountType, ENTITLEMENT_KEYS, type RequestContext, rolloutBucket } from '@studiq/authz';
import { FeatureResolver, isUserOverrideActive } from '@studiq/server/services/feature.resolver';
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

function allFlagsOn(keys: readonly string[] = ENTITLEMENT_KEYS): FlagRow[] {
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
    resolver = new FeatureResolver(() => Promise.resolve(mock));
  });

  describe('precedence chain', () => {
    it('adds seat plan features on top of the org-role base (additive upgrade)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      const seatFeatures = ['flashcards', 'quiz', 'quiz.builder', 'ai.chat'];

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'team' });
        if (table === 'org_roles') return chain({ entitlement_profile: 'none' });
        if (table === 'org_role_features') return chain([]);
        if (table === 'plan_entitlements') {
          return chain(seatFeatures.map((f) => ({ entitlement_key: f })));
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // Seat features are added on top of the (empty) org base.
      expect(features).toContain('ai.chat');
      expect(features).toContain('flashcards');
      expect(features).toContain('quiz.builder');
    });

    it('applies the seat plan additively and ignores non-catalog plan rows', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };
      const seatFeatures = [
        'flashcards',
        'quiz',
        'quiz.builder',
        'ai.chat',
        // Keys outside the catalog in a plan row are ignored, not granted.
        'org.manage',
        'member.manage',
        'role.builder',
      ];

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'campus' });
        if (table === 'org_roles') return chain({ entitlement_profile: 'none' });
        if (table === 'org_role_features') {
          return chain([
            { feature_key: 'flashcards', is_enabled: true },
            { feature_key: 'quiz', is_enabled: true },
          ]);
        }
        if (table === 'plan_entitlements') {
          return chain(seatFeatures.map((f) => ({ entitlement_key: f })));
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['ai.chat', 'flashcards', 'quiz', 'quiz.builder']);
    });

    it('gives seat plan features when the role has no rows and the none profile', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-orphan' };
      const seatFeatures = ['flashcards', 'quiz', 'ai.chat'];

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain({ pool_id: 'pool-1' });
        if (table === 'org_seat_pools') return chain({ plan_key: 'ace' });
        if (table === 'org_roles') return chain({ entitlement_profile: 'none' });
        if (table === 'org_role_features') return chain([]);
        if (table === 'plan_entitlements') {
          return chain(seatFeatures.map((f) => ({ entitlement_key: f })));
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['ai.chat', 'flashcards', 'quiz']);
    });

    it('lets the profile grant the ceiling and role rows only revoke (D19)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'all' });
        if (table === 'org_role_features') {
          // An enabled row adds nothing since the markers left the catalog
          // (2b-7): `advanced.stats` is not in the launch ceiling, so a row
          // that granted it would show up below. The revoked row must win
          // over the profile grant.
          return chain([
            { feature_key: 'advanced.stats', is_enabled: true },
            { feature_key: 'quiz', is_enabled: false },
          ]);
        }
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_entitlements') {
          return chain([{ entitlement_key: 'flashcards' }, { entitlement_key: 'quiz' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards']);
    });

    it('applies the personal plan when the none profile grants nothing', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'none' });
        if (table === 'org_role_features') return chain([]);
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_entitlements') {
          return chain([
            { entitlement_key: 'flashcards' },
            { entitlement_key: 'quiz' },
            { entitlement_key: 'branding' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // The personal plan fills an empty org entitlement, but the org-scoped
      // key (`branding`) is still an org-layer decision.
      expect(features).toEqual(['flashcards', 'quiz']);
    });

    it('returns personal plan features when not in org context', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_entitlements') {
          return chain([
            { entitlement_key: 'flashcards' },
            { entitlement_key: 'quiz' },
            { entitlement_key: 'ai.chat' },
            { entitlement_key: 'advanced.stats' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['ai.chat', 'flashcards', 'quiz', 'advanced.stats']);
    });

    it('resolves nothing for a custom role on the none profile', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-custom' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'none' });
        if (table === 'org_role_features') return chain([]);
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'plan_entitlements') {
          return chain([{ entitlement_key: 'flashcards' }, { entitlement_key: 'branding' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual([]);
      // Fail-closed: the profile read already decided, so the ceiling is skipped.
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
    });

    it('adds a student personal plan on top of the org entitlement (paid PRO in a free org)', async () => {
      // A `member` role on `launch` gets `flashcards`/`quiz`; a personal `pro`
      // must still grant `ai.chat`.
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'learner' });
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'flashcards' }, { feature_key: 'quiz' }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'pro' });
        if (table === 'plan_entitlements') {
          return chain([
            { entitlement_key: 'ai.chat' },
            { entitlement_key: 'advanced.stats' },
            { entitlement_key: 'flashcards' },
            { entitlement_key: 'quiz' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['ai.chat', 'flashcards', 'quiz', 'advanced.stats']);
    });

    it('does not let a personal plan grant an org-scoped key inside an org', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'learner' });
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'flashcards', is_enabled: true }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'hub' });
        if (table === 'plan_entitlements') {
          return chain([{ entitlement_key: 'ai.chat' }, { entitlement_key: 'branding' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // `hub` carries the org-scoped `branding`: a personal plan must not hand
      // it to a member inside an org — that is an org-layer decision.
      expect(features).toEqual(['ai.chat']);
    });

    it('does not let a personal plan grant an org-scoped key the org layer lacks', async () => {
      // A paid personal plan carries `branding` (org-scoped); a `member` role
      // must not gain it just because it is the member's personal plan (the
      // EDU-02 regression shape).
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'learner' });
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'flashcards', is_enabled: true }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'lite' });
        if (table === 'plan_entitlements') {
          return chain([
            { entitlement_key: 'flashcards' },
            { entitlement_key: 'quiz' },
            { entitlement_key: 'branding' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards', 'quiz']);
    });

    it('keeps an org-scoped key the org layer itself grants', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'all' });
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'branding', is_enabled: true }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'lite' });
        if (table === 'plan_entitlements') {
          return chain([{ entitlement_key: 'branding' }, { entitlement_key: 'quiz' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // `branding` survives because the `all` profile granted it from the plan
      // ceiling, so the personal layer keeps it too.
      expect(features).toEqual(['quiz', 'branding']);
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
        if (table === 'org_roles') return chain({ entitlement_profile: 'learner' });
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'flashcards', is_enabled: true }]);
        }
        if (table === 'profiles') return chain({ personal_plan_key: 'campus' });
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'plan_entitlements') return chain([{ entitlement_key: 'flashcards' }]);
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards']);
    });

    it('still applies the personal plan when there is no active org', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_entitlements') {
          return chain([{ entitlement_key: 'flashcards' }, { entitlement_key: 'branding' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['flashcards', 'branding']);
      // No active org → the org layer is skipped entirely.
      expect(mock.from).not.toHaveBeenCalledWith('org_roles');
    });

    it('lets an explicit revoke row beat the profile ceiling', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'all' });
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'quiz', is_enabled: false }]);
        }
        if (table === 'organizations') return chain({ plan: 'launch' });
        if (table === 'plan_entitlements') {
          return chain([{ entitlement_key: 'flashcards' }, { entitlement_key: 'quiz' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      expect(features).toEqual(['flashcards']);
    });

    it('applies user_feature_overrides as the strongest layer', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_roles') return chain({ entitlement_profile: 'all' });
        if (table === 'organizations') return chain({ plan: 'hub' });
        if (table === 'org_role_features') {
          return chain([{ feature_key: 'branding', is_enabled: true }]);
        }
        if (table === 'plan_entitlements') {
          return chain([
            { entitlement_key: 'flashcards' },
            { entitlement_key: 'quiz' },
            { entitlement_key: 'branding' },
          ]);
        }
        if (table === 'user_feature_overrides') {
          return chain([
            { feature_key: 'branding', is_enabled: false },
            { feature_key: 'ai.chat', is_enabled: true },
          ]);
        }
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(ctx);
      // the profile granted branding, the override removes it and adds ai.chat
      expect(features).toEqual(['ai.chat', 'flashcards', 'quiz']);
    });

    it('ignores an expired user override grant (#382)', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_entitlements')
          return chain([{ entitlement_key: 'flashcards' }, { entitlement_key: 'quiz' }]);
        if (table === 'user_feature_overrides')
          return chain([
            {
              feature_key: 'ai.chat',
              is_enabled: true,
              expires_at: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['flashcards', 'quiz']);
    });

    it('ignores an expired user override revoke (#382)', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_entitlements')
          return chain([{ entitlement_key: 'flashcards' }, { entitlement_key: 'quiz' }]);
        if (table === 'user_feature_overrides')
          return chain([
            {
              feature_key: 'quiz',
              is_enabled: false,
              expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
            },
          ]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['flashcards', 'quiz']);
    });

    it('applies a user override whose expiry is still in the future', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_entitlements')
          return chain([{ entitlement_key: 'flashcards' }, { entitlement_key: 'quiz' }]);
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
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual(['ai.chat', 'flashcards']);
    });

    it('selects expires_at so expiry can be evaluated', async () => {
      let selected: string | null = null;
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_entitlements') return chain([{ entitlement_key: 'flashcards' }]);
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

      await resolver.getEnabledFeatures(baseCtx);
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

      const features = await resolver.getEnabledFeatures(baseCtx);
      expect(features).toEqual([]);
    });
  });

  describe('global flag gate (kill switch)', () => {
    it('removes a feature whose global flag is disabled', async () => {
      mock.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_entitlements') {
          return chain([
            { entitlement_key: 'flashcards' },
            { entitlement_key: 'quiz' },
            { entitlement_key: 'ai.chat' },
            { entitlement_key: 'advanced.stats' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') {
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
        if (table === 'plan_entitlements') {
          return chain([
            { entitlement_key: 'flashcards' },
            { entitlement_key: 'quiz' },
            { entitlement_key: 'ai.chat' },
            { entitlement_key: 'advanced.stats' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') {
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
        if (table === 'plan_entitlements') {
          return chain([
            { entitlement_key: 'flashcards' },
            { entitlement_key: 'quiz' },
            { entitlement_key: 'ai.chat' },
            { entitlement_key: 'advanced.stats' },
          ]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') {
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
      const first = rolloutBucket('user-1', 'ai.chat');
      expect(rolloutBucket('user-1', 'ai.chat')).toBe(first);
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
        if (table === 'org_role_features') return chain([]);
        if (table === 'profiles') return chain({ personal_plan_key: 'ace' });
        if (table === 'plan_entitlements') {
          return chain([{ entitlement_key: 'ai.chat' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const result = await resolver.requireFeature(ctx, 'ai.chat');
      expect(result.success).toBe(true);
    });

    it('returns failure when feature is not enabled', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-1' };

      mock.from.mockImplementation((table: string) => {
        if (table === 'org_seat_assignments') return chain(null);
        if (table === 'org_role_features') return chain([]);
        if (table === 'profiles') return chain({ personal_plan_key: 'base' });
        if (table === 'plan_entitlements') {
          return chain([{ entitlement_key: 'flashcards' }]);
        }
        if (table === 'user_feature_overrides') return chain([]);
        if (table === 'entitlement_flags') return chain(allFlagsOn());
        return chain(null);
      });

      const result = await resolver.requireFeature(ctx, 'branding');
      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });
  });
});
