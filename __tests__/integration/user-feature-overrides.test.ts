import type { RequestContext } from '@studiq/authz';
import { FeatureResolver } from '@studiq/server/services/feature.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';
import { createTestUser } from '#test/helpers/test-user';

// Issue #382: `user_feature_overrides.expires_at` must be honoured. This suite
// exercises the real `timestamptz` round-trip — a unit mock can only prove the
// JS filter, not that `expires_at` is actually selected and parsed — and pins
// both directions: an expired grant no longer grants, an expired revoke no
// longer revokes.
describe('User feature override expiry', () => {
  // The resolver runs on the service client here: RLS for own-reads is covered
  // by rls-tenant-isolation.test.ts / org-role-features-rls.test.ts, this suite
  // is about expiry semantics. The tenant seeder provides the account, so the
  // suite does not depend on the dev SQL seed.
  let userId: string;
  const REASON = 'test-#382-expiry';
  const DAY_MS = 24 * 60 * 60 * 1000;

  let service!: SupabaseClient;
  let resolver!: FeatureResolver;

  beforeAll(async () => {
    const student = await createTestUser({ role: 'student' });
    userId = student.id;
  });

  // A fresh student: personal plan `base` (flashcards, quiz), no active org
  // in this ctx → the plan fallback is the only entitlement source.
  function ctx(): RequestContext {
    return {
      traceId: 'override-expiry',
      userId,
      accountType: 'STUDENT',
      activeOrgId: null,
      orgRoleId: null,
      url: '/api/v1/features/me',
      method: 'GET',
      groupIds: [],
      permissionScopes: {},
    };
  }

  async function clearOverrides(): Promise<void> {
    await service
      .from('user_feature_overrides')
      .delete()
      .eq('user_id', userId)
      .eq('reason', REASON);
  }

  async function setOverride(
    featureKey: string,
    isEnabled: boolean,
    expiresAt: string | null,
  ): Promise<void> {
    const { error } = await service.from('user_feature_overrides').upsert(
      {
        user_id: userId,
        feature_key: featureKey,
        is_enabled: isEnabled,
        reason: REASON,
        expires_at: expiresAt,
      },
      { onConflict: 'user_id,feature_key' },
    );
    if (error) throw new Error(`override upsert failed: ${error.message}`);
  }

  /** ISO timestamp `offsetMs` away from now, in both directions. */
  function fromNow(offsetMs: number): string {
    return new Date(Date.now() + offsetMs).toISOString();
  }

  beforeEach(async () => {
    service = createServiceClient();
    resolver = new FeatureResolver(async () => service);
    await clearOverrides();
  });

  afterEach(async () => {
    await clearOverrides();
  });

  it('resolves the base plan baseline without overrides', async () => {
    await expect(resolver.getEnabledFeatures(ctx())).resolves.toEqual(['flashcards', 'quiz']);
  });

  it('ignores an expired grant stored as a real timestamptz', async () => {
    await setOverride('ai.chat', true, fromNow(-9 * DAY_MS));

    await expect(resolver.getEnabledFeatures(ctx())).resolves.toEqual(['flashcards', 'quiz']);
  });

  it('applies a grant whose expiry is still in the future', async () => {
    await setOverride('ai.chat', true, fromNow(DAY_MS));

    await expect(resolver.getEnabledFeatures(ctx())).resolves.toContain('ai.chat');
  });

  it('ignores an expired revoke', async () => {
    await setOverride('quiz', false, fromNow(-DAY_MS));

    await expect(resolver.getEnabledFeatures(ctx())).resolves.toEqual(['flashcards', 'quiz']);
  });

  it('applies a revoke whose expiry is still in the future', async () => {
    await setOverride('quiz', false, fromNow(DAY_MS));

    await expect(resolver.getEnabledFeatures(ctx())).resolves.toEqual(['flashcards']);
  });

  it('keeps permanent overrides working (expires_at NULL)', async () => {
    await setOverride('ai.chat', true, null);
    await setOverride('quiz', false, null);

    await expect(resolver.getEnabledFeatures(ctx())).resolves.toEqual(['ai.chat', 'flashcards']);
  });

  it('enforces expiry through requireFeature as well as features/me', async () => {
    await setOverride('ai.chat', true, fromNow(-DAY_MS));

    const result = await resolver.requireFeature(ctx(), 'ai.chat');
    expect(result.success).toBe(false);
    expect(result.error).toBe('FORBIDDEN');
  });
});
