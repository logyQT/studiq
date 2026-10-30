import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import { createServiceClient } from '#test/integration/helpers';

// Schema-level regression tests for #662 (billing mapping + webhook
// idempotency). No Stripe network and no app routes: this suite pins the
// constraints the Stripe gateway will rely on, plus the RLS surface that keeps
// customer ids and webhook events away from clients.

const PASSWORD = 'BillingSchema!';
const RUN = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const service = createServiceClient();

let owner: TestUserFixture;
let other: TestUserFixture;
let ownerSession: SupabaseClient;
let otherSession: SupabaseClient;
let ownerCustomerId: string;
let ownerSubscriptionId: string;

function tag(suffix: string): string {
  return `${RUN}-${suffix}`;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    stripe_subscription_id: `sub_test_${tag('owner')}`,
    billing_customer_id: ownerCustomerId,
    user_id: owner.id,
    purchaser_user_id: owner.id,
    checkout_session_id: `cs_test_${tag('owner')}`,
    plan_key: 'spark',
    price_id: `price_test_${tag('spark')}`,
    status: 'active',
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    livemode: false,
    ...overrides,
  };
}

beforeAll(async () => {
  owner = await createTestUser({ role: 'student', password: PASSWORD });
  other = await createTestUser({ role: 'student', password: PASSWORD });

  // A migrated-but-not-reset database may already carry rows for these users.
  await service.from('payments').delete().in('user_id', [owner.id, other.id]);
  await service.from('billing_customers').delete().in('user_id', [owner.id, other.id]);

  const { data: customers, error: customerError } = await service
    .from('billing_customers')
    .insert([
      { user_id: owner.id, stripe_customer_id: `cus_test_${tag('owner')}`, livemode: false },
      { user_id: other.id, stripe_customer_id: `cus_test_${tag('other')}`, livemode: false },
    ])
    .select('id, user_id');
  if (customerError) throw new Error(customerError.message);

  ownerCustomerId = customers.find((c) => c.user_id === owner.id)!.id;

  const { data: subscription, error: subscriptionError } = await service
    .from('billing_subscriptions')
    .insert(subscriptionRow())
    .select('id')
    .single();
  if (subscriptionError) throw new Error(subscriptionError.message);
  ownerSubscriptionId = subscription.id;

  ownerSession = await signIn(owner.email);
  otherSession = await signIn(other.email);
});

afterAll(async () => {
  const userIds = [owner?.id, other?.id].filter(Boolean) as string[];
  await service.from('payments').delete().in('user_id', userIds);
  await service.from('billing_subscriptions').delete().in('user_id', userIds);
  await service.from('billing_customers').delete().in('user_id', userIds);
  await service.from('stripe_prices').delete().like('stripe_price_id', `price_test_${RUN}%`);
  await service.from('stripe_webhook_events').delete().like('id', `evt_${RUN}%`);

  for (const user of [owner, other]) {
    if (user?.id) await service.auth.admin.deleteUser(user.id).catch(() => {});
  }
});

describe('billing schema (#662)', () => {
  describe('billing_customers', () => {
    it('allows one customer per owner and live mode', async () => {
      const duplicate = await service.from('billing_customers').insert({
        user_id: owner.id,
        stripe_customer_id: `cus_test_${tag('duplicate')}`,
        livemode: false,
      });
      expect(duplicate.error?.code).toBe('23505');
    });

    it('treats test and live customers as different mappings', async () => {
      const live = await service
        .from('billing_customers')
        .insert({
          user_id: owner.id,
          stripe_customer_id: `cus_test_${tag('live-owner')}`,
          livemode: true,
        })
        .select('id')
        .single();

      expect(live.error).toBeNull();
      await service.from('billing_customers').delete().eq('id', live.data!.id);
    });

    it('requires exactly one owner', async () => {
      const orphan = await service.from('billing_customers').insert({
        stripe_customer_id: `cus_test_${tag('orphan')}`,
        livemode: false,
      });
      expect(orphan.error?.code).toBe('23514');
    });

    it('never exposes customer ids to clients', async () => {
      const asOwner = await ownerSession.from('billing_customers').select('stripe_customer_id');
      expect(asOwner.error?.code).toBe('42501');

      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const asAnon = await anon.from('billing_customers').select('id');
      expect(asAnon.error?.code).toBe('42501');
    });
  });

  describe('billing_subscriptions', () => {
    it('allows only one active subscription per owner and live mode', async () => {
      const duplicate = await service.from('billing_subscriptions').insert(
        subscriptionRow({
          stripe_subscription_id: `sub_test_${tag('dup-active')}`,
          checkout_session_id: `cs_test_${tag('dup-active')}`,
        }),
      );
      expect(duplicate.error?.code).toBe('23505');
    });

    it('keeps canceled subscriptions as history without blocking a new one', async () => {
      const canceled = await service
        .from('billing_subscriptions')
        .insert(
          subscriptionRow({
            stripe_subscription_id: `sub_test_${tag('old')}`,
            checkout_session_id: null,
            status: 'canceled',
            canceled_at: new Date().toISOString(),
          }),
        )
        .select('id')
        .single();

      expect(canceled.error).toBeNull();
      await service.from('billing_subscriptions').delete().eq('id', canceled.data!.id);
    });

    it('requires a unique checkout session id', async () => {
      const duplicate = await service.from('billing_subscriptions').insert(
        subscriptionRow({
          stripe_subscription_id: `sub_test_${tag('dup-session')}`,
          checkout_session_id: `cs_test_${tag('owner')}`,
          status: 'canceled',
        }),
      );
      expect(duplicate.error?.code).toBe('23505');
    });

    it('requires exactly one owner', async () => {
      const orphan = await service.from('billing_subscriptions').insert(
        subscriptionRow({
          stripe_subscription_id: `sub_test_${tag('orphan')}`,
          checkout_session_id: null,
          user_id: null,
        }),
      );
      expect(orphan.error?.code).toBe('23514');
    });

    it('lets an owner read their rows but never write them', async () => {
      const own = await ownerSession
        .from('billing_subscriptions')
        .select('id, user_id, organization_id');
      expect(own.error).toBeNull();
      expect(own.data?.some((row) => row.id === ownerSubscriptionId)).toBe(true);
      expect(own.data?.every((row) => row.user_id === owner.id)).toBe(true);

      const foreign = await otherSession.from('billing_subscriptions').select('id, user_id');
      expect(foreign.error).toBeNull();
      expect(foreign.data?.some((row) => row.id === ownerSubscriptionId)).toBe(false);
      expect(foreign.data?.every((row) => row.user_id === other.id)).toBe(true);

      const insert = await ownerSession.from('billing_subscriptions').insert(
        subscriptionRow({
          stripe_subscription_id: `sub_test_${tag('forged')}`,
          checkout_session_id: null,
          status: 'canceled',
        }),
      );
      expect(insert.error?.code).toBe('42501');

      const update = await ownerSession
        .from('billing_subscriptions')
        .update({ plan_key: 'ace' })
        .eq('id', ownerSubscriptionId);
      expect(update.error?.code).toBe('42501');
    });
  });

  describe('stripe_prices and stripe_webhook_events', () => {
    it('keys prices by plan, cycle and live mode with a unique Price id', async () => {
      const price = {
        plan_key: 'spark',
        billing_cycle: 'monthly',
        stripe_price_id: `price_test_${tag('spark')}`,
        currency: 'PLN',
        unit_amount: 999,
        interval: 'month',
        livemode: false,
      };

      const first = await service.from('stripe_prices').insert(price);
      expect(first.error).toBeNull();

      const duplicateKey = await service.from('stripe_prices').insert({
        ...price,
        stripe_price_id: `price_test_${tag('spark-2')}`,
      });
      expect(duplicateKey.error?.code).toBe('23505');

      const duplicatePriceId = await service.from('stripe_prices').insert({
        ...price,
        plan_key: 'ace',
        stripe_price_id: price.stripe_price_id,
      });
      expect(duplicatePriceId.error?.code).toBe('23505');

      const asClient = await ownerSession.from('stripe_prices').select('stripe_price_id');
      expect(asClient.error?.code).toBe('42501');
    });

    it('deduplicates webhook events by event id', async () => {
      const event = {
        id: `evt_${RUN}`,
        type: 'invoice.paid',
        api_version: '2026-10-28.endive',
        livemode: false,
        event_created: Math.floor(Date.now() / 1000),
      };

      expect((await service.from('stripe_webhook_events').insert(event)).error).toBeNull();
      expect((await service.from('stripe_webhook_events').insert(event)).error?.code).toBe('23505');

      const asClient = await ownerSession.from('stripe_webhook_events').select('id');
      expect(asClient.error?.code).toBe('42501');
    });
  });

  describe('payments', () => {
    it('stores a Stripe invoice row without a checkout session', async () => {
      const payment = await service
        .from('payments')
        .insert({
          user_id: owner.id,
          plan_key: 'spark',
          plan_name: 'StudiQ Spark',
          amount: 999,
          currency: 'PLN',
          provider: 'stripe',
          stripe_invoice_id: `in_test_${tag('invoice')}`,
          stripe_customer_id: `cus_test_${tag('owner')}`,
          hosted_invoice_url: 'https://invoice.stripe.com/i/test',
        })
        .select('id')
        .single();

      expect(payment.error).toBeNull();
      await service.from('payments').delete().eq('id', payment.data!.id);
    });

    it('rejects duplicate invoice ids', async () => {
      const invoiceId = `in_test_${tag('dup-invoice')}`;
      const row = {
        user_id: owner.id,
        plan_key: 'spark',
        plan_name: 'StudiQ Spark',
        amount: 999,
        currency: 'PLN',
        provider: 'stripe',
        stripe_invoice_id: invoiceId,
      };

      expect((await service.from('payments').insert(row)).error).toBeNull();
      expect((await service.from('payments').insert(row)).error?.code).toBe('23505');

      await service.from('payments').delete().eq('stripe_invoice_id', invoiceId);
    });

    it('rejects a row with no external reference and an unknown provider', async () => {
      const noRef = await service.from('payments').insert({
        user_id: owner.id,
        plan_key: 'spark',
        plan_name: 'StudiQ Spark',
        amount: 0,
        provider: 'stripe',
      });
      expect(noRef.error?.code).toBe('23514');

      const badProvider = await service.from('payments').insert({
        user_id: owner.id,
        plan_key: 'spark',
        plan_name: 'StudiQ Spark',
        amount: 0,
        provider: 'paypal',
        session_id: `mock_${tag('bad-provider')}`,
      });
      expect(badProvider.error?.code).toBe('23514');
    });
  });
});
