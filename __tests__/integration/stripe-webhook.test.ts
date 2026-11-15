import { STRIPE_API_VERSION, createStripeClient } from '@studiq/server/lib/payment/stripe-client';
import type { StripeClient } from '@studiq/server/lib/payment/stripe-client';
import { SupabaseStripeWebhookRepository } from '@studiq/server/lib/payment/stripe-webhook.repository';
import { success } from '@studiq/server/lib/service-result';
import { EntitlementService } from '@studiq/server/services/entitlement.service';
import { StripeWebhookService } from '@studiq/server/services/stripe-webhook.service';
import { dbRows } from '@studiq/server/lib/supabase/rows';
// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asJson } from '#test/helpers/json';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import { cleanupOrganizationDeep, createServiceClient } from '#test/integration/helpers';
import { requiredAt } from '#test/integration/test-utils';

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
  return asJson<Stripe.Subscription>({
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
  });
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
  return asJson<Stripe.Event>({
    id: input.id,
    object: 'event',
    api_version: STRIPE_API_VERSION,
    created: input.created,
    livemode: false,
    type: input.type,
    data: { object: input.object },
  });
}

describe('Stripe webhook → entitlement sync (#662 §10.2)', () => {
  const service = createServiceClient();
  // `createStripeClient` only stores the key; no request is made by the
  // signature helper or by the faked `subscriptions.retrieve`.
  const real = createStripeClient('sk_test_integration_only');
  let currentSubscription: Stripe.Subscription;
  const client: StripeClient = {
    ...real,
    // These fixtures deliberately use prices outside `stripe_prices`. The
    // offline lookup must be a permanent `resource_missing` so the resolver
    // takes the metadata fallback instead of treating it as a retryable error.
    prices: {
      retrieve: () =>
        Promise.reject(
          Object.assign(new Error('offline price lookup'), {
            type: 'StripeInvalidRequestError',
            code: 'resource_missing',
          }),
        ),
    },
    subscriptions: {
      retrieve: () => Promise.resolve(currentSubscription),
      update: () => Promise.resolve(currentSubscription),
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
    return dbRows(data);
  }

  async function paymentsForInvoice(invoiceId: string) {
    const { data, error } = await service
      .from('payments')
      .select('*')
      .eq('stripe_invoice_id', invoiceId);
    if (error) throw new Error(error.message);
    return dbRows(data);
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
    if (orgError) throw new Error(orgError.message);
    orgId = org.id;

    const { data: role, error: roleError } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    if (roleError) throw new Error(roleError.message);

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
    await service.from('profiles').update({ personal_plan_key: 'base' }).eq('id', student.id);
    await service.from('profiles').update({ personal_plan_key: 'launch' }).eq('id', manager.id);
    if (orgId) await cleanupOrganizationDeep(orgId);
    for (const user of [student, manager]) {
      await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
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
    // The success page waits for this marker, not the billed mirror row.
    expect(requiredAt(mirrors, 0, 'billing mirror').entitlement_applied_plan_key).toBe('spark');

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

  it('clears the pending marker only when it matches and preserves freshness', async () => {
    const repository = new SupabaseStripeWebhookRepository(() => service);
    const stripeCustomerId = tagId('cus_marker');
    const stripeSubscriptionId = tagId('sub_marker');
    customerIds.push(stripeCustomerId);
    subscriptionIds.push(stripeSubscriptionId);

    // Earlier cases already created this user's customer mapping; reuse it
    // instead of violating the one-customer-per-(owner, mode) index.
    const { data: existingCustomer, error: existingError } = await service
      .from('billing_customers')
      .select('id')
      .eq('user_id', student.id)
      .eq('livemode', false)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    let billingCustomerId = existingCustomer?.id;
    if (!billingCustomerId) {
      const { data: customer, error: customerError } = await service
        .from('billing_customers')
        .insert({
          user_id: student.id,
          organization_id: null,
          stripe_customer_id: stripeCustomerId,
          livemode: false,
        })
        .select('id')
        .single();
      if (customerError) {
        throw new Error(customerError.message);
      }
      billingCustomerId = customer.id;
    }

    const { error: subscriptionError } = await service.from('billing_subscriptions').insert({
      stripe_subscription_id: stripeSubscriptionId,
      billing_customer_id: billingCustomerId,
      user_id: student.id,
      plan_key: 'spark',
      price_id: 'price_marker_test',
      status: 'active',
      pending_plan_key: 'ace',
      last_event_created: 4242,
      livemode: false,
    });
    if (subscriptionError) throw new Error(subscriptionError.message);

    async function markerRow() {
      const { data, error } = await service
        .from('billing_subscriptions')
        .select('pending_plan_key, last_event_created')
        .eq('stripe_subscription_id', stripeSubscriptionId)
        .single();
      if (error) throw new Error(error.message);
      return data;
    }

    try {
      // A different target must not be discarded by a stale release request.
      await expect(
        repository.clearPendingPlanIfApplied(stripeSubscriptionId, 'spark'),
      ).resolves.toEqual(success(undefined));
      expect(await markerRow()).toMatchObject({
        pending_plan_key: 'ace',
        last_event_created: 4242,
      });

      // Matching target clears, and the freshness value is untouched (the clear
      // must never masquerade as a newer Stripe event).
      await expect(
        repository.clearPendingPlanIfApplied(stripeSubscriptionId, 'ace'),
      ).resolves.toEqual(success(undefined));
      expect(await markerRow()).toMatchObject({
        pending_plan_key: null,
        last_event_created: 4242,
      });
    } finally {
      // Later cases activate another subscription for this same seeded user;
      // an active marker row would trip the duplicate-subscription guard.
      await service
        .from('billing_subscriptions')
        .delete()
        .eq('stripe_subscription_id', stripeSubscriptionId);
    }
  });

  it('writes one payments row per paid invoice, even on replay', async () => {
    // One Stripe customer per owner/mode: the earlier checkout test already
    // created this user's mapping, so reuse the same customer id.
    const stripeCustomerId = tagId('cus_student');
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
    expect(requiredAt(renewalRows, 0, 'renewal payment').stripe_checkout_session_id).toBeNull();
    expect(await paymentsForInvoice(invoiceId)).toHaveLength(1);

    // A failed renewal keeps the plan and writes no payments row. Stripe now
    // reports the subscription as past_due, and the handler follows that
    // current snapshot instead of synthesising a status from the invoice.
    currentSubscription = subscriptionFixture({
      id: stripeSubscriptionId,
      customer: stripeCustomerId,
      metadata,
      priceId: PRICE_SPARK,
      status: 'past_due',
    });
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
    expect(requiredAt(mirrors, 0, 'billing mirror').status).toBe('past_due');
    expect(await paymentsForInvoice(failedInvoiceId)).toHaveLength(0);
  });

  it('rejects a second Stripe customer for an owner that is already mapped', async () => {
    const repository = new SupabaseStripeWebhookRepository(() => service);
    const foreignCustomerId = tagId('cus_foreign');
    customerIds.push(foreignCustomerId);

    await expect(
      repository.ensureCustomer({
        stripeCustomerId: foreignCustomerId,
        userId: student.id,
        organizationId: null,
        livemode: false,
      }),
    ).resolves.toEqual({ success: false, error: 'CONFLICT' });
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

  it('reclaims a stale processing event instead of losing it', async () => {
    const staleId = tagId('evt_stale_processing');
    eventIds.push(staleId);
    const created = nextCreated();

    const { error: seedError } = await service.from('stripe_webhook_events').insert({
      id: staleId,
      type: 'checkout.session.expired',
      livemode: false,
      event_created: created,
      status: 'processing',
      received_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    if (seedError) throw new Error(seedError.message);

    const result = await deliver(
      event({
        id: staleId,
        type: 'checkout.session.expired',
        created,
        object: { id: tagId('cs_stale'), object: 'checkout.session' },
      }),
    );

    // The claim lease expired, so the handler runs again; a recent
    // `processing` row would have been answered as a duplicate.
    expect(result).toEqual({ success: true, data: { received: true, ignored: true } });
    expect((await eventRow(staleId)).status).toBe('ignored');
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

describe('Stripe webhook claim lease (#662)', () => {
  const service = createServiceClient();
  const repository = new SupabaseStripeWebhookRepository(() => service);
  const id = `evt_lease_${tag}`;
  const input = {
    id,
    type: 'invoice.paid',
    livemode: false,
    apiVersion: STRIPE_API_VERSION,
    eventCreated: Math.floor(Date.now() / 1000),
  };

  afterAll(async () => {
    await service.from('stripe_webhook_events').delete().eq('id', id);
  });

  it('returns busy for a live lease, reclaims a stale one and keeps processed duplicates at 200', async () => {
    const { error: insertError } = await service.from('stripe_webhook_events').insert({
      id,
      type: input.type,
      api_version: input.apiVersion,
      livemode: false,
      event_created: input.eventCreated,
      status: 'processing',
      received_at: new Date().toISOString(),
    });
    if (insertError) throw new Error(insertError.message);

    await expect(repository.claimEvent(input)).resolves.toEqual({
      success: true,
      data: { outcome: 'busy', receivedAt: null },
    });

    const { error: staleError } = await service
      .from('stripe_webhook_events')
      .update({ received_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
      .eq('id', id);
    if (staleError) throw new Error(staleError.message);

    await expect(repository.claimEvent(input)).resolves.toMatchObject({
      success: true,
      data: { outcome: 'retry' },
    });

    const { error: processedError } = await service
      .from('stripe_webhook_events')
      .update({ status: 'processed' })
      .eq('id', id);
    if (processedError) throw new Error(processedError.message);

    await expect(repository.claimEvent(input)).resolves.toEqual({
      success: true,
      data: { outcome: 'duplicate', receivedAt: null },
    });
  });
});
