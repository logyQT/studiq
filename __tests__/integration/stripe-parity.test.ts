import { AccountType, type RequestContext } from '@studiq/authz';
import { MockPaymentGateway } from '@studiq/server/lib/payment/mock-payment.gateway';
import { SupabasePaymentHistoryWriter } from '@studiq/server/lib/payment/payment-history.repository';
import { isRecord, readString } from '@studiq/server/lib/record';
import { STRIPE_API_VERSION, createStripeClient } from '@studiq/server/lib/payment/stripe-client';
import type { StripeClient } from '@studiq/server/lib/payment/stripe-client';
import { StripePaymentGateway } from '@studiq/server/lib/payment/stripe-payment.gateway';
import { SupabaseStripeBillingRepository } from '@studiq/server/lib/payment/stripe-repository';
import { SupabaseStripeWebhookRepository } from '@studiq/server/lib/payment/stripe-webhook.repository';
import { BillingService } from '@studiq/server/services/billing.service';
import { EntitlementService } from '@studiq/server/services/entitlement.service';
import { ORG_LIMIT_KEYS, USER_LIMIT_KEYS } from '@studiq/server/services/limit.catalog';
import { MockStripeService } from '@studiq/server/services/mock-stripe.service';
import { StripeWebhookService } from '@studiq/server/services/stripe-webhook.service';
import { dbRows } from '@studiq/server/lib/supabase/rows';
// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson } from '#test/helpers/json';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
  seedOrgMembership,
  seedOrganization,
} from '#test/integration/helpers';

/**
 * Mock ↔ Stripe downstream parity (#662 workstream A).
 *
 * The two drivers keep their own provider I/O (a fake local URL vs a hosted
 * Checkout Session), but every domain effect must be identical. This suite runs
 * the same purchase scenarios through:
 *
 * - the mock driver: `BillingService.startCheckout` → mock completion command;
 * - the Stripe driver: `BillingService.startCheckout` → signed
 *   `checkout.session.completed` + `invoice.paid` webhooks, with a fake Stripe
 *   client (signature verification is real; no provider call leaves the test).
 *
 * and asserts the same database state: the entitlement, one payment row with
 * the explicit provider, and the same billing read-model plan/status.
 *
 * Storage intentionally differs (workstream A4): the mock has no
 * `billing_subscriptions` mirror and no test-mode `stripe_webhook_events` row;
 * its read model is synthesized from the entitlement. The user-visible
 * plan/status is still identical.
 */

const WEBHOOK_SECRET = 'whsec_parity_test';
const PASSWORD = 'StripeParity662!';
const BASE_URL = 'http://localhost:3000';

const tag = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const studentPlanKey = `parity_student_${tag}`;
const secondStudentPlanKey = `parity_student2_${tag}`;
const orgPlanKey = `parity_org_${tag}`;
const studentPlanAmount = 1234;
const secondStudentPlanAmount = 2345;
const orgPlanAmount = 4321;

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function referenceId(value: unknown): string {
  if (typeof value === 'string') return value;
  return isRecord(value) ? (readString(value, 'id') ?? '') : '';
}

function subscriptionFixture(input: {
  id: string;
  customer: string;
  metadata: Record<string, string>;
  priceId: string;
}): Stripe.Subscription {
  return asJson<Stripe.Subscription>({
    id: input.id,
    object: 'subscription',
    customer: input.customer,
    status: 'active',
    metadata: input.metadata,
    items: {
      data: [
        {
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
          price: { id: input.priceId },
        },
      ],
    },
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    livemode: false,
  });
}

function unusedStripeCall(name: string): () => never {
  return () => {
    throw new Error(`fake Stripe client: ${name} is not part of the parity flow`);
  };
}

/** Offline fake: no member may fall through to the real network client. */
function createFakeStripe() {
  const real = createStripeClient('sk_test_parity_only');
  const sessions = new Map<string, Stripe.Checkout.Session>();
  const subscriptions = new Map<string, Stripe.Subscription>();
  let counter = 0;

  const client: StripeClient = {
    customers: {
      create: (params) =>
        Promise.resolve(
          asJson<Stripe.Customer>({
            id: `cus_parity_${++counter}`,
            object: 'customer',
            email: params.email ?? null,
            name: params.name ?? null,
            metadata: params.metadata ?? {},
            livemode: false,
          }),
        ),
    },
    checkout: {
      sessions: {
        create: (params) => {
          const id = `cs_parity_${++counter}`;
          const customer = referenceId(params.customer);
          const subscriptionId = `sub_parity_${++counter}`;
          const metadata = stringRecord(params.metadata);
          const lineItems: unknown = params.line_items;
          const firstItem: unknown = Array.isArray(lineItems) ? lineItems[0] : undefined;
          const priceId = referenceId(isRecord(firstItem) ? firstItem.price : undefined);

          subscriptions.set(
            subscriptionId,
            subscriptionFixture({
              id: subscriptionId,
              customer,
              // The gateway writes the same metadata to the subscription; keep
              // it so a dropped `subscription_data.metadata` is visible.
              metadata: stringRecord(
                isRecord(params.subscription_data) ? params.subscription_data.metadata : metadata,
              ),
              priceId,
            }),
          );

          const session = asJson<Stripe.Checkout.Session>({
            id,
            object: 'checkout.session',
            customer,
            subscription: subscriptionId,
            payment_status: 'paid',
            metadata,
            client_reference_id: params.client_reference_id ?? null,
            livemode: false,
            url: `https://checkout.stripe.test/pay/${id}`,
          });
          sessions.set(id, session);
          return Promise.resolve(session);
        },
        retrieve: (id) => {
          const session = sessions.get(id);
          if (!session) throw new Error(`unknown fake checkout session ${id}`);
          return Promise.resolve(session);
        },
      },
    },
    prices: { retrieve: unusedStripeCall('prices.retrieve') },
    subscriptions: {
      retrieve: (id) => {
        const subscription = subscriptions.get(id);
        if (!subscription) throw new Error(`unknown fake subscription ${id}`);
        return Promise.resolve(subscription);
      },
      update: unusedStripeCall('subscriptions.update'),
    },
    subscriptionSchedules: {
      create: unusedStripeCall('subscriptionSchedules.create'),
      retrieve: unusedStripeCall('subscriptionSchedules.retrieve'),
      update: unusedStripeCall('subscriptionSchedules.update'),
      release: unusedStripeCall('subscriptionSchedules.release'),
    },
    billingPortal: { sessions: { create: unusedStripeCall('billingPortal.sessions.create') } },
    webhooks: real.webhooks,
  };

  return { client, sessions };
}

function ctxFor(
  user: TestUserFixture,
  role: AccountType,
  activeOrgId: string | null = null,
): RequestContext {
  return {
    traceId: 'parity',
    userId: user.id,
    accountType: role,
    orgRoleId: null,
    activeOrgId,
    url: '',
    method: 'POST',
    groupIds: [],
    permissionScopes: {},
  };
}

describe('mock ↔ Stripe downstream parity (#662 workstream A)', () => {
  const service = createServiceClient();
  const fake = createFakeStripe();
  const entitlementService = new EntitlementService(() => service);
  const mockCompletion = new MockStripeService(
    new SupabaseStripeBillingRepository(() => service),
    entitlementService,
    new SupabasePaymentHistoryWriter(() => service),
  );
  const mockBilling = new BillingService(new MockPaymentGateway(mockCompletion));
  const stripeBilling = new BillingService(
    new StripePaymentGateway({
      client: fake.client,
      config: {
        secretKey: 'sk_test_parity_only',
        webhookSecret: WEBHOOK_SECRET,
        portalConfigurationId: 'bpc_parity',
        livemode: false,
      },
      repository: new SupabaseStripeBillingRepository(() => service),
      createAdminClient: () => service,
      siteUrl: () => BASE_URL,
    }),
  );
  const webhooks = new StripeWebhookService({
    client: fake.client,
    webhookSecret: WEBHOOK_SECRET,
    livemode: false,
    repository: new SupabaseStripeWebhookRepository(() => service),
    entitlements: entitlementService,
  });

  let clock = Math.floor(Date.now() / 1000);
  function nextCreated(): number {
    clock += 1;
    return clock;
  }

  let eventCounter = 0;
  function deliver(type: string, object: unknown) {
    const event = asJson<Stripe.Event>({
      id: `evt_parity_${tag}_${++eventCounter}`,
      object: 'event',
      api_version: STRIPE_API_VERSION,
      created: nextCreated(),
      livemode: false,
      type,
      data: { object },
    });
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return webhooks.handle(payload, header);
  }

  type RunFailure = { ok: false; error: string };
  type StripeRun = { ok: true; sessionId: string; subscriptionId: string; invoiceId: string };
  type MockRun = { ok: true; sessionId: string };

  /** Starts a mock checkout (server-side domain validation + fake URL). */
  async function startMock(
    ctx: RequestContext,
    planKey: string,
    orgId?: string,
  ): Promise<MockRun | RunFailure> {
    const start = await mockBilling.startCheckout(ctx, planKey, orgId);
    if (!start.success) return { ok: false, error: start.error };
    return { ok: true, sessionId: start.data.sessionId };
  }

  /** The authenticated completion command the mock checkout page posts. */
  async function completeMock(input: {
    ctx: RequestContext;
    planKey: string;
    sessionId: string;
    orgId?: string;
  }): Promise<MockRun | RunFailure> {
    const result = await mockCompletion.handleWebhook(
      {
        type: 'checkout.session.completed',
        session_id: input.sessionId,
        plan_id: input.planKey,
        ...(input.orgId ? { org_id: input.orgId } : {}),
      },
      input.ctx.accountType,
      input.ctx.userId,
    );
    if (!result.success) return { ok: false, error: result.error };
    return { ok: true, sessionId: input.sessionId };
  }

  async function runMockPurchase(input: {
    ctx: RequestContext;
    planKey: string;
    orgId?: string;
    sessionId?: string;
  }): Promise<MockRun | RunFailure> {
    const started = await startMock(input.ctx, input.planKey, input.orgId);
    if (!started.ok) return started;
    return completeMock({
      ctx: input.ctx,
      planKey: input.planKey,
      sessionId: input.sessionId ?? started.sessionId,
      orgId: input.orgId,
    });
  }

  /** Completes a Stripe purchase the way Checkout + the Dashboard do. */
  async function runStripePurchase(input: {
    ctx: RequestContext;
    planKey: string;
    expectedPriceId: string;
    orgId?: string;
  }): Promise<StripeRun | RunFailure> {
    const start = await stripeBilling.startCheckout(input.ctx, input.planKey, input.orgId);
    if (!start.success) return { ok: false, error: start.error };

    const session = fake.sessions.get(start.data.sessionId);
    if (!session) throw new Error('fake checkout session missing');

    const activated = await deliver('checkout.session.completed', session);
    expect(activated.success).toBe(true);

    const subscriptionRef = session.subscription;
    const subscriptionId =
      typeof subscriptionRef === 'string' ? subscriptionRef : (subscriptionRef?.id ?? '');
    const subscription = await fake.client.subscriptions.retrieve(subscriptionId);

    // Proves the adapter sent the Price resolved from `stripe_prices`, not a
    // value derived from the fixture itself.
    expect(subscription.items.data[0]?.price.id).toBe(input.expectedPriceId);

    const invoice = {
      id: `in_parity_${tag}_${subscriptionId}`,
      object: 'invoice',
      customer: session.customer,
      amount_paid: input.planKey === orgPlanKey ? orgPlanAmount : studentPlanAmount,
      currency: 'pln',
      parent: { subscription_details: { subscription: subscriptionId } },
      status_transitions: { paid_at: nextCreated() },
      hosted_invoice_url: `https://invoice.stripe.test/${subscriptionId}`,
      invoice_pdf: `https://invoice.stripe.test/${subscriptionId}.pdf`,
      billing_reason: 'subscription_create',
    };
    const paid = await deliver('invoice.paid', invoice);
    expect(paid.success).toBe(true);

    return {
      ok: true,
      sessionId: start.data.sessionId,
      subscriptionId,
      invoiceId: invoice.id,
    };
  }

  async function profilePlan(userId: string): Promise<string | null> {
    const { data, error } = await service
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', userId)
      .single();
    if (error) throw new Error(error.message);
    return data.personal_plan_key;
  }

  async function orgPlan(orgId: string): Promise<string> {
    const { data, error } = await service
      .from('organizations')
      .select('plan')
      .eq('id', orgId)
      .single();
    if (error) throw new Error(error.message);
    return data.plan;
  }

  async function paymentsFor(filter: {
    userId?: string;
    organizationId?: string;
    sessionId?: string;
  }) {
    let query = service.from('payments').select('*');
    if (filter.userId) query = query.eq('user_id', filter.userId);
    if (filter.organizationId) query = query.eq('organization_id', filter.organizationId);
    if (filter.sessionId) query = query.eq('session_id', filter.sessionId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return dbRows(data);
  }

  async function subscriptionMirrors(filter: { userId?: string; organizationId?: string }) {
    let query = service.from('billing_subscriptions').select('id');
    if (filter.userId) query = query.eq('user_id', filter.userId);
    if (filter.organizationId) query = query.eq('organization_id', filter.organizationId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return dbRows(data);
  }

  let mockStudent: TestUserFixture;
  let stripeStudent: TestUserFixture;
  let replayStudent: TestUserFixture;
  let viewMockStudent: TestUserFixture;
  let viewStripeStudent: TestUserFixture;
  let orgManager: TestUserFixture;
  let orgTeacher: TestUserFixture;
  let crossOrgManager: TestUserFixture;
  let mockOrgId: string;
  let stripeOrgId: string;
  const createdUsers: TestUserFixture[] = [];

  beforeAll(async () => {
    // Dedicated catalog rows: never reuse/overwrite the real plan catalog or
    // the bootstrap-produced price map on a developer's database.
    const { error: planError } = await service.from('subscription_plans').insert([
      {
        key: studentPlanKey,
        name: 'Parity Student',
        price_monthly: studentPlanAmount,
        currency: 'PLN',
        sort_order: 900,
        for_account_type: 'student',
      },
      {
        key: secondStudentPlanKey,
        name: 'Parity Student 2',
        price_monthly: secondStudentPlanAmount,
        currency: 'PLN',
        sort_order: 901,
        for_account_type: 'student',
      },
      {
        key: orgPlanKey,
        name: 'Parity Organization',
        price_monthly: orgPlanAmount,
        currency: 'PLN',
        sort_order: 902,
        for_account_type: 'manager',
      },
    ]);
    if (planError) throw new Error(`parity plans: ${planError.message}`);

    // Active plans must declare the full limit catalog, or the shared
    // `plan-limit-catalog` suite can observe an incomplete catalog while this
    // file runs in parallel.
    const limitRows = [
      ...USER_LIMIT_KEYS.map((limit_key) => ({
        plan_key: studentPlanKey,
        limit_key,
        limit_value: 0,
      })),
      ...USER_LIMIT_KEYS.map((limit_key) => ({
        plan_key: secondStudentPlanKey,
        limit_key,
        limit_value: 0,
      })),
      ...USER_LIMIT_KEYS.map((limit_key) => ({
        plan_key: orgPlanKey,
        limit_key,
        limit_value: 0,
      })),
      ...ORG_LIMIT_KEYS.map((limit_key) => ({
        plan_key: orgPlanKey,
        limit_key,
        limit_value: 0,
      })),
    ];
    const { error: limitError } = await service.from('plan_limits').insert(limitRows);
    if (limitError) throw new Error(`parity plan_limits: ${limitError.message}`);

    const { error: priceError } = await service.from('stripe_prices').insert([
      {
        plan_key: studentPlanKey,
        billing_cycle: 'monthly',
        stripe_price_id: `price_parity_student_${tag}`,
        currency: 'PLN',
        unit_amount: studentPlanAmount,
        interval: 'month',
        livemode: false,
      },
      {
        plan_key: orgPlanKey,
        billing_cycle: 'monthly',
        stripe_price_id: `price_parity_org_${tag}`,
        currency: 'PLN',
        unit_amount: orgPlanAmount,
        interval: 'month',
        livemode: false,
      },
    ]);
    if (priceError) throw new Error(`parity prices: ${priceError.message}`);

    mockStudent = await createTestUser({ role: 'student', password: PASSWORD });
    createdUsers.push(mockStudent);
    stripeStudent = await createTestUser({ role: 'student', password: PASSWORD });
    createdUsers.push(stripeStudent);
    replayStudent = await createTestUser({ role: 'student', password: PASSWORD });
    createdUsers.push(replayStudent);
    viewMockStudent = await createTestUser({ role: 'student', password: PASSWORD });
    createdUsers.push(viewMockStudent);
    viewStripeStudent = await createTestUser({ role: 'student', password: PASSWORD });
    createdUsers.push(viewStripeStudent);
    orgManager = await createTestUser({ role: 'manager', password: PASSWORD });
    createdUsers.push(orgManager);
    orgTeacher = await createTestUser({ role: 'manager', password: PASSWORD });
    createdUsers.push(orgTeacher);
    crossOrgManager = await createTestUser({ role: 'manager', password: PASSWORD });
    createdUsers.push(crossOrgManager);

    const mockOrg = await seedOrganization(`parity-mock-${tag}`);
    const stripeOrg = await seedOrganization(`parity-stripe-${tag}`);
    mockOrgId = mockOrg.org.id;
    stripeOrgId = stripeOrg.org.id;

    for (const org of [mockOrg, stripeOrg]) {
      await seedOrgMembership({
        organizationId: org.org.id,
        userId: orgManager.id,
        orgRoleId: org.adminRoleId,
      });
      await seedOrgMembership({
        organizationId: org.org.id,
        userId: orgTeacher.id,
        orgRoleId: org.teacherRoleId,
      });
    }

    // Admin of the mock org only: proves an admin of one org cannot buy for
    // another org.
    await seedOrgMembership({
      organizationId: mockOrgId,
      userId: crossOrgManager.id,
      orgRoleId: mockOrg.adminRoleId,
    });

    await service
      .from('profiles')
      .update({ personal_plan_key: 'base' })
      .in('id', [
        mockStudent.id,
        stripeStudent.id,
        replayStudent.id,
        viewMockStudent.id,
        viewStripeStudent.id,
      ]);
    await service
      .from('profiles')
      .update({ personal_plan_key: 'launch' })
      .in('id', [orgManager.id, orgTeacher.id, crossOrgManager.id]);
  });

  afterAll(async () => {
    const userIds = createdUsers.map((user) => user.id);
    const orgIds = [mockOrgId, stripeOrgId].filter((id): id is string => Boolean(id));
    const planKeys = [studentPlanKey, secondStudentPlanKey, orgPlanKey];

    if (userIds.length > 0) {
      await service.from('payments').delete().in('user_id', userIds);
      await service.from('billing_subscriptions').delete().in('user_id', userIds);
      await service.from('billing_customers').delete().in('user_id', userIds);
    }
    if (orgIds.length > 0) {
      await service.from('billing_subscriptions').delete().in('organization_id', orgIds);
      await service.from('billing_customers').delete().in('organization_id', orgIds);
    }
    await service.from('stripe_webhook_events').delete().like('id', `evt_parity_${tag}%`);

    if (userIds.length > 0) {
      await service.from('profiles').update({ personal_plan_key: 'base' }).in('id', userIds);
    }

    for (const orgId of orgIds) {
      await cleanupOrganizationDeep(orgId);
    }

    await service.from('plan_limits').delete().in('plan_key', planKeys);
    await service.from('stripe_prices').delete().in('plan_key', planKeys);
    await service.from('subscription_plans').delete().in('key', planKeys);

    for (const user of createdUsers) {
      await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  it('parity: personal purchase writes the same entitlement and one payment row per driver', async () => {
    const mock = await runMockPurchase({
      ctx: ctxFor(mockStudent, AccountType.STUDENT),
      planKey: studentPlanKey,
    });
    expect(mock.ok).toBe(true);
    if (!mock.ok) return;

    const stripe = await runStripePurchase({
      ctx: ctxFor(stripeStudent, AccountType.STUDENT),
      planKey: studentPlanKey,
      expectedPriceId: `price_parity_student_${tag}`,
    });
    expect(stripe.ok).toBe(true);
    if (!stripe.ok) return;

    expect(await profilePlan(mockStudent.id)).toBe(studentPlanKey);
    expect(await profilePlan(stripeStudent.id)).toBe(studentPlanKey);

    const mockRows = await paymentsFor({ userId: mockStudent.id });
    const stripeRows = await paymentsFor({ userId: stripeStudent.id });
    expect(mockRows).toHaveLength(1);
    expect(stripeRows).toHaveLength(1);

    expect(mockRows[0]).toMatchObject({
      provider: 'mock',
      organization_id: null,
      plan_key: studentPlanKey,
      amount: studentPlanAmount,
      currency: 'PLN',
      stripe_invoice_id: null,
    });
    expect(stripeRows[0]).toMatchObject({
      provider: 'stripe',
      organization_id: null,
      plan_key: studentPlanKey,
      amount: studentPlanAmount,
      currency: 'PLN',
      session_id: null,
    });
    // Exactly one uniqueness key per provider.
    expect(mockRows[0]?.session_id).toBe(mock.sessionId);
    expect(stripeRows[0]?.stripe_invoice_id).toBe(stripe.invoiceId);
    expect(stripeRows[0]?.stripe_checkout_session_id).toBe(stripe.sessionId);
  });

  it('parity: org purchase changes the organization only and leaves the buyer personal plan alone', async () => {
    const mockManagerBefore = await profilePlan(orgManager.id);

    const mock = await runMockPurchase({
      ctx: ctxFor(orgManager, AccountType.MANAGER, mockOrgId),
      planKey: orgPlanKey,
      orgId: mockOrgId,
    });
    expect(mock.ok).toBe(true);
    expect(await orgPlan(mockOrgId)).toBe(orgPlanKey);
    expect(await profilePlan(orgManager.id)).toBe(mockManagerBefore);
    expect(await subscriptionMirrors({ organizationId: mockOrgId })).toHaveLength(0);

    const stripeManagerBefore = await profilePlan(orgManager.id);
    const stripe = await runStripePurchase({
      ctx: ctxFor(orgManager, AccountType.MANAGER, stripeOrgId),
      planKey: orgPlanKey,
      expectedPriceId: `price_parity_org_${tag}`,
      orgId: stripeOrgId,
    });
    expect(stripe.ok).toBe(true);
    if (!stripe.ok) return;

    expect(await orgPlan(stripeOrgId)).toBe(orgPlanKey);
    // ADR-0007/#228: an organization purchase never widens the manager's
    // personal plan.
    expect(await profilePlan(orgManager.id)).toBe(stripeManagerBefore);
    expect(await subscriptionMirrors({ organizationId: stripeOrgId })).toHaveLength(1);

    for (const orgId of [mockOrgId, stripeOrgId]) {
      const rows = await paymentsFor({ organizationId: orgId });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        // The buyer stays the payer on an org purchase.
        user_id: orgManager.id,
        currency: 'PLN',
        plan_key: orgPlanKey,
        amount: orgPlanAmount,
      });
    }
    expect((await paymentsFor({ organizationId: mockOrgId }))[0]?.provider).toBe('mock');
    expect((await paymentsFor({ organizationId: stripeOrgId }))[0]?.provider).toBe('stripe');
  });

  it('parity: a non-admin org member is forbidden by both checkout paths', async () => {
    const sessionsBefore = fake.sessions.size;

    await expect(
      mockBilling.startCheckout(
        ctxFor(orgTeacher, AccountType.MANAGER, mockOrgId),
        orgPlanKey,
        mockOrgId,
      ),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    await expect(
      stripeBilling.startCheckout(
        ctxFor(orgTeacher, AccountType.MANAGER, stripeOrgId),
        orgPlanKey,
        stripeOrgId,
      ),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    // An admin of one org cannot buy for an org they do not belong to.
    await expect(
      mockBilling.startCheckout(
        ctxFor(crossOrgManager, AccountType.MANAGER, mockOrgId),
        orgPlanKey,
        stripeOrgId,
      ),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });
    await expect(
      stripeBilling.startCheckout(
        ctxFor(crossOrgManager, AccountType.MANAGER, mockOrgId),
        orgPlanKey,
        stripeOrgId,
      ),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    // The mock completion command re-checks the same rule; the Stripe webhook
    // trusts Checkout metadata because the checkout path already enforced it.
    const orgBefore = await orgPlan(mockOrgId);
    await expect(
      mockCompletion.handleWebhook(
        {
          type: 'checkout.session.completed',
          session_id: `forged_${tag}`,
          plan_id: orgPlanKey,
          org_id: mockOrgId,
        },
        AccountType.MANAGER,
        orgTeacher.id,
      ),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    expect(await orgPlan(mockOrgId)).toBe(orgBefore);
    expect(await paymentsFor({ userId: orgTeacher.id })).toHaveLength(0);
    // A refused checkout never reaches provider I/O.
    expect(fake.sessions.size).toBe(sessionsBefore);
  });

  it('parity: a plan from the wrong family is forbidden for both drivers', async () => {
    const sessionsBefore = fake.sessions.size;

    await expect(
      mockBilling.startCheckout(ctxFor(mockStudent, AccountType.STUDENT), orgPlanKey),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    await expect(
      stripeBilling.startCheckout(ctxFor(stripeStudent, AccountType.STUDENT), orgPlanKey),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    await expect(
      mockBilling.startCheckout(ctxFor(orgManager, AccountType.MANAGER, mockOrgId), studentPlanKey),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    await expect(
      stripeBilling.startCheckout(
        ctxFor(orgManager, AccountType.MANAGER, stripeOrgId),
        studentPlanKey,
      ),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    // The mock completion path shares the same family rule.
    await expect(
      mockCompletion.handleWebhook(
        { type: 'checkout.session.completed', session_id: `wrong_${tag}`, plan_id: orgPlanKey },
        AccountType.STUDENT,
        mockStudent.id,
      ),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    expect(fake.sessions.size).toBe(sessionsBefore);
  });

  it('parity: replay produces one entitlement and one payment row', async () => {
    const started = await startMock(ctxFor(mockStudent, AccountType.STUDENT), studentPlanKey);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const first = await completeMock({
      ctx: ctxFor(mockStudent, AccountType.STUDENT),
      planKey: studentPlanKey,
      sessionId: started.sessionId,
    });
    expect(first.ok).toBe(true);

    // The same authenticated command delivered again: `session_id` is unique.
    const replay = await completeMock({
      ctx: ctxFor(mockStudent, AccountType.STUDENT),
      planKey: studentPlanKey,
      sessionId: started.sessionId,
    });
    expect(replay.ok).toBe(true);

    expect(await paymentsFor({ sessionId: started.sessionId })).toHaveLength(1);
    expect(await profilePlan(mockStudent.id)).toBe(studentPlanKey);

    // A session id may not be re-used for a different plan or owner.
    await expect(
      completeMock({
        ctx: ctxFor(mockStudent, AccountType.STUDENT),
        planKey: secondStudentPlanKey,
        sessionId: started.sessionId,
      }),
    ).resolves.toEqual({ ok: false, error: 'CONFLICT' });
    await expect(
      completeMock({
        ctx: ctxFor(replayStudent, AccountType.STUDENT),
        planKey: studentPlanKey,
        sessionId: started.sessionId,
      }),
    ).resolves.toEqual({ ok: false, error: 'CONFLICT' });

    expect(await profilePlan(mockStudent.id)).toBe(studentPlanKey);
    expect(await profilePlan(replayStudent.id)).toBe('base');
    expect(await paymentsFor({ sessionId: started.sessionId })).toHaveLength(1);

    // Stripe: the same invoice under a *different* event id (the provider can
    // deliver twice) must still leave one history row.
    const stripe = await runStripePurchase({
      ctx: ctxFor(replayStudent, AccountType.STUDENT),
      planKey: studentPlanKey,
      expectedPriceId: `price_parity_student_${tag}`,
    });
    expect(stripe.ok).toBe(true);
    if (!stripe.ok) return;

    const subscription = await fake.client.subscriptions.retrieve(stripe.subscriptionId);
    const invoice = {
      id: stripe.invoiceId,
      object: 'invoice',
      customer: subscription.customer,
      amount_paid: studentPlanAmount,
      currency: 'pln',
      parent: { subscription_details: { subscription: stripe.subscriptionId } },
      status_transitions: { paid_at: nextCreated() },
      hosted_invoice_url: `https://invoice.stripe.test/${stripe.subscriptionId}`,
      invoice_pdf: `https://invoice.stripe.test/${stripe.subscriptionId}.pdf`,
      billing_reason: 'subscription_create',
    };
    const paidAgain = await deliver('invoice.paid', invoice);
    expect(paidAgain.success).toBe(true);

    const { data, error } = await service
      .from('payments')
      .select('id')
      .eq('stripe_invoice_id', stripe.invoiceId);
    if (error) throw new Error(error.message);
    expect(data).toHaveLength(1);
  });

  it('parity: the read model reports the same plan and status semantics', async () => {
    const mock = await runMockPurchase({
      ctx: ctxFor(viewMockStudent, AccountType.STUDENT),
      planKey: studentPlanKey,
    });
    expect(mock.ok).toBe(true);

    const stripe = await runStripePurchase({
      ctx: ctxFor(viewStripeStudent, AccountType.STUDENT),
      planKey: studentPlanKey,
      expectedPriceId: `price_parity_student_${tag}`,
    });
    expect(stripe.ok).toBe(true);

    mockUser({ id: viewMockStudent.id, role: 'student' });
    const mockView = await mockBilling.getSubscription(
      ctxFor(viewMockStudent, AccountType.STUDENT),
    );
    expect(mockView.success).toBe(true);

    mockUser({ id: viewStripeStudent.id, role: 'student' });
    const stripeView = await stripeBilling.getSubscription(
      ctxFor(viewStripeStudent, AccountType.STUDENT),
    );
    expect(stripeView.success).toBe(true);

    if (!mockView.success || !stripeView.success) return;

    const sharedFields = (view: typeof mockView.data) => ({
      planKey: view.planKey,
      planName: view.planName,
      status: view.status,
      priceMonthly: view.priceMonthly,
      currency: view.currency,
    });
    expect(sharedFields(mockView.data)).toEqual(sharedFields(stripeView.data));
    expect(sharedFields(mockView.data)).toEqual({
      planKey: studentPlanKey,
      planName: 'Parity Student',
      status: 'active',
      priceMonthly: studentPlanAmount,
      currency: 'PLN',
    });

    // Storage differs by design (A4): the mock writes no subscription mirror,
    // Stripe does. Assert the database, not the synthesized view.
    expect(await subscriptionMirrors({ userId: viewMockStudent.id })).toHaveLength(0);
    expect(await subscriptionMirrors({ userId: viewStripeStudent.id })).toHaveLength(1);
    expect(stripeView.data.billedPlanKey).toBe(studentPlanKey);
    expect(mockView.data.billedPlanKey).toBeNull();
  });

  it('EntitlementService refuses a paid manager plan for a profile owner', async () => {
    await expect(
      entitlementService.applyPlan({ type: 'user', userId: orgManager.id }, orgPlanKey),
    ).resolves.toEqual({ success: false, error: 'FORBIDDEN' });

    expect(await profilePlan(orgManager.id)).toBe('launch');
  });
});
