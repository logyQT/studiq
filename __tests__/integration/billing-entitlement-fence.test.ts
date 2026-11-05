import { SupabaseStripeWebhookRepository } from '@studiq/server/lib/payment/stripe-webhook.repository';
import { EntitlementService } from '@studiq/server/services/entitlement.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import { createServiceClient } from '#test/integration/helpers';

/**
 * Regression for the #662 security review: the entitlement write must be
 * fenced by the subscription mirror's freshness in the database, not by a
 * separate read in the webhook process.
 *
 * `apply_entitlement_fenced` locks the mirror row and refuses a write whose
 * `eventCreated` is older than `last_event_created`. This suite drives the real
 * RPC (no Stripe network) and asserts the profile plan is untouched when the
 * fence rejects the write.
 */
const PASSWORD = 'BillingFence!';
const RUN = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const service = createServiceClient();
const entitlements = new EntitlementService(() => service);
const repository = new SupabaseStripeWebhookRepository(() => service);

let user: TestUserFixture;
let customerId: string;
const subscriptionId = `sub_fence_${RUN}`;

async function profilePlan(): Promise<string | null> {
  const { data, error } = await service
    .from('profiles')
    .select('personal_plan_key')
    .eq('id', user.id)
    .single();
  if (error) throw new Error(error.message);
  return data.personal_plan_key;
}

async function setMirrorFreshness(lastEventCreated: number): Promise<void> {
  const { error } = await service
    .from('billing_subscriptions')
    .update({ last_event_created: lastEventCreated })
    .eq('stripe_subscription_id', subscriptionId);
  if (error) throw new Error(error.message);
}

async function setMirrorGeneration(snapshotGeneration: number): Promise<void> {
  const { error } = await service
    .from('billing_subscriptions')
    .update({ snapshot_generation: snapshotGeneration })
    .eq('stripe_subscription_id', subscriptionId);
  if (error) throw new Error(error.message);
}

function upsertInput(overrides: {
  status?: string;
  expectedGeneration?: number;
  eventCreated?: number;
}) {
  return {
    stripeSubscriptionId: subscriptionId,
    billingCustomerId: customerId,
    userId: user.id,
    organizationId: null,
    purchaserUserId: user.id,
    checkoutSessionId: `cs_fence_${RUN}`,
    planKey: 'spark',
    priceId: `price_fence_${RUN}`,
    status: overrides.status ?? 'active',
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: null,
    lastEventCreated: 200,
    eventCreated: overrides.eventCreated ?? 200,
    expectedGeneration: overrides.expectedGeneration ?? 0,
    livemode: false,
  };
}

beforeAll(async () => {
  user = await createTestUser({ role: 'student', password: PASSWORD });

  await service.from('payments').delete().eq('user_id', user.id);
  await service.from('billing_subscriptions').delete().eq('user_id', user.id);
  await service.from('billing_customers').delete().eq('user_id', user.id);

  const { data: customer, error: customerError } = await service
    .from('billing_customers')
    .insert({
      user_id: user.id,
      stripe_customer_id: `cus_fence_${RUN}`,
      livemode: false,
    })
    .select('id')
    .single();
  if (customerError) throw new Error(customerError.message);
  customerId = customer.id;

  const { error: subscriptionError } = await service.from('billing_subscriptions').insert({
    stripe_subscription_id: subscriptionId,
    billing_customer_id: customerId,
    user_id: user.id,
    purchaser_user_id: user.id,
    checkout_session_id: `cs_fence_${RUN}`,
    plan_key: 'spark',
    price_id: `price_fence_${RUN}`,
    status: 'active',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    last_event_created: 200,
    livemode: false,
  });
  if (subscriptionError) throw new Error(subscriptionError.message);
});

afterAll(async () => {
  await service.from('payments').delete().eq('user_id', user.id);
  await service.from('billing_subscriptions').delete().eq('user_id', user.id);
  await service.from('billing_customers').delete().eq('user_id', user.id);
  if (user?.id) await service.auth.admin.deleteUser(user.id).catch(() => {});
});

describe('entitlement freshness fence (#662)', () => {
  it('refuses an entitlement write older than the subscription mirror', async () => {
    await expect(
      entitlements.applyPlanFenced({ type: 'user', userId: user.id }, 'spark', {
        stripeSubscriptionId: subscriptionId,
        eventCreated: 100,
        snapshotGeneration: 0,
      }),
    ).resolves.toEqual({ success: true, data: 'stale' });

    expect(await profilePlan()).toBe('base');
  });

  it('applies the write at the mirror freshness', async () => {
    await expect(
      entitlements.applyPlanFenced({ type: 'user', userId: user.id }, 'spark', {
        stripeSubscriptionId: subscriptionId,
        eventCreated: 200,
        snapshotGeneration: 0,
      }),
    ).resolves.toEqual({ success: true, data: 'applied' });

    expect(await profilePlan()).toBe('spark');
  });

  it('fences out the older writer after a newer event advances the mirror', async () => {
    await setMirrorFreshness(300);

    await expect(
      entitlements.applyPlanFenced({ type: 'user', userId: user.id }, 'ace', {
        stripeSubscriptionId: subscriptionId,
        eventCreated: 250,
        snapshotGeneration: 0,
      }),
    ).resolves.toEqual({ success: true, data: 'stale' });

    // The newer downgrade (or any newer plan) is not overwritten.
    expect(await profilePlan()).toBe('spark');
  });

  it('refuses an equal-timestamp write when a newer generation owns the mirror', async () => {
    await setMirrorFreshness(200);
    await setMirrorGeneration(7);

    await expect(
      entitlements.applyPlanFenced({ type: 'user', userId: user.id }, 'ace', {
        stripeSubscriptionId: subscriptionId,
        eventCreated: 200,
        snapshotGeneration: 0,
      }),
    ).resolves.toEqual({ success: true, data: 'stale' });

    expect(await profilePlan()).toBe('spark');
  });

  it('refuses to write without a mirror row to fence against', async () => {
    await expect(
      entitlements.applyPlanFenced({ type: 'user', userId: user.id }, 'ace', {
        stripeSubscriptionId: `sub_missing_${RUN}`,
        eventCreated: 999,
        snapshotGeneration: 0,
      }),
    ).resolves.toEqual({ success: true, data: 'stale' });

    expect(await profilePlan()).toBe('spark');
  });

  it('orders two same-second snapshots by generation instead of event time', async () => {
    await setMirrorFreshness(200);
    await setMirrorGeneration(0);

    // Both handlers read generation 0 before retrieving their snapshot. The
    // active write lands first...
    await expect(repository.upsertSubscription(upsertInput({ status: 'active' }))).resolves.toEqual(
      {
        success: true,
        data: { outcome: 'applied', generation: 1 },
      },
    );

    // ...and the same-second cancellation that still expects generation 0 is a
    // conflict, not an allowed equal-timestamp overwrite.
    await expect(
      repository.upsertSubscription(upsertInput({ status: 'canceled', expectedGeneration: 0 })),
    ).resolves.toEqual({ success: true, data: { outcome: 'conflict', generation: null } });

    // The retry re-reads generation 1 and applies the cancellation.
    await expect(
      repository.upsertSubscription(upsertInput({ status: 'canceled', expectedGeneration: 1 })),
    ).resolves.toEqual({
      success: true,
      data: { outcome: 'applied', generation: 2 },
    });
  });
});
