import { STRIPE_API_VERSION, createStripeClient } from '@studiq/server/lib/payment/stripe-client';
import type { StripeClient } from '@studiq/server/lib/payment/stripe-client';
import { SupabaseStripeWebhookRepository } from '@studiq/server/lib/payment/stripe-webhook.repository';
import { EntitlementService } from '@studiq/server/services/entitlement.service';
import { StripeWebhookService } from '@studiq/server/services/stripe-webhook.service';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';

/**
 * End-to-end webhook → entitlement sync against the real database (#662 §10.2),
 * with no Stripe network:
 *
 * - the payload is signed with the real Stripe SDK helper, so
 *   `constructEvent` runs for real;
 * - `subscriptions.retrieve` returns a fixture (the only faked provider call);
 * - `stripe_webhook_events`, `billing_*`, `payments`, `profiles` and
 *   `apply_org_plan` are all real.
 *
 * The fixtures deliberately use prices that are **not** in `stripe_prices`
 * (CI never runs the bootstrap script), which also exercises the metadata
 * fallback from design §6.5.
 */

const WEBHOOK_SECRET = 'whsec_integration_test';
const PRICE_SPARK = 'price_integration_spark';
const PRICE_HUB = 'price_integration_hub';
const PASSWORD = 'StripeWh662!';

const tag = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const tagId = (suffix: string) => `test_${tag}_${suffix}`;

function userMetadata(userId: string, planKey: string) {
  return {
    studiq_owner_type: 'user',
    studiq_user_id: userId,
    studiq_org_id: '',
    studiq_plan_key: planKey,
    studiq_billing_cycle: 'monthly',
    studiq_livemode: 'false',
  };
}

function orgMetadata(orgId: string, purchaserId: string, planKey: string) {
  return {
    studiq_owner_type: 'org',
    studiq_user_id: purchaserId,
    studiq_org_id: orgId,
    studiq_plan_key: planKey,
    studiq_billing_cycle: 'monthly',
    studiq_livemode: 'false',
  };
}

function subscriptionFixture(input: {
  id: string;
  customer: string;
  metadata: Record<string, string>;
  priceId: string;
  status?: string;
  canceledAt?: number | null;
}): Stripe.Subscription {
  return {
    id: input.id,
    object: 'subscription',
    customer: input.customer,
    status: input.status ?? 'active',
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
    canceled_at: input.canceledAt ?? null,
    livemode: false,
  } as unknown as Stripe.Subscription;
}

let clock = Math.floor(Date.now() / 1000);
function nextCreated(): number {
  clock += 1;
  return clock;
}

function event(input: {
  id: string;
  type: string;
  object: unknown;
  created: number;
}): Stripe.Event {
  return {
    id: input.id,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: input.created,
    livemode: false,
    type: input.type,
    data: { object: input.object },
  } as unknown as Stripe.Event;
}

describe('Stripe webhook → entitlement sync (#662 §10.2)', () => {
  const service = createServiceClient();
  // `createStripeClient` only stores the key; no request is made by the
  // signature helper or by the faked `subscriptions.retrieve`.
  const real = createStripeClient('sk_test_integration_only');
  let currentSubscription: Stripe.Subscription;
  const client: StripeClient = {
    ...real,
    subscriptions: {
      retrieve: async () => currentSubscription,
    },
  };
  const webhookService = new StripeWebhookService({
    client,
    webhookSecret: WEBHOOK_SECRET,
    livemode: false,
    repository: new SupabaseStripeWebhookRepository(() => service),
    entitlements: new EntitlementService(() => service),
  });

  let student: TestUserFixture;
  let manager: TestUserFixture;
  let orgId: string;
  const eventIds: string[] = [];
  const invoiceIds: string[] = [];
  const subscriptionIds: string[] = [];
  const customerIds: string[] = [];

  async function deliver(evt: Stripe.Event) {
    const payload = JSON.stringify(evt);
    const header = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
    return webhookService.handle(payload, header);
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

  async function orgPlan(id: string): Promise<string> {
    const { data, error } = await service
      .from('organizations')
      .select('plan')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data.plan;
  }

  async function subscriptionsFor(stripeId: string) {
    const { data, error } = await service
      .from('billing_subscriptions')
      .select('*')
      .eq('stripe_subscription_id', stripeId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function paymentsForInvoice(invoiceId: string) {
    const { data, error } = await service
      .from('payments')
      .select('*')
      .eq('stripe_invoice_id', invoiceId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async function eventRow(id: string) {
    const { data, error } = await service
      .from('stripe_webhook_events')
      .select('status, error')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  beforeAll(async () => {
    student = await createTestUser({ role: 'student', password: PASSWORD });
    manager = await createTestUser({ role: 'manager', password: PASSWORD });

    // A migrated-but-not-reset database may still carry rows from a prior run.
    await service.from('payments').delete().in('user_id', [student.id, manager.id]);
    await service.from('billing_customers').delete().in('user_id', [student.id, manager.id]);

    await service.from('profiles').update({ personal_plan_key: 'base' }).eq('id', student.id);
    await service.from('profiles').update({ personal_plan_key: 'launch' }).eq('id', manager.id);

    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: `stripe-webhook-${tag}` })
      .select('id')
      .single();
    if (orgError || !org) throw new Error(orgError?.message ?? 'org create failed');
    orgId = org.id;

    const { data: role, error: roleError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    if (roleError || !role) throw new Error(roleError?.message ?? 'admin role missing');

    const { error: memberError } = await service.from('org_members').insert({
      organization_id: orgId,
      user_id: manager.id,
      org_role_id: role.id,
    });
    if (memberError) throw new Error(memberError.message);
  });

  afterAll(async () => {
    if (eventIds.length > 0)
      await service.from('stripe_webhook_events').delete().in('id', eventIds);
    if (invoiceIds.length > 0) {
      await service.from('payments').delete().in('stripe_invoice_id', invoiceIds);
    }
    if (subscriptionIds.length > 0) {
      await service
        .from('billing_subscriptions')
        .delete()
        .in('stripe_subscription_id', subscriptionIds);
    }
    if (customerIds.length > 0) {
      await service.from('billing_customers').delete().in('stripe_customer_id', customerIds);
    }
    if (student) {
      await service.from('profiles').update({ personal_plan_key: 'base' }).eq('id', student.id);
    }
    if (manager) {
      await service.from('profiles').update({ personal_plan_key: 'launch' }).eq('id', manager.id);
    }
    if (orgId) await cleanupOrganizationDeep(orgId);
  });

  it('activates a personal plan once, then downgrades on deletion', async () => {
    const stripeCustomerId = tagId('cus_student');
    const stripeSubscriptionId = tagId('sub_student');
    const sessionId = tagId('cs_student');
    const eventId = tagId('evt_checkout_student');
    eventIds.push(eventId);
    subscriptionIds.push(stripeSubscriptionId);
    customerIds.push(stripeCustomerId);

    const metadata = userMetadata(student.id, 'spark');
    currentSubscription = subscriptionFixture({
      id: stripeSubscriptionId,
      customer: stripeCustomerId,
      metadata,
      priceId: PRICE_SPARK,
    });

    const checkout = event({
      id: eventId,
      type: 'checkout.session.completed',
      created: nextCreated(),
      object: {
        id: sessionId,
        object: 'checkout.session',
        customer: stripeCustomerId,
        subscription: stripeSubscriptionId,
        payment_status: 'paid',
        metadata,
        client_reference_id: student.id,
      },
    });

    await expect(deliver(checkout)).resolves.toEqual({
      success: true,
      data: { received: true },
    });
    expect(await profilePlan(student.id)).toBe('spark');
    expect((await eventRow(eventId)).status).toBe('processed');

    // Replay the same event id: no second entitlement write can be observed,
    // and the event table answers duplicate instead of re-running.
    const replay = await deliver(checkout);
    expect(replay).toEqual({ success: true, data: { received: true, duplicate: true } });
    expect(await profilePlan(student.id)).toBe('spark');

    const mirrors = await subscriptionsFor(stripeSubscriptionId);
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]).toMatchObject({
      user_id: student.id,
      organization_id: null,
      checkout_session_id: sessionId,
      plan_key: 'spark',
      status: 'active',
    });

    // customer.subscription.deleted → the free student tier.
    currentSubscription = subscriptionFixture({
      id: stripeSubscriptionId,
      customer: stripeCustomerId,
      metadata,
      priceId: PRICE_SPARK,
      status: 'canceled',
      canceledAt: nextCreated(),
    });
    const deletedId = tagId('evt_sub_deleted');
    eventIds.push(deletedId);
    await deliver(
      event({
        id: deletedId,
        type: 'customer.subscription.deleted',
        created: nextCreated(),
        object: currentSubscription,
      }),
    );

    expect(await profilePlan(student.id)).toBe('base');
  });

  it('writes one payments row per paid invoice, even on replay', async () => {
    const stripeCustomerId = tagId('cus_invoice');
    const stripeSubscriptionId = tagId('sub_invoice');
    const invoiceId = tagId('in_first');
    invoiceIds.push(invoiceId);
    subscriptionIds.push(stripeSubscriptionId);
    customerIds.push(stripeCustomerId);

    const metadata = userMetadata(student.id, 'spark');
    currentSubscription = subscriptionFixture({
      id: stripeSubscriptionId,
      customer: stripeCustomerId,
      metadata,
      priceId: PRICE_SPARK,
    });

    const checkoutId = tagId('evt_checkout_invoice');
    eventIds.push(checkoutId);
    await deliver(
      event({
        id: checkoutId,
        type: 'checkout.session.completed',
        created: nextCreated(),
        object: {
          id: tagId('cs_invoice'),
          object: 'checkout.session',
          customer: stripeCustomerId,
          subscription: stripeSubscriptionId,
          payment_status: 'paid',
          metadata,
          client_reference_id: student.id,
        },
      }),
    );

    const invoice = {
      id: invoiceId,
      object: 'invoice',
      customer: stripeCustomerId,
      amount_paid: 999,
      currency: 'pln',
      parent: { subscription_details: { subscription: stripeSubscriptionId, metadata } },
      status_transitions: { paid_at: nextCreated() },
      hosted_invoice_url: 'https://invoice.stripe.test/first',
      invoice_pdf: 'https://invoice.stripe.test/first.pdf',
      billing_reason: 'subscription_create',
    };

    const paidId = tagId('evt_invoice_paid');
    eventIds.push(paidId);
    await deliver(
      event({ id: paidId, type: 'invoice.paid', created: nextCreated(), object: invoice }),
    );

    let rows = await paymentsForInvoice(invoiceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: student.id,
      organization_id: null,
      plan_key: 'spark',
      provider: 'stripe',
      amount: 999,
      currency: 'PLN',
      stripe_subscription_id: stripeSubscriptionId,
      status: 'paid',
    });

    // Same invoice, different event id (Stripe can deliver twice) → the
    // partial unique index still leaves exactly one row.
    const replayId = tagId('evt_invoice_paid_replay');
    eventIds.push(replayId);
    await deliver(
      event({ id: replayId, type: 'invoice.paid', created: nextCreated(), object: invoice }),
    );

    rows = await paymentsForInvoice(invoiceId);
    expect(rows).toHaveLength(1);

    // A renewal invoice is a second row for the same subscription and must
    // not reuse the (unique) checkout session id.
    const renewalId = tagId('in_renewal');
    invoiceIds.push(renewalId);
    const renewalEventId = tagId('evt_invoice_renewal');
    eventIds.push(renewalEventId);
    await deliver(
      event({
        id: renewalEventId,
        type: 'invoice.paid',
        created: nextCreated(),
        object: {
          ...invoice,
          id: renewalId,
          billing_reason: 'subscription_cycle',
          status_transitions: { paid_at: nextCreated() },
        },
      }),
    );

    const renewalRows = await paymentsForInvoice(renewalId);
    expect(renewalRows).toHaveLength(1);
    expect(renewalRows[0].stripe_checkout_session_id).toBeNull();
    expect(await paymentsForInvoice(invoiceId)).toHaveLength(1);

    // A failed renewal keeps the plan and writes no payments row.
    const failedInvoiceId = tagId('in_failed');
    invoiceIds.push(failedInvoiceId);
    const failedId = tagId('evt_invoice_failed');
    eventIds.push(failedId);
    await deliver(
      event({
        id: failedId,
        type: 'invoice.payment_failed',
        created: nextCreated(),
        object: {
          ...invoice,
          id: failedInvoiceId,
          billing_reason: 'subscription_cycle',
        },
      }),
    );

    expect(await profilePlan(student.id)).toBe('spark');
    const mirrors = await subscriptionsFor(stripeSubscriptionId);
    expect(mirrors[0].status).toBe('past_due');
    expect(await paymentsForInvoice(failedInvoiceId)).toHaveLength(0);
  });

  it('applies an organization purchase through apply_org_plan only', async () => {
    const stripeCustomerId = tagId('cus_org');
    const stripeSubscriptionId = tagId('sub_org');
    subscriptionIds.push(stripeSubscriptionId);
    customerIds.push(stripeCustomerId);

    const metadata = orgMetadata(orgId, manager.id, 'hub');
    currentSubscription = subscriptionFixture({
      id: stripeSubscriptionId,
      customer: stripeCustomerId,
      metadata,
      priceId: PRICE_HUB,
    });

    const checkoutId = tagId('evt_checkout_org');
    eventIds.push(checkoutId);
    await deliver(
      event({
        id: checkoutId,
        type: 'checkout.session.completed',
        created: nextCreated(),
        object: {
          id: tagId('cs_org'),
          object: 'checkout.session',
          customer: stripeCustomerId,
          subscription: stripeSubscriptionId,
          payment_status: 'paid',
          metadata,
          client_reference_id: orgId,
        },
      }),
    );

    expect(await orgPlan(orgId)).toBe('hub');
    // ADR-0007: the buyer's personal plan is untouched.
    expect(await profilePlan(manager.id)).toBe('launch');

    const mirrors = await subscriptionsFor(stripeSubscriptionId);
    expect(mirrors[0]).toMatchObject({
      user_id: null,
      organization_id: orgId,
      purchaser_user_id: manager.id,
      plan_key: 'hub',
    });

    currentSubscription = subscriptionFixture({
      id: stripeSubscriptionId,
      customer: stripeCustomerId,
      metadata,
      priceId: PRICE_HUB,
      status: 'canceled',
      canceledAt: nextCreated(),
    });
    const deletedId = tagId('evt_org_deleted');
    eventIds.push(deletedId);
    await deliver(
      event({
        id: deletedId,
        type: 'customer.subscription.deleted',
        created: nextCreated(),
        object: currentSubscription,
      }),
    );

    expect(await orgPlan(orgId)).toBe('launch');
    expect(await profilePlan(manager.id)).toBe('launch');
  });

  it('rejects a tampered signature before touching the database', async () => {
    const evt = event({
      id: tagId('evt_tampered'),
      type: 'invoice.paid',
      created: nextCreated(),
      object: { id: tagId('in_tampered'), object: 'invoice' },
    });

    const result = await webhookService.handle(JSON.stringify(evt), 't=1,v1=not-a-signature');

    expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
    const { data } = await service.from('stripe_webhook_events').select('id').eq('id', evt.id);
    expect(data ?? []).toHaveLength(0);
  });
});
