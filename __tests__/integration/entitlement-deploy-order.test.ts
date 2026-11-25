import { AccountType, type RequestContext } from '@studiq/authz';
import { EntitlementResolver } from '@studiq/server/services/entitlement.resolver';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  seedOrgMembership,
  seedOrganization,
  setOrgPlan,
} from '#test/integration/helpers';

/**
 * ADR-0015 phase 8 (D23), the deploy-order cells the resolver's contract makes
 * decidable against a real database. They pin the two properties that let a key
 * be added as data without a per-entity backfill:
 *
 *  - **DB ahead of code is inert.** An unknown key in `user_feature_overrides`
 *    (cell F) is ignored exactly like the plan-row case the unit suite covers
 *    (`entitlement.resolver.test.ts`): every reader filters through
 *    `isEntitlementKey`, so nothing reaches `ENTITLEMENTS[key]`.
 *  - **A plan change backfills with no prune job** (cell D). The org layer is
 *    derived per request, so a plan that gains a key serves it on the next
 *    resolution — no row per org, no cache flush, no restart.
 *
 * `entitlement_catalog` is deliberately not written here: `catalog-invariants`
 * asserts the DB set against `ENTITLEMENTS` and runs in a parallel file, so a
 * temporary row would be a cross-file race. The catalog-row cases are unit
 * tests; the flag/override rows below are safe (the invariant only asserts that
 * every TS surface key has a flag row).
 */
const UNKNOWN_KEY = 'test.deploy.unknown';
/** A shipped seed account; `student3@dev.local` has no org of its own. */
const USER_ID = '00000000-0000-4000-8001-000000000006';

const HUB_CEILING = [
  'ai.chat',
  'flashcards',
  'quiz',
  'quiz.templates',
  'stats.insights',
  'branding',
];

describe('entitlement deploy order (phase 8 matrix)', () => {
  let service: SupabaseClient<Database>;
  let resolver: EntitlementResolver;
  let orgId: string;
  let adminRoleId: string;

  const ctx = (roleId: string): RequestContext => ({
    userId: USER_ID,
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: orgId,
    orgRoleId: roleId,
    groupIds: [],
    permissionScopes: {},
  });

  beforeAll(async () => {
    service = createServiceClient();
    // The resolver only reads; the service role keeps this test about
    // resolution rather than RLS (the RLS twin has its own suite).
    resolver = new EntitlementResolver(() => Promise.resolve(service));

    const seeded = await seedOrganization('qa-phase8-deploy-order');
    orgId = seeded.org.id;
    adminRoleId = seeded.adminRoleId;
    await seedOrgMembership({ organizationId: orgId, userId: USER_ID, orgRoleId: adminRoleId });
  });

  afterAll(async () => {
    await service.from('user_feature_overrides').delete().eq('feature_key', UNKNOWN_KEY);
    await service.from('entitlement_flags').delete().eq('key', UNKNOWN_KEY);
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('a plan change backfills the new plan’s keys with no prune job (cell D)', async () => {
    const launch = await resolver.resolveEntitlements(ctx(adminRoleId));
    expect(launch.entitlements).toEqual(['flashcards', 'quiz']);
    expect(launch.sources.org).toEqual({ planKey: 'launch', origin: 'org' });

    await setOrgPlan(orgId, 'hub');

    const hub = await resolver.resolveEntitlements(ctx(adminRoleId));
    expect(hub.entitlements).toEqual(HUB_CEILING);
    expect(hub.sources.org).toEqual({ planKey: 'hub', origin: 'org' });
  });

  it('ignores an unknown override key on a real row (cell F: DB ahead of code)', async () => {
    // `entitlement_flags` has no FK to the catalog, so this row can exist for a
    // key the TS catalog has never heard of — the shape an early deploy leaves.
    const { error: flagError } = await service
      .from('entitlement_flags')
      .upsert({ key: UNKNOWN_KEY, name: 'Deploy-order probe', is_enabled: true });
    if (flagError) throw new Error(flagError.message);
    const { error: overrideError } = await service
      .from('user_feature_overrides')
      .upsert({ user_id: USER_ID, feature_key: UNKNOWN_KEY, is_enabled: true });
    if (overrideError) throw new Error(overrideError.message);

    const resolved = await resolver.resolveEntitlements(ctx(adminRoleId));
    expect(resolved.entitlements).toEqual(HUB_CEILING);
    expect(resolved.entitlements).not.toContain(UNKNOWN_KEY);
    expect(resolved.sources.overrides).toEqual([]);
  });
});
