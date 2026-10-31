import { AccountType, type RequestContext } from '@studiq/authz';
import { LimitsResolver } from '@studiq/server/services/limits.resolver';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, seedViaApi, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
  seedOrgMembership,
  seedOrganization,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as personalPlanGet } from '@/app/(backend)/api/v1/me/personal-plan/route';
import { GET as myPlanGet } from '@/app/(backend)/api/v1/me/plan/route';
import { POST as webhookPost } from '@/app/(backend)/api/v1/stripe/webhook/route';

/**
 * #228 — managers have no paid personal plan. An organization purchase changes
 * only the organization: the buyer's `profiles.personal_plan_key` stays the free
 * manager tier (`launch`), `/me/plan` follows the active organization, and the
 * manager's stale personal plan can never widen another organization's limits.
 */
const BASE_URL = 'http://localhost';

const service = createServiceClient();
const resolver = new LimitsResolver(async () => service);

let manager: TestUserFixture;
let boughtOrgId: string;
let otherOrgId: string;
const createdOrgIds: string[] = [];

async function completeOrgCheckout(orgId: string, planId: string, sessionId: string) {
  mockUser(manager);
  return webhookPost(
    createNextRequest(`${BASE_URL}/api/v1/stripe/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'checkout.session.completed',
        session_id: sessionId,
        plan_id: planId,
        // The mock webhook requires the authenticated caller's id (#227).
        user_id: manager.id,
        org_id: orgId,
      }),
    }),
  );
}

async function planKey(handler: (req: NextRequest) => Promise<Response>, activeOrgId?: string) {
  mockUser(manager);
  const res = await handler(
    createNextRequest(
      `${BASE_URL}/api/v1/me/plan`,
      undefined,
      activeOrgId ? { active_org_id: activeOrgId } : undefined,
    ),
  );
  const body = await res.json();
  return { status: res.status, key: body.data?.key as string | undefined };
}

function managerCtx(activeOrgId: string | null): RequestContext {
  return {
    traceId: 'mgr-228',
    userId: manager.id,
    accountType: AccountType.MANAGER,
    activeOrgId,
    orgRoleId: null,
    url: '/api/v1/flashcards',
    method: 'POST',
    groupIds: [],
    permissionScopes: {},
  };
}

describe('manager plan model (#228)', () => {
  const tag = `${Date.now()}`;

  beforeAll(async () => {
    manager = await createTestUser({ role: 'manager' });

    // The organization that buys an org plan …
    const seeded = await seedViaApi(manager, { org: `mgr-228-bought-${tag}` });
    boughtOrgId = seeded.orgId!;
    createdOrgIds.push(boughtOrgId);

    // … and a second organization the manager administers, which stays on the
    // free `launch` plan.
    const other = await seedOrganization(`mgr-228-other-${tag}`);
    otherOrgId = other.org.id;
    createdOrgIds.push(otherOrgId);
    await seedOrgMembership({
      organizationId: otherOrgId,
      userId: manager.id,
      orgRoleId: other.adminRoleId,
    });

    await service.from('payments').delete().eq('user_id', manager.id);
  });

  afterAll(async () => {
    if (manager?.id) {
      await service.from('payments').delete().eq('user_id', manager.id);
    }
    for (const orgId of createdOrgIds) {
      await cleanupOrganizationDeep(orgId).catch(() => {});
    }
    if (manager?.id) {
      await service.auth.admin.deleteUser(manager.id).catch(() => {});
    }
  });

  it('changes only the organization on an org purchase (#228)', async () => {
    const res = await completeOrgCheckout(boughtOrgId, 'hub', `mgr228-${tag}`);
    expect(res.status).toBe(200);

    const { data: org } = await service
      .from('organizations')
      .select('plan')
      .eq('id', boughtOrgId)
      .single();
    expect(org?.plan).toBe('hub');

    const { data: profile } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', manager.id)
      .single();
    expect(profile?.personal_plan_key).toBe('launch');

    const { data: payments } = await service
      .from('payments')
      .select('organization_id, plan_key')
      .eq('user_id', manager.id);
    expect(payments).toContainEqual({ organization_id: boughtOrgId, plan_key: 'hub' });
  });

  it('resolves /me/plan from the active organization and /me/personal-plan from the free tier', async () => {
    const bought = await planKey(myPlanGet, boughtOrgId);
    expect(bought.status).toBe(200);
    expect(bought.key).toBe('hub');

    const other = await planKey(myPlanGet, otherOrgId);
    expect(other.key).toBe('launch');

    // An organization purchase never becomes the buyer's personal plan.
    const personalBought = await planKey(personalPlanGet, boughtOrgId);
    expect(personalBought.key).toBe('launch');
    const personalOther = await planKey(personalPlanGet, otherOrgId);
    expect(personalOther.key).toBe('launch');
  });

  it('never lets a stale personal org plan widen another organization limit (#228)', async () => {
    // Simulate the legacy data the old webhook wrote: Campus (unlimited) left in
    // the manager's personal plan. The resolver must still use the active org's
    // `launch` plan.
    await service.from('profiles').update({ personal_plan_key: 'campus' }).eq('id', manager.id);

    await expect(
      resolver.getEffectiveLimit(managerCtx(otherOrgId), 'max_flashcards'),
    ).resolves.toBe(100);

    // The dirty row is also inert on the personal-plan read path.
    const personal = await planKey(personalPlanGet, otherOrgId);
    expect(personal.key).toBe('launch');
  });
});
