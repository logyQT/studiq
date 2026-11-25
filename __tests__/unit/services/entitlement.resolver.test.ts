import { AccountType, type RequestContext, type ResolvedEntitlements } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { requireEntitlement } from '@studiq/server/lib/entitlements';
import {
  EntitlementResolver,
  entitlementResolver,
  isUserOverrideActive,
} from '@studiq/server/services/entitlement.resolver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allFlagsOn,
  mockResolverTables,
  RESOLVER_TABLES,
  STATEMENT_TIMEOUT,
} from '#test/helpers/entitlement-resolver-mock';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

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
    resolver = new EntitlementResolver(() => Promise.resolve(mock));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Standard table mock: a verified member of `org-1` unless `member: false`. */
  function mockTables(opts: Parameters<typeof mockResolverTables>[1] = {}) {
    mockResolverTables(mock, opts);
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
        'quiz.templates',
        'stats.insights',
        'branding',
      ]);
    });

    it('intersects the seat plan with the org ceiling (seat adds only ceiling keys)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };
      mockTables({
        roleProfile: 'all',
        orgPlan: 'launch',
        seatPlanKey: 'seat',
        // `seat` carries ai.chat/stats.insights/quiz.templates; the launch
        // ceiling only carries flashcards/quiz, so the seat adds nothing.
        personalPlanKey: null,
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual(['flashcards', 'quiz']);
      expect(sources.seat).toEqual({ planKey: 'seat', origin: 'seat' });
    });

    it('fails when the seat read fails instead of resolving as "not seated" (#1373)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      // The member is seated, but the lookup times out: the personal and org plans
      // must not answer in place of the seat plan.
      mockTables({
        roleProfile: 'learner',
        orgPlan: 'hub',
        seatPlanKey: 'seat',
        personalPlanKey: 'ace',
        readErrors: { org_seat_assignments: STATEMENT_TIMEOUT },
      });

      await expect(resolver.resolveEntitlements(ctx)).rejects.toMatchObject({
        name: 'AppError',
        code: 'INTERNAL_SERVER',
      });
      // Nothing after the seat read ran, so no fallback layer was consulted.
      expect(mock.from).not.toHaveBeenCalledWith('profiles');
    });

    describe('a failed read fails the resolution (#1435)', () => {
      const memberCtx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      const memberTables = {
        roleProfile: 'learner',
        orgPlan: 'hub',
        seatPlanKey: 'seat',
        personalPlanKey: 'ace',
      };
      const readsWithoutSeat = RESOLVER_TABLES.filter((table) => table !== 'org_seat_assignments');

      it.each(readsWithoutSeat)(
        'rejects when the %s read fails and reads nothing after it',
        async (table) => {
          mockTables({ ...memberTables, readErrors: { [table]: STATEMENT_TIMEOUT } });

          await expect(resolver.resolveEntitlements(memberCtx)).rejects.toMatchObject({
            name: 'DatabaseError',
            code: '57014',
          });

          const read = vi.mocked(mock.from).mock.calls.map(([name]: unknown[]): unknown => name);
          const after = RESOLVER_TABLES.slice(RESOLVER_TABLES.indexOf(table) + 1);
          expect(read).toContain(table);
          for (const later of after) expect(read, later).not.toContain(later);
        },
      );

      it('does not bring a revoked override back when the overrides read fails', async () => {
        const revoked = [{ feature_key: 'ai.chat', is_enabled: false }];
        mockTables({ ...memberTables, overrides: revoked });
        // Control: with the read answering, the admin's revoke removes the key.
        const answered = await resolver.resolveEntitlements(memberCtx);
        expect(answered.entitlements).not.toContain('ai.chat');

        const fresh = new EntitlementResolver(() => Promise.resolve(mock));
        mockTables({
          ...memberTables,
          overrides: revoked,
          readErrors: { user_feature_overrides: STATEMENT_TIMEOUT },
        });
        // Before the fix the failed read resolved with no overrides, so the plan's
        // `ai.chat` came back for a user an admin had cut off.
        await expect(fresh.resolveEntitlements(memberCtx)).rejects.toMatchObject({
          code: '57014',
        });
      });

      it('does not widen limits through an org-scope personal plan when plan_entitlements fails (D34)', async () => {
        const tables = {
          orgPlan: 'launch',
          roleProfile: 'all',
          personalPlanKey: 'campus', // the legacy org-buyer mirror, scope = 'organization'
          planScopes: { campus: 'organization' },
          planLimits: {
            launch: { max_flashcards: 100 },
            campus: { max_flashcards: -1 },
          },
        };
        mockTables(tables);
        const answered = await resolver.resolveEntitlements(memberCtx);
        expect(answered.limits.max_flashcards).toBe(100);

        const fresh = new EntitlementResolver(() => Promise.resolve(mock));
        mockTables({ ...tables, readErrors: { plan_entitlements: STATEMENT_TIMEOUT } });
        // Without the scope rows `personalApplies` is true and the mirror's -1 would
        // have entered `max(org, seat, personal)`.
        await expect(fresh.resolveEntitlements(memberCtx)).rejects.toMatchObject({
          code: '57014',
        });
      });

      it('resolves again once a failed read recovers (the failure is not memoised)', async () => {
        mockTables({ ...memberTables, readErrors: { entitlement_flags: STATEMENT_TIMEOUT } });
        await expect(resolver.resolveEntitlements(memberCtx)).rejects.toMatchObject({
          code: '57014',
        });

        mockTables(memberTables);
        const { entitlements } = await resolver.resolveEntitlements(memberCtx);

        expect(entitlements).toContain('ai.chat');
      });
    });

    it('resolves again once the seat read recovers (the failure is not memoised)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      mockTables({
        roleProfile: 'learner',
        orgPlan: 'hub',
        seatPlanKey: 'seat',
        readErrors: { org_seat_assignments: STATEMENT_TIMEOUT },
      });
      await expect(resolver.resolveEntitlements(ctx)).rejects.toBeInstanceOf(AppError);

      mockTables({ roleProfile: 'learner', orgPlan: 'hub', seatPlanKey: 'seat' });
      const { sources } = await resolver.resolveEntitlements(ctx);

      expect(sources.seat).toEqual({ planKey: 'seat', origin: 'seat' });
    });

    it('adds seat keys that are in the ceiling on top of a learner profile', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      mockTables({ roleProfile: 'learner', orgPlan: 'hub', seatPlanKey: 'seat' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      // learner ∩ hub = ai.chat, flashcards, quiz, branding; the seat plan
      // (ai.chat, stats.insights, quiz.templates) is intersected with the hub
      // ceiling and adds stats.insights + quiz.templates.
      expect(entitlements).toEqual([
        'ai.chat',
        'flashcards',
        'quiz',
        'quiz.templates',
        'stats.insights',
        'branding',
      ]);
    });

    it('ignores non-catalog keys in plan rows', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      mockTables({
        roleProfile: 'all',
        orgPlan: 'launch',
        planEntitlements: {
          launch: ['flashcards', 'quiz', 'test.fictional', 'test.other', 'test.legacy'],
        },
      });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual(['flashcards', 'quiz']);
    });

    it('ignores a non-catalog key in user_feature_overrides (DB ahead of code)', async () => {
      // Phase 8 matrix cell F: a row for a key the TypeScript catalog does not
      // know is inert, in both directions, and never reaches `ENTITLEMENTS[key]`.
      mockTables({
        personalPlanKey: 'base',
        overrides: [
          { feature_key: 'test.dbonly', is_enabled: true },
          { feature_key: 'test.dbonly.revoked', is_enabled: false },
        ],
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['flashcards', 'quiz']);
      expect(sources.overrides).toEqual([]);
      expect(sources.revokedOverrides).toEqual([]);
    });

    it('picks up a plan row added between resolutions (no restart, no prune job)', async () => {
      // Phase 8 matrix cell D: the org layer is derived per request, so a plan
      // that gains a key serves it on the next resolution with no backfill row
      // and no cache flush. A fresh ctx per resolution is what a new request is.
      const adminCtx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      mockTables({ roleProfile: 'all', orgPlan: 'launch' });
      expect((await resolver.resolveEntitlements(adminCtx)).entitlements).toEqual([
        'flashcards',
        'quiz',
      ]);

      mockTables({
        roleProfile: 'all',
        orgPlan: 'launch',
        planEntitlements: { launch: ['flashcards', 'quiz', 'quiz.templates'] },
      });
      const after = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      expect((await resolver.resolveEntitlements(after)).entitlements).toEqual([
        'flashcards',
        'quiz',
        'quiz.templates',
      ]);
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
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz', 'stats.insights']);
    });

    it('does not let a personal plan grant an org-scoped key inside an org', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      // `branding` is org-scoped and not portable: a personal plan carrying it
      // must not hand it to a member inside an org (the EDU-02 regression
      // shape). The portable keys of the same plan (ai.chat, quiz.templates,
      // stats.insights) do carry over.
      mockTables({
        roleProfile: 'learner',
        orgPlan: 'launch',
        personalPlanKey: 'hub',
        planScopes: { hub: 'personal' },
      });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual([
        'ai.chat',
        'flashcards',
        'quiz',
        'quiz.templates',
        'stats.insights',
      ]);
      expect(entitlements).not.toContain('branding');
    });

    it('keeps an org-scoped key the org layer itself grants', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-teacher' };
      mockTables({ roleProfile: 'all', orgPlan: 'hub', personalPlanKey: 'base' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toContain('branding');
    });

    it('ignores an organization-scope personal plan inside an org (#228, D34)', async () => {
      const ctx = {
        ...baseCtx,
        accountType: AccountType.MANAGER,
        activeOrgId: 'org-1',
        orgRoleId: 'role-member',
      };
      mockTables({
        roleProfile: 'learner',
        orgPlan: 'hub',
        personalPlanKey: 'campus',
        planScopes: { campus: 'organization' },
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(ctx);
      // learner ∩ hub, and the mirrored org-scope plan adds nothing.
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz', 'branding']);
      expect(sources.personal).toBeNull();
    });

    it('still applies a personal-scope plan inside an org (personalPortable keys, D3)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-member' };
      mockTables({ roleProfile: 'learner', orgPlan: 'launch', personalPlanKey: 'pro' });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      // learner ∩ launch gives flashcards/quiz; the personal pro adds its
      // portable keys (ai.chat, stats.insights).
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz', 'stats.insights']);
    });

    it('treats a non-member active_org_id as no org context (verified membership)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: 'role-admin' };
      mockTables({ member: false, roleProfile: 'all', orgPlan: 'hub', personalPlanKey: null });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual([]);
      // The org layer rides the membership embed, so no separate table reads.
      expect(mock.from).not.toHaveBeenCalledWith('org_roles');
      expect(mock.from).not.toHaveBeenCalledWith('organizations');
      expect(mock.from).not.toHaveBeenCalledWith('org_seat_assignments');
    });

    it('returns personal plan features when not in org context', async () => {
      mockTables({ personalPlanKey: 'ace' });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz', 'stats.insights']);
      // No active org → the org layer (and the membership read) is skipped.
      expect(mock.from).not.toHaveBeenCalledWith('org_members');
    });

    it('applies the whole personal plan outside an org, including org-scoped keys', async () => {
      mockTables({ personalPlanKey: 'hub' });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual([
        'ai.chat',
        'flashcards',
        'quiz',
        'quiz.templates',
        'stats.insights',
        'branding',
      ]);
    });

    it('resolves nothing when the org role is missing (no role = ∅)', async () => {
      const ctx = { ...baseCtx, activeOrgId: 'org-1', orgRoleId: null };
      mockTables({ roleProfile: 'all', orgPlan: 'hub', personalPlanKey: null });

      const { entitlements } = await resolver.resolveEntitlements(ctx);
      expect(entitlements).toEqual([]);
      expect(mock.from).not.toHaveBeenCalledWith('org_seat_assignments');
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
        'quiz.templates',
        'stats.insights',
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
      mockTables({ personalPlanKey: 'base' });
      const baseImpl: (table: string) => Record<string, unknown> = vi
        .mocked(mock.from)
        .getMockImplementation()!;
      let selected: string | null = null;
      mock.from.mockImplementation((table: string) => {
        const c = baseImpl(table);
        if (table === 'user_feature_overrides') {
          c.select = vi.fn((columns: string) => {
            selected = columns;
            return c;
          });
        }
        return c;
      });

      await resolver.resolveEntitlements(baseCtx);
      expect(selected).toContain('expires_at');
    });

    it('returns empty when no entitlement source yields features', async () => {
      mockTables({ personalPlanKey: 'base', planEntitlements: { base: [] } });

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
          { key: 'stats.insights', is_enabled: true },
        ],
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['flashcards', 'quiz', 'stats.insights']);
      expect(sources.flagsOff).toEqual(['ai.chat']);
    });

    it('removes a surface key whose flag row is missing (fail closed, D8)', async () => {
      mockTables({
        personalPlanKey: 'ace',
        // Only `ai.chat` has a row; `stats.insights` is missing → removed.
        flags: [{ key: 'ai.chat', is_enabled: true }],
      });

      const { entitlements, sources } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toEqual(['ai.chat', 'flashcards', 'quiz']);
      expect(sources.flagsOff).toEqual(['stats.insights']);
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
      mockTables({
        personalPlanKey: 'ace',
        planLimits: {
          ace: {
            max_flashcards: -1,
            max_quiz_attempts_per_day: -1,
            max_ai_tokens_per_day: 0,
          },
        },
      });

      const { entitlements, limits } = await resolver.resolveEntitlements(baseCtx);
      // `ai.chat` is granted by the plan but its quota is 0 → not effective.
      expect(entitlements).toEqual(['flashcards', 'quiz', 'stats.insights']);
      expect(limits.max_ai_tokens_per_day).toBe(0);
    });

    it('keeps the entitlement when its quota is unlimited (-1)', async () => {
      mockTables({ personalPlanKey: 'ace' });

      const { entitlements } = await resolver.resolveEntitlements(baseCtx);
      expect(entitlements).toContain('ai.chat');
    });

    it('requireEntitlement: resolves an effective key, rejects FORBIDDEN outside the resolved set and for a quota-0 key', async () => {
      // `ai.chat` is absent from the fixture because its quota resolved to 0:
      // a quota-0 key never reaches the resolved set (§6.1), so
      // requireEntitlement must reject it exactly like any other non-effective
      // key.
      const fixture: ResolvedEntitlements = {
        entitlements: ['flashcards', 'quiz', 'stats.insights'],
        limits: {},
        sources: {
          org: null,
          seat: null,
          personal: { planKey: 'ace', origin: 'personal' },
          overrides: [],
          revokedOverrides: [],
          flagsOff: [],
        },
        plan: { primary: 'ace', sources: [{ planKey: 'ace', origin: 'personal' }] },
      };
      const spy = vi.spyOn(entitlementResolver, 'resolveEntitlements').mockResolvedValue(fixture);

      await expect(requireEntitlement(baseCtx, 'flashcards')).resolves.toBeUndefined();

      const outside = await requireEntitlement(baseCtx, 'quiz.templates').catch((e: unknown) => e);
      expect(outside).toBeInstanceOf(AppError);
      expect(outside).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

      await expect(requireEntitlement(baseCtx, 'ai.chat')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });

      expect(spy).toHaveBeenCalledTimes(3);
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
      const retryResolver = new EntitlementResolver(flakyFactory);
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
