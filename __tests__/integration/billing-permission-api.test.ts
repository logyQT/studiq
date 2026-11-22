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
import { firstCall } from '#test/mocks/recorded';
import { POST as changePlan } from '@/app/(backend)/api/v1/billing/change-plan/route';
import { POST as cancelSubscription } from '@/app/(backend)/api/v1/billing/cancel/route';
import { POST as reconcileCheckout } from '@/app/(backend)/api/v1/billing/reconcile/route';
import { POST as releaseScheduledPlan } from '@/app/(backend)/api/v1/billing/release-scheduled-plan/route';
import { GET as getSubscription } from '@/app/(backend)/api/v1/billing/subscription/route';
import { POST as createCheckoutSession } from '@/app/(backend)/api/v1/stripe/create-checkout-session/route';

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
  let billingEducator: TestUserFixture;
  let billing: Session;
  let member: Session;
  let admin: Session;
  let educator: Session;
  /** A second org where the Billing-preset holder may bill, while org A is active. */
  let orgBId: string;
  let billingRoleBId: string;

  async function customRole(
    name: string,
    keys: string[],
    organizationId: string = orgId,
  ): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: organizationId, name, display_name: name, is_system: false })
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
    // An EDUCATOR persona on the Billing preset: the persona must not decide
    // the billing owner (operator decision 2026-11-22, phase 5b row 7).
    billingEducator = await createTestUser({ role: 'educator', password: PASSWORD });
    createdUserIds.push(billingUser.id, memberUser.id, adminUser.id, billingEducator.id);

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
    await seedOrgMembership({
      organizationId: orgId,
      userId: billingEducator.id,
      orgRoleId: billingRoleId,
    });

    // A second org the Billing-preset holder may bill (org B), so the checkout
    // can be resolved for a target org that is not the active one.
    const orgB = await seedOrganization(`billing-perm-b-${tag}`);
    orgBId = orgB.org.id;
    billingRoleBId = await customRole(
      `billing-b-${tag}`,
      ['org.billing.manage', 'org.seat.manage'],
      orgBId,
    );
    await seedOrgMembership({
      organizationId: orgBId,
      userId: billingUser.id,
      orgRoleId: billingRoleBId,
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
    educator = await signIn(billingEducator);
  });

  afterAll(async () => {
    await service.from('stripe_prices').delete().eq('stripe_price_id', `price_campus_${tag}`);
    await service.from('billing_subscriptions').delete().eq('organization_id', orgId);
    await service.from('billing_customers').delete().eq('organization_id', orgId);
    await cleanupOrganizationDeep(orgId).catch(() => {});
    await cleanupOrganizationDeep(orgBId).catch(() => {});
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fakeGateway.changePlan.mockResolvedValue(success({ status: 'applied' }));
    fakeGateway.cancelAtPeriodEnd.mockResolvedValue(
      success({ cancelAtPeriodEnd: true, releasedSchedule: false }),
    );
    fakeGateway.releaseScheduledPlan.mockResolvedValue(
      success({ released: true, currentPlanKey: 'hub' }),
    );
    fakeGateway.reconcileCheckout.mockResolvedValue(success({ activated: true }));
  });

  async function subscriptionState() {
    const { data } = await service
      .from('billing_subscriptions')
      .select('plan_key, pending_plan_key, cancel_at_period_end, status')
      .eq('organization_id', orgId)
      .single();
    const org = (await service.from('organizations').select('plan').eq('id', orgId).single()).data;
    return {
      planKey: data?.plan_key,
      pendingPlanKey: data?.pending_plan_key,
      cancelAtPeriodEnd: data?.cancel_at_period_end,
      status: data?.status,
      orgPlan: org?.plan,
    };
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

  it('lets an EDUCATOR persona holding the Billing preset resolve the org subscription (owner is the permission, not the persona)', async () => {
    // Phase 5b row 7: `ownerFromContext` is org iff the caller holds
    // `org.billing.manage` in the active org — a student/educator on the
    // Billing preset reaches the org row through the same RLS branch.
    const { status, body } = await call(get(educator, orgId), getSubscription);

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

  it('does not act on the org subscription on cancel without org.billing.manage (personal owner answers 404)', async () => {
    // Operator decision 2026-11-22 (ADR-0015 phase 5b): `ownerFromContext`
    // returns the org owner only when the caller holds `org.billing.manage` in
    // the active org. A member without the key is a personal owner, so cancel
    // resolves their personal subscription, finds none and answers 404 — the
    // org subscription is never touched (a 403 would mean the org owner was
    // resolved and then refused, the 2b-4 model).
    const before = await subscriptionState();
    expect(before.status).toBe('active');
    expect(before.cancelAtPeriodEnd).toBe(false);

    const personal = await call(post(member, { cancel: true }, orgId), cancelSubscription);

    expect(personal.status).toBe(404);
    expect(fakeGateway.cancelAtPeriodEnd).not.toHaveBeenCalled();
    expect(await subscriptionState()).toEqual(before);

    const allowed = await call(post(billing, { cancel: true }, orgId), cancelSubscription);
    expect(allowed.status).toBe(200);
    expect(fakeGateway.cancelAtPeriodEnd).toHaveBeenCalledTimes(1);
    expect(firstCall(fakeGateway.cancelAtPeriodEnd)[0].owner).toEqual({
      type: 'org',
      orgId,
      userId: billingUser.id,
      accountType: 'manager',
    });
  });

  it('does not act on the org subscription on release-scheduled-plan without org.billing.manage (personal owner answers 404)', async () => {
    // Same operator decision 2026-11-22 as the cancel case: without the key the
    // caller is a personal owner, there is no personal subscription, and the
    // release is a 404 before the gateway — the org row keeps its state.
    const before = await subscriptionState();

    const personal = await call(postWithoutBody(member, orgId), releaseScheduledPlan);

    expect(personal.status).toBe(404);
    expect(fakeGateway.releaseScheduledPlan).not.toHaveBeenCalled();
    expect(await subscriptionState()).toEqual(before);

    const allowed = await call(postWithoutBody(billing, orgId), releaseScheduledPlan);
    expect(allowed.status).toBe(200);
    expect(fakeGateway.releaseScheduledPlan).toHaveBeenCalledTimes(1);
    expect(firstCall(fakeGateway.releaseScheduledPlan)[0].owner).toEqual({
      type: 'org',
      orgId,
      userId: billingUser.id,
      accountType: 'manager',
    });
  });

  it('reconciles as the personal owner without org.billing.manage; the key holder reconciles as the org', async () => {
    // Operator decision 2026-11-22 (ADR-0015 phase 5b): reconcile loads no
    // subscription, so a caller without the key is not refused — they are a
    // personal owner and the gateway sees `{ type: 'user' }`, never the org.
    // The key holder's call carries the org owner.
    const personal = await call(post(member, { sessionId: `cs_${tag}` }, orgId), reconcileCheckout);

    expect(personal.status).toBe(200);
    expect(fakeGateway.reconcileCheckout).toHaveBeenCalledTimes(1);
    expect(firstCall(fakeGateway.reconcileCheckout)[0].owner).toEqual({
      type: 'user',
      userId: memberUser.id,
      accountType: 'manager',
    });

    const allowed = await call(post(billing, { sessionId: `cs_${tag}` }, orgId), reconcileCheckout);

    expect(allowed.status).toBe(200);
    expect(fakeGateway.reconcileCheckout).toHaveBeenCalledTimes(2);
    const [orgReconcile] = fakeGateway.reconcileCheckout.mock.calls[1] ?? [];
    expect(orgReconcile?.owner).toEqual({
      type: 'org',
      orgId,
      userId: billingUser.id,
      accountType: 'manager',
    });
  });

  it('resolves checkout for a non-active target org from a Billing holder there (org.billing.manage in the target org, no active-org equality)', async () => {
    // Phase 5b row 7: the active org is A (cookie), the body names B, and the
    // authority is proven in B itself via `has_permission` — a caller who
    // manages billing in B but not in A may buy for B.
    fakeGateway.createCheckoutSession.mockResolvedValueOnce(
      success({ url: 'https://checkout.test/cs_b', sessionId: 'cs_b' }),
    );

    const { status, body } = await call(
      post(billing, { planKey: 'campus', orgId: orgBId, locale: 'pl' }, orgId),
      createCheckoutSession,
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(fakeGateway.createCheckoutSession).toHaveBeenCalledTimes(1);
    const [checkoutInput] = firstCall(fakeGateway.createCheckoutSession);
    expect(checkoutInput.owner).toEqual({
      type: 'org',
      orgId: orgBId,
      userId: billingUser.id,
      accountType: 'manager',
    });
    expect(checkoutInput.planKey).toBe('campus');
  });

  it('refuses checkout for an org the caller cannot bill (403, no session created)', async () => {
    const { status } = await call(
      post(member, { planKey: 'campus', orgId: orgBId, locale: 'pl' }, orgId),
      createCheckoutSession,
    );

    expect(status).toBe(403);
    expect(fakeGateway.createCheckoutSession).not.toHaveBeenCalled();
  });
});
