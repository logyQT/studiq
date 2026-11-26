import { createClient } from '@supabase/supabase-js';
import { AccountType, type RequestContext } from '@studiq/authz';
import { EntitlementResolver } from '@studiq/server/services/entitlement.resolver';
import type { Database } from '@studiq/server/types/database';
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson, json } from '#test/helpers/json';
import { createTestUser, seedViaApi, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  mockUser,
  seedOrgMembership,
  seedOrganization,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as personalPlanGet } from '@/app/(backend)/api/v1/me/personal-plan/route';
import { GET as myPlanGet } from '@/app/(backend)/api/v1/me/plan/route';
import { POST as webhookPost } from '@/app/(backend)/api/v1/stripe/webhook/route';

/**
 * #228 + ADR-0007 — a manager is an organization buyer and holds no personal
 * plan at all. An organization purchase changes only the organization: the
 * buyer's `profiles.personal_plan_key` stays NULL, `/me/plan` follows the active
 * organization for a member who may bill it (`org.billing.manage`),
 * `/me/personal-plan` answers NOT_FOUND, and an organization-scope plan left on
 * a profile never widens another organization's limits.
 */
const BASE_URL = 'http://localhost';

// Database-typed: `EntitlementResolver` takes a factory that hands back the typed client.
const service = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const resolver = new EntitlementResolver(() => Promise.resolve(service));

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
  const body = await json<{ data?: { key?: string } }>(res);
  return { status: res.status, key: body.data?.key };
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
    const other = asJson<{ org: { id: string }; adminRoleId: string }>(
      await seedOrganization(`mgr-228-other-${tag}`),
    );
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
    await service.from('payments').delete().eq('user_id', manager.id);
    for (const orgId of createdOrgIds) {
      await cleanupOrganizationDeep(orgId).catch(() => {});
    }
    await service.auth.admin.deleteUser(manager.id).catch(() => {});
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
      .select('personal_plan_key, account_type')
      .eq('id', manager.id)
      .single();
    // handle_new_user mints no personal plan for a manager (ADR-0007).
    expect(profile?.personal_plan_key).toBeNull();
    expect(profile?.account_type).toBe('manager');

    const { data: payments } = await service
      .from('payments')
      .select('organization_id, plan_key')
      .eq('user_id', manager.id);
    expect(payments).toContainEqual({ organization_id: boughtOrgId, plan_key: 'hub' });
  });

  it('resolves /me/plan from the active organization and no personal plan at all', async () => {
    // The org creator holds the Admin role, which carries org.billing.manage.
    const bought = await planKey(myPlanGet, boughtOrgId);
    expect(bought.status).toBe(200);
    expect(bought.key).toBe('hub');

    const other = await planKey(myPlanGet, otherOrgId);
    expect(other.key).toBe('launch');

    // An organization purchase never becomes the buyer's personal plan, and a
    // manager has none to return: the endpoint answers NOT_FOUND.
    const personalBought = await planKey(personalPlanGet, boughtOrgId);
    expect(personalBought.status).toBe(404);
    expect(personalBought.key).toBeUndefined();
    const personalOther = await planKey(personalPlanGet, otherOrgId);
    expect(personalOther.status).toBe(404);
  });

  it('resolves /me/plan to the personal plan for an org member without org.billing.manage (D34)', async () => {
    const student = await createTestUser({ role: 'student' });
    try {
      const { data: memberRole } = await service
        .from('org_roles')
        .select('id')
        .eq('organization_id', otherOrgId)
        .eq('name', 'member')
        .single();
      await seedOrgMembership({
        organizationId: otherOrgId,
        userId: student.id,
        orgRoleId: memberRole!.id,
      });

      mockUser(student);
      const res = await myPlanGet(
        createNextRequest(`${BASE_URL}/api/v1/me/plan`, undefined, { active_org_id: otherOrgId }),
      );
      const body = await json<{ data?: { key?: string } }>(res);
      expect(res.status).toBe(200);
      // No seat, no org.billing.manage → the personal plan (base for a student).
      expect(body.data?.key).toBe('free');
    } finally {
      await service.auth.admin.deleteUser(student.id).catch(() => {});
    }
  });

  it('never lets an organization-scope personal plan widen another organization limit (#228, D34)', async () => {
    // Simulate the legacy data the old webhook wrote: Campus (unlimited,
    // scope='organization') left in the manager's personal plan. Inside a
    // verified org the resolver must not apply it — the active org's `launch`
    // plan is the whole org layer.
    await service.from('profiles').update({ personal_plan_key: 'campus' }).eq('id', manager.id);

    const { limits, sources } = await resolver.resolveEntitlements(managerCtx(otherOrgId));
    expect(limits.max_flashcards).toBe(100);
    expect(sources.personal).toBeNull();

    // The read path returns the stored row verbatim; the manager rule lives on
    // the write/checkout paths, which never mint such a row.
    const personal = await planKey(personalPlanGet, otherOrgId);
    expect(personal.key).toBe('campus');

    await service.from('profiles').update({ personal_plan_key: null }).eq('id', manager.id);
  });
});
