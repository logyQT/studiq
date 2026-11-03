import { ORG_ADMIN_ROLE } from '@studiq/authz';
import { type CatalogPlan, type ListedPrice } from '@studiq/server/lib/payment/stripe-repository';
import { failure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role persistence for the Stripe webhook (#662 §6).
 *
 * The webhook is unauthenticated, so every read and write here runs on the
 * service-role client: `profiles`/`organizations` entitlement writes are
 * revoked for `authenticated`, and `stripe_webhook_events`, `stripe_prices`
 * and `billing_customers` have no client grants at all.
 *
 * The repository exists so `StripeWebhookService` can be unit-tested with a
 * plain fake, the same way `StripePaymentGateway` takes an injected
 * `StripeClient`. It never decides domain rules — only reads/writes rows.
 */

export type WebhookEventStatus = 'processing' | 'processed' | 'ignored' | 'failed';

/**
 * - `claimed`: a new event row was inserted, run the handler.
 * - `duplicate`: already processed/ignored/processing → 200 without writes.
 * - `retry`: a previous claim was abandoned → re-run the handler.
 *
 * `receivedAt` is the claim-lease token: it is renewed on every claim and
 * `finishEvent` only completes the row if the token still matches. That fences
 * a slow original handler out of the row after another delivery reclaimed it.
 */
export interface WebhookEventClaim {
  outcome: 'claimed' | 'duplicate' | 'retry';
  receivedAt: string | null;
}

export interface WebhookEventInput {
  id: string;
  type: string;
  livemode: boolean;
  apiVersion: string | null;
  eventCreated: number;
}

export interface CustomerRow {
  id: string;
  stripeCustomerId: string;
  userId: string | null;
  organizationId: string | null;
  livemode: boolean;
}

export interface EnsureCustomerInput {
  stripeCustomerId: string;
  userId: string | null;
  organizationId: string | null;
  livemode: boolean;
}

export interface SubscriptionMirror {
  id: string;
  stripeSubscriptionId: string;
  billingCustomerId: string;
  userId: string | null;
  organizationId: string | null;
  purchaserUserId: string | null;
  checkoutSessionId: string | null;
  planKey: string;
  priceId: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  lastEventCreated: number;
  livemode: boolean;
}

export interface SubscriptionUpsert {
  stripeSubscriptionId: string;
  billingCustomerId: string;
  userId: string | null;
  organizationId: string | null;
  purchaserUserId: string | null;
  checkoutSessionId: string | null;
  planKey: string;
  priceId: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  /** Value written to the row (`max(existing, event.created)`). */
  lastEventCreated: number;
  /**
   * The event's own timestamp. The write is conditional on
   * `last_event_created <= eventCreated`, so an older event can never overwrite
   * a newer snapshot. Equal timestamps are allowed (Stripe has 1 s resolution).
   */
  eventCreated: number;
  livemode: boolean;
}

/** `stale` = a newer event already wrote this subscription; skip entitlement. */
export type SubscriptionSyncOutcome = 'applied' | 'stale';

export interface ActiveSubscriptionRef {
  stripeSubscriptionId: string;
  planKey: string;
}

export interface PaymentRowInput {
  userId: string;
  organizationId: string | null;
  planKey: string;
  planName: string;
  amount: number;
  currency: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeInvoiceId: string;
  stripeCheckoutSessionId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  paidAt: string;
}

/** `duplicate` means the partial unique index on `stripe_invoice_id` won. */
export type PaymentInsertOutcome = 'inserted' | 'duplicate';

export interface StripeWebhookRepository {
  claimEvent(input: WebhookEventInput): Promise<ServiceResult<WebhookEventClaim>>;
  finishEvent(
    id: string,
    receivedAt: string,
    status: Exclude<WebhookEventStatus, 'processing'>,
    error?: string,
  ): Promise<ServiceResult<void>>;

  getSubscriptionByStripeId(id: string): Promise<ServiceResult<SubscriptionMirror | null>>;
  findCustomerByStripeId(
    stripeCustomerId: string,
    livemode: boolean,
  ): Promise<ServiceResult<CustomerRow | null>>;
  ensureCustomer(input: EnsureCustomerInput): Promise<ServiceResult<CustomerRow>>;
  upsertSubscription(input: SubscriptionUpsert): Promise<ServiceResult<SubscriptionSyncOutcome>>;
  attachCheckoutSession(
    stripeSubscriptionId: string,
    checkoutSessionId: string,
  ): Promise<ServiceResult<void>>;
  updateSubscriptionStatus(
    stripeSubscriptionId: string,
    status: string,
    lastEventCreated: number,
  ): Promise<ServiceResult<void>>;
  findActiveSubscription(
    owner: { type: 'user'; userId: string } | { type: 'org'; orgId: string },
    livemode: boolean,
  ): Promise<ServiceResult<ActiveSubscriptionRef | null>>;

  /** True while `receivedAt` is still the current claim lease for the event. */
  isClaimOwner(eventId: string, receivedAt: string): Promise<ServiceResult<boolean>>;

  getPlan(planKey: string): Promise<ServiceResult<CatalogPlan | null>>;
  findPrice(priceId: string, livemode: boolean): Promise<ServiceResult<ListedPrice | null>>;

  insertPayment(input: PaymentRowInput): Promise<ServiceResult<PaymentInsertOutcome>>;
  findOldestOrgAdmin(orgId: string): Promise<ServiceResult<string | null>>;
}

const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

/**
 * A `processing` claim older than this is treated as abandoned (the process
 * crashed / was killed / could not even mark the row `failed`). Stripe retries
 * for up to three days, so reclaiming the row is what stops an event from being
 * lost forever. Every handler writes absolute values, so a re-run is safe.
 */
const PROCESSING_LEASE_MS = 5 * 60 * 1000;

type CustomerRowShape = Pick<
  Database['public']['Tables']['billing_customers']['Row'],
  'id' | 'stripe_customer_id' | 'user_id' | 'organization_id' | 'livemode'
>;

function mapCustomer(row: CustomerRowShape): CustomerRow {
  return {
    id: row.id,
    stripeCustomerId: row.stripe_customer_id,
    userId: row.user_id,
    organizationId: row.organization_id,
    livemode: row.livemode,
  };
}

function mapSubscription(
  row: Database['public']['Tables']['billing_subscriptions']['Row'],
): SubscriptionMirror {
  return {
    id: row.id,
    stripeSubscriptionId: row.stripe_subscription_id,
    billingCustomerId: row.billing_customer_id,
    userId: row.user_id,
    organizationId: row.organization_id,
    purchaserUserId: row.purchaser_user_id,
    checkoutSessionId: row.checkout_session_id,
    planKey: row.plan_key,
    priceId: row.price_id,
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelAt: row.cancel_at,
    canceledAt: row.canceled_at,
    lastEventCreated: row.last_event_created,
    livemode: row.livemode,
  };
}

type PriceRowShape = Pick<
  Database['public']['Tables']['stripe_prices']['Row'],
  'plan_key' | 'stripe_price_id' | 'currency' | 'unit_amount' | 'interval' | 'active'
>;

function mapPrice(row: PriceRowShape): ListedPrice {
  return {
    planKey: row.plan_key,
    stripePriceId: row.stripe_price_id,
    currency: row.currency,
    unitAmount: row.unit_amount,
    interval: row.interval,
    active: row.active,
  };
}

export class SupabaseStripeWebhookRepository implements StripeWebhookRepository {
  constructor(
    private readonly createAdminClient: () => SupabaseClient<Database> = createServiceClient,
  ) {}

  async claimEvent(input: WebhookEventInput): Promise<ServiceResult<WebhookEventClaim>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('stripe_webhook_events')
      .insert({
        id: input.id,
        type: input.type,
        api_version: input.apiVersion,
        livemode: input.livemode,
        event_created: input.eventCreated,
      })
      .select('id, received_at')
      .maybeSingle();

    if (!error && data) {
      return success({ outcome: 'claimed', receivedAt: data.received_at });
    }
    if (!error) return failure('INTERNAL_SERVER');
    if (error.code !== '23505') return toDbFailure(error);

    // The event id is the dedupe key. A `failed` row is retried (Stripe's own
    // retry or a manual replay); a `processing` row is retried only once its
    // lease expired, so a crashed worker does not strand the event while two
    // concurrent deliveries still cannot both run the handler. Anything else is
    // a duplicate and must return 200 so Stripe stops retrying.
    const { data: existing, error: readError } = await supabase
      .from('stripe_webhook_events')
      .select('status, received_at')
      .eq('id', input.id)
      .maybeSingle();

    if (readError) return toDbFailure(readError);
    if (!existing) return failure('INTERNAL_SERVER');

    const isFailed = existing.status === 'failed';
    const isStaleProcessing =
      existing.status === 'processing' &&
      Date.now() - new Date(existing.received_at).getTime() >= PROCESSING_LEASE_MS;
    if (!isFailed && !isStaleProcessing) {
      return success({ outcome: 'duplicate', receivedAt: null });
    }

    // Conditional write = compare-and-swap: the loser of a concurrent retry
    // sees 0 updated rows. Updating `received_at` renews the lease, so a second
    // retry cannot pass the `.lt(staleBefore)` guard again.
    let claim = supabase
      .from('stripe_webhook_events')
      .update({ status: 'processing', error: null, received_at: new Date().toISOString() })
      .eq('id', input.id)
      .eq('status', existing.status);

    claim = isFailed
      ? claim
      : claim.lt('received_at', new Date(Date.now() - PROCESSING_LEASE_MS).toISOString());

    const { data: reclaimed, error: retryError } = await claim.select('id, received_at');

    if (retryError) return toDbFailure(retryError);
    if (!reclaimed || reclaimed.length === 0) {
      return success({ outcome: 'duplicate', receivedAt: null });
    }

    return success({ outcome: 'retry', receivedAt: reclaimed[0].received_at });
  }

  async finishEvent(
    id: string,
    receivedAt: string,
    status: Exclude<WebhookEventStatus, 'processing'>,
    error?: string,
  ): Promise<ServiceResult<void>> {
    const supabase = this.createAdminClient();
    const { error: writeError } = await supabase
      .from('stripe_webhook_events')
      .update({
        status,
        error: error ?? null,
        processed_at: status === 'failed' ? null : new Date().toISOString(),
      })
      .eq('id', id)
      // Fence on the claim lease: a slow original handler that lost the row to
      // a reclaim must not overwrite the newer attempt's result.
      .eq('received_at', receivedAt);

    if (writeError) return toDbFailure(writeError);
    return success(undefined);
  }

  async getSubscriptionByStripeId(id: string): Promise<ServiceResult<SubscriptionMirror | null>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('billing_subscriptions')
      .select('*')
      .eq('stripe_subscription_id', id)
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(data ? mapSubscription(data) : null);
  }

  async findCustomerByStripeId(
    stripeCustomerId: string,
    livemode: boolean,
  ): Promise<ServiceResult<CustomerRow | null>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('billing_customers')
      .select('id, stripe_customer_id, user_id, organization_id, livemode')
      .eq('stripe_customer_id', stripeCustomerId)
      .eq('livemode', livemode)
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(data ? mapCustomer(data) : null);
  }

  async ensureCustomer(input: EnsureCustomerInput): Promise<ServiceResult<CustomerRow>> {
    const byStripeId = await this.findCustomerByStripeId(input.stripeCustomerId, input.livemode);
    if (!byStripeId.success) return byStripeId;
    if (byStripeId.data) return success(byStripeId.data);

    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('billing_customers')
      .insert({
        user_id: input.userId,
        organization_id: input.organizationId,
        stripe_customer_id: input.stripeCustomerId,
        livemode: input.livemode,
      })
      .select('id, stripe_customer_id, user_id, organization_id, livemode')
      .maybeSingle();

    if (!error && data) return success(mapCustomer(data));
    if (!error) return failure('INTERNAL_SERVER');
    if (error.code !== '23505') return toDbFailure(error);

    // Either another event created the same customer mapping, or the owner
    // already had one from checkout. Re-read by stripe id first, then by owner;
    // the owner/mode unique index is the authority.
    const raced = await this.findCustomerByStripeId(input.stripeCustomerId, input.livemode);
    if (raced.success && raced.data) return success(raced.data);

    const ownerColumn = input.userId ? 'user_id' : 'organization_id';
    const ownerValue = input.userId ?? input.organizationId;
    if (!ownerValue) return failure('INTERNAL_SERVER');

    const { data: ownerRow, error: ownerError } = await supabase
      .from('billing_customers')
      .select('id, stripe_customer_id, user_id, organization_id, livemode')
      .eq(ownerColumn, ownerValue)
      .eq('livemode', input.livemode)
      .maybeSingle();

    if (ownerError) return toDbFailure(ownerError);
    if (ownerRow) return success(mapCustomer(ownerRow));

    return failure('INTERNAL_SERVER');
  }

  /**
   * Freshness-conditional write. `last_event_created <= event.created` is
   * evaluated by Postgres against the row at update time, so two events that
   * both read the same old mirror cannot let the older one win.
   */
  async upsertSubscription(
    input: SubscriptionUpsert,
  ): Promise<ServiceResult<SubscriptionSyncOutcome>> {
    const supabase = this.createAdminClient();
    const payload = {
      stripe_subscription_id: input.stripeSubscriptionId,
      billing_customer_id: input.billingCustomerId,
      user_id: input.userId,
      organization_id: input.organizationId,
      purchaser_user_id: input.purchaserUserId,
      checkout_session_id: input.checkoutSessionId,
      plan_key: input.planKey,
      price_id: input.priceId,
      billing_cycle: 'monthly',
      status: input.status,
      current_period_start: input.currentPeriodStart,
      current_period_end: input.currentPeriodEnd,
      cancel_at_period_end: input.cancelAtPeriodEnd,
      cancel_at: input.cancelAt,
      canceled_at: input.canceledAt,
      last_event_created: input.lastEventCreated,
      livemode: input.livemode,
    };

    const conditionalUpdate = () =>
      supabase
        .from('billing_subscriptions')
        .update(payload)
        .eq('stripe_subscription_id', input.stripeSubscriptionId)
        .lte('last_event_created', input.eventCreated)
        .select('id');

    const existing = await conditionalUpdate();
    if (existing.error) return toDbFailure(existing.error);
    if (existing.data && existing.data.length > 0) return success('applied');

    const inserted = await supabase.from('billing_subscriptions').insert(payload);
    if (!inserted.error) return success('applied');

    if (inserted.error.code !== '23505') return toDbFailure(inserted.error);

    // The row appeared between the update and the insert. Retry the
    // conditional update once; 0 rows now means the stored row is newer.
    if (inserted.error.message.includes('billing_subscriptions_one_active')) {
      return failure('CONFLICT');
    }

    const retried = await conditionalUpdate();
    if (retried.error) return toDbFailure(retried.error);
    return success(retried.data && retried.data.length > 0 ? 'applied' : 'stale');
  }

  /**
   * Fill `checkout_session_id` on a row written by another event, without
   * touching freshness-sensitive state. Used when a Checkout completion loses
   * the race to a later subscription event.
   */
  async attachCheckoutSession(
    stripeSubscriptionId: string,
    checkoutSessionId: string,
  ): Promise<ServiceResult<void>> {
    const supabase = this.createAdminClient();
    const { error } = await supabase
      .from('billing_subscriptions')
      .update({ checkout_session_id: checkoutSessionId })
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .is('checkout_session_id', null);

    if (error?.code === '23505') return success(undefined);
    if (error) return toDbFailure(error);
    return success(undefined);
  }

  async updateSubscriptionStatus(
    stripeSubscriptionId: string,
    status: string,
    lastEventCreated: number,
  ): Promise<ServiceResult<void>> {
    const supabase = this.createAdminClient();
    const { error } = await supabase
      .from('billing_subscriptions')
      .update({ status, last_event_created: lastEventCreated })
      .eq('stripe_subscription_id', stripeSubscriptionId);

    if (error) return toDbFailure(error);
    return success(undefined);
  }

  async findActiveSubscription(
    owner: { type: 'user'; userId: string } | { type: 'org'; orgId: string },
    livemode: boolean,
  ): Promise<ServiceResult<ActiveSubscriptionRef | null>> {
    const supabase = this.createAdminClient();
    const base = supabase
      .from('billing_subscriptions')
      .select('stripe_subscription_id, plan_key')
      .eq('livemode', livemode)
      .in('status', ACTIVE_SUBSCRIPTION_STATUSES);

    const { data, error } = await (
      owner.type === 'user'
        ? base.eq('user_id', owner.userId)
        : base.eq('organization_id', owner.orgId)
    ).maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return success(null);

    return success({
      stripeSubscriptionId: data.stripe_subscription_id,
      planKey: data.plan_key,
    });
  }

  async isClaimOwner(eventId: string, receivedAt: string): Promise<ServiceResult<boolean>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('stripe_webhook_events')
      .select('id')
      .eq('id', eventId)
      .eq('received_at', receivedAt)
      .eq('status', 'processing')
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(Boolean(data));
  }

  async getPlan(planKey: string): Promise<ServiceResult<CatalogPlan | null>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('key, name, price_monthly, currency, is_active, for_account_type')
      .eq('key', planKey)
      .maybeSingle();

    if (error) return toDbFailure(error);
    if (!data) return success(null);

    return success({
      key: data.key,
      name: data.name,
      priceMonthly: data.price_monthly ?? 0,
      currency: data.currency ?? 'PLN',
      isActive: data.is_active ?? true,
      forAccountType: data.for_account_type,
    });
  }

  async findPrice(priceId: string, livemode: boolean): Promise<ServiceResult<ListedPrice | null>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('stripe_prices')
      .select('plan_key, stripe_price_id, currency, unit_amount, interval, active')
      .eq('stripe_price_id', priceId)
      .eq('livemode', livemode)
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(data ? mapPrice(data) : null);
  }

  async insertPayment(input: PaymentRowInput): Promise<ServiceResult<PaymentInsertOutcome>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('payments')
      .insert({
        user_id: input.userId,
        organization_id: input.organizationId,
        plan_key: input.planKey,
        plan_name: input.planName,
        amount: input.amount,
        currency: input.currency,
        session_id: null,
        paid_at: input.paidAt,
        provider: 'stripe',
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
        stripe_invoice_id: input.stripeInvoiceId,
        stripe_checkout_session_id: input.stripeCheckoutSessionId,
        hosted_invoice_url: input.hostedInvoiceUrl,
        invoice_pdf_url: input.invoicePdfUrl,
        status: 'paid',
      })
      .select('id')
      .maybeSingle();

    if (!error && data) return success('inserted');
    // `payments_stripe_invoice_id_key` is the replay-safe key.
    if (error?.code === '23505') return success('duplicate');
    if (error) return toDbFailure(error);

    return failure('INTERNAL_SERVER');
  }

  async findOldestOrgAdmin(orgId: string): Promise<ServiceResult<string | null>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('org_members')
      .select('user_id, org_roles!inner(name)')
      .eq('organization_id', orgId)
      .eq('org_roles.name', ORG_ADMIN_ROLE)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(data?.user_id ?? null);
  }
}

export const stripeWebhookRepository = new SupabaseStripeWebhookRepository();
