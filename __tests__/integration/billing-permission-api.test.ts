import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { Database } from '@studiq/server/types/database';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentGateway } from '@studiq/server/lib/payment/payment-gateway';
import { success } from '@studiq/server/lib/service-result';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import { POST as changePlan } from '@/app/(backend)/api/v1/billing/change-plan/route';
import { POST as cancelSubscription } from '@/app/(backend)/api/v1/billing/cancel/route';
import { POST as reconcileCheckout } from '@/app/(backend)/api/v1/billing/reconcile/route';
import { POST as releaseScheduledPlan } from '@/app/(backend)/api/v1/billing/release-scheduled-plan/route';
import { GET as getSubscription } from '@/app/(backend)/api/v1/billing/subscription/route';

/**
 * ADR-0015 §4.1/§7 and R4: the billing actions authorize on
 * `org.billing.manage`, not on the system `admin` role name the service used to
 * re-check. This file drives the real route handlers through the real
 * `withAuth`, controller and service with real signed-in sessions, so the
 * permission scopes are the ones `withAuth` builds.
 *
 * Only the provider is replaced: the fake gateway reports `driver: 'stripe'` and
 * records the call, while the customer/subscription/catalog reads and the
 * pending-plan write stay real. That is what lets the cases assert both the
 * authority and the absence of a plan change.
 *
 * The RLS twin is `control-plane-permission-rls.test.ts` (a Billing-preset role
 * reads the org's subscription row, a Member-role manager does not).
 */

const PASSWORD = 'BillingPerm!';

const { fakeGateway } = vi.hoisted(() => ({
  fakeGateway: {
    driver: 'stripe' as const,
    livemode: false,
    createCheckoutSession: vi.fn<PaymentGateway['createCheckoutSession']>(),
    createPortalSession: vi.fn<PaymentGateway['createPortalSession']>(),
    changePlan: vi.fn<PaymentGateway['changePlan']>(),
    cancelAtPeriodEnd: vi.fn<PaymentGateway['cancelAtPeriodEnd']>(),
    releaseScheduledPlan: vi.fn<PaymentGateway['releaseScheduledPlan']>(),
    reconcileCheckout: vi.fn<PaymentGateway['reconcileCheckout']>(),
    handleWebhook: vi.fn<PaymentGateway['handleWebhook']>(),
  },
}));

vi.mock('@studiq/server/lib/payment/payment-gateway.factory', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@studiq/server/lib/payment/payment-gateway.factory')>();
  return { ...actual, getPaymentGateway: () => fakeGateway };
});

interface Session {
  build: () => SupabaseClient<Database>;
}

async function signIn(user: TestUserFixture): Promise<Session> {
  const jar = new Map<string, string>();
  const build = () =>
    createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookiesToSet) => {
            for (const { name, value } of cookiesToSet) jar.set(name, value);
          },
        },
      },
    );

  const { error } = await build().auth.signInWithPassword({
    email: user.email,
    password: PASSWORD,
  });
  if (error) throw new Error(`[setup] signIn failed for ${user.email}: ${error.message}`);
  return { build };
}

/** Route handlers that read a JSON body. */
function post(session: Session, body: unknown, orgId: string) {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  return createNextRequest(
    'http://localhost',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { active_org_id: orgId },
  );
}

function postWithoutBody(session: Session, orgId: string) {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  return createNextRequest('http://localhost', { method: 'POST' }, { active_org_id: orgId });
}

function get(session: Session, orgId: string) {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  return createNextRequest('http://localhost', { method: 'GET' }, { active_org_id: orgId });
}

async function call(
  request: ReturnType<typeof createNextRequest>,
  handler: (req: ReturnType<typeof createNextRequest>) => Promise<Response>,
): Promise<{ status: number; body: unknown }> {
  const response = await handler(request);
  return { status: response.status, body: await response.json() };
}

describe('billing actions require org.billing.manage (2b-4)', () => {
  const service = createTypedServiceClient();
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let orgId: string;
  let billingRoleId: string;
  let orgPlanBefore: string;

  const createdUserIds: string[] = [];
  let billingUser: TestUserFixture;
  let memberUser: TestUserFixture;
  let adminUser: TestUserFixture;
  let billing: Session;
  let member: Session;
  let admin: Session;

  async function customRole(name: string, keys: string[]): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: orgId, name, display_name: name, is_system: false })
      .select('id')
      .single();
    if (error) throw new Error(`role ${name}: ${error.message}`);

    const { error: permissionError } = await service
      .from('org_role_permissions')
      .insert(
        keys.map((key) => ({ org_role_id: role.id, permission_key: key, scope: 'organization' })),
      );
    if (permissionError) throw new Error(`permissions ${name}: ${permissionError.message}`);
    return role.id;
  }

  beforeAll(async () => {
    const org = await seedOrganization(`billing-perm-${tag}`);
    orgId = org.org.id;
    orgPlanBefore = (await service.from('organizations').select('plan').eq('id', orgId).single())
      .data!.plan;

    // D17's Billing preset.
    billingRoleId = await customRole(`billing-${tag}`, ['org.billing.manage', 'org.seat.manage']);

    billingUser = await createTestUser({ role: 'manager', password: PASSWORD });
    memberUser = await createTestUser({ role: 'manager', password: PASSWORD });
    adminUser = await createTestUser({ role: 'manager', password: PASSWORD });
    createdUserIds.push(billingUser.id, memberUser.id, adminUser.id);

    await seedOrgMembership({
      organizationId: orgId,
      userId: billingUser.id,
      orgRoleId: billingRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: memberUser.id,
      orgRoleId: org.memberRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: adminUser.id,
      orgRoleId: org.adminRoleId,
    });

    const { data: customer, error: customerError } = await service
      .from('billing_customers')
      .insert({
        organization_id: orgId,
        stripe_customer_id: `cus_billing_perm_${tag}`,
        livemode: false,
      })
      .select('id')
      .single();
    if (customerError) throw new Error(`customer: ${customerError.message}`);

    const { error: subscriptionError } = await service.from('billing_subscriptions').insert({
      stripe_subscription_id: `sub_billing_perm_${tag}`,
      billing_customer_id: customer.id,
      organization_id: orgId,
      plan_key: 'hub',
      price_id: `price_hub_${tag}`,
      status: 'active',
      livemode: false,
    });
    if (subscriptionError) throw new Error(`subscription: ${subscriptionError.message}`);

    const { error: priceError } = await service.from('stripe_prices').insert({
      plan_key: 'campus',
      billing_cycle: 'monthly',
      stripe_price_id: `price_campus_${tag}`,
      currency: 'PLN',
      unit_amount: 69900,
      interval: 'month',
      livemode: false,
      active: true,
    });
    if (priceError) throw new Error(`price: ${priceError.message}`);

    billing = await signIn(billingUser);
    member = await signIn(memberUser);
    admin = await signIn(adminUser);
  });

  afterAll(async () => {
    await service.from('stripe_prices').delete().eq('stripe_price_id', `price_campus_${tag}`);
    await service.from('billing_subscriptions').delete().eq('organization_id', orgId);
    await service.from('billing_customers').delete().eq('organization_id', orgId);
    await cleanupOrganizationDeep(orgId).catch(() => {});
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakeGateway.changePlan.mockResolvedValue(success({ status: 'applied' }));
    fakeGateway.cancelAtPeriodEnd.mockResolvedValue(success({ cancelAtPeriodEnd: true }));
    fakeGateway.releaseScheduledPlan.mockResolvedValue(
      success({ released: true, currentPlanKey: 'hub' }),
    );
    fakeGateway.reconcileCheckout.mockResolvedValue(success({ status: 'applied', planKey: 'hub' }));
  });

  async function subscriptionState() {
    const { data } = await service
      .from('billing_subscriptions')
      .select('plan_key, pending_plan_key')
      .eq('organization_id', orgId)
      .single();
    const org = (await service.from('organizations').select('plan').eq('id', orgId).single()).data;
    return { planKey: data?.plan_key, pendingPlanKey: data?.pending_plan_key, orgPlan: org?.plan };
  }

  it('lets the Billing preset read the org subscription and advertises the actions', async () => {
    const { status, body } = await call(get(billing, orgId), getSubscription);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        billedPlanKey: 'hub',
        status: 'active',
        canChangePlan: true,
        canCancel: true,
      },
    });
  });

  it('reads the same model for a Member-role manager without advertising actions', async () => {
    // RLS gives this caller no org row (the RLS twin pins that); the endpoint
    // still answers, it just cannot offer an action the write routes refuse.
    const { status, body } = await call(get(member, orgId), getSubscription);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: { billedPlanKey: null, canChangePlan: false, canCancel: false },
    });
  });

  it('lets the Billing preset and the Admin role change the plan', async () => {
    for (const session of [billing, admin]) {
      const { status } = await call(post(session, { planKey: 'campus' }, orgId), changePlan);
      expect(status).toBe(200);
    }

    expect(fakeGateway.changePlan).toHaveBeenCalledTimes(2);
    const [planChange] = fakeGateway.changePlan.mock.calls[0] ?? [];
    expect(planChange).toMatchObject({
      owner: { type: 'org', orgId },
      currentPlanKey: 'hub',
      targetPlanKey: 'campus',
      direction: 'upgrade',
    });
  });

  it('refuses a Member-role manager (403) without changing the plan', async () => {
    const before = await subscriptionState();

    const { status } = await call(post(member, { planKey: 'campus' }, orgId), changePlan);

    expect(status).toBe(403);
    expect(fakeGateway.changePlan).not.toHaveBeenCalled();
    expect(await subscriptionState()).toEqual(before);
    expect(before.planKey).toBe('hub');
    expect(before.orgPlan).toBe(orgPlanBefore);
  });

  it('gates cancel on the same key', async () => {
    const refused = await call(post(member, { cancel: true }, orgId), cancelSubscription);
    expect(refused.status).toBe(403);

    const allowed = await call(post(billing, { cancel: true }, orgId), cancelSubscription);
    expect(allowed.status).toBe(200);
    expect(fakeGateway.cancelAtPeriodEnd).toHaveBeenCalledTimes(1);
  });

  it('gates the body-less release-scheduled-plan on the same key', async () => {
    const refused = await call(postWithoutBody(member, orgId), releaseScheduledPlan);
    expect(refused.status).toBe(403);

    const allowed = await call(postWithoutBody(billing, orgId), releaseScheduledPlan);
    expect(allowed.status).toBe(200);
    expect(fakeGateway.releaseScheduledPlan).toHaveBeenCalledTimes(1);
  });

  it('gates reconcile on the same key', async () => {
    const refused = await call(post(member, { sessionId: `cs_${tag}` }, orgId), reconcileCheckout);
    expect(refused.status).toBe(403);

    const allowed = await call(post(billing, { sessionId: `cs_${tag}` }, orgId), reconcileCheckout);
    expect(allowed.status).toBe(200);
    expect(fakeGateway.reconcileCheckout).toHaveBeenCalledTimes(1);
  });
});
