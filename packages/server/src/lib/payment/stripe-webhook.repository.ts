import { ORG_ADMIN_ROLE } from '@studiq/authz';
import {
  type PaymentHistoryWriter,
  type PaymentRecordResult,
  paymentHistoryWriter,
} from '@studiq/server/lib/payment/payment-history.repository';
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
  /** Write-order tiebreaker for same-second events. */
  snapshotGeneration: number;
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
   * a newer snapshot. Equal timestamps are ordered by `expectedGeneration`.
   */
  eventCreated: number;
  /**
   * Generation read before the Stripe snapshot was retrieved. The update only
   * lands while the mirror still carries it; a concurrent write bumps the row
   * and makes this attempt a `conflict` (retryable) instead of overwriting a
   * fresher snapshot.
   */
  expectedGeneration: number;
  livemode: boolean;
}

/**
 * - `applied`: this snapshot owns the mirror; `generation` is what it wrote.
 * - `stale`: the event itself is older than the mirror; skip it.
 * - `conflict`: a concurrent writer changed the mirror after we read it. The
 *   caller must retry the delivery rather than apply a possibly older snapshot
 *   (this is what stops a same-second cancellation from being dropped).
 */
export interface SubscriptionSyncResult {
  outcome: 'applied' | 'stale' | 'conflict';
  /** `snapshot_generation` written by this call; null unless `applied`. */
  generation: number | null;
}

/** `stale` = a newer event already wrote this subscription; skip the update. */
export type SubscriptionStatusOutcome = 'applied' | 'stale';

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
  upsertSubscription(input: SubscriptionUpsert): Promise<ServiceResult<SubscriptionSyncResult>>;
  attachCheckoutSession(
    stripeSubscriptionId: string,
    checkoutSessionId: string,
  ): Promise<ServiceResult<void>>;
  /**
   * Compare-and-set on freshness: the update only lands when
   * `last_event_created <= lastEventCreated`, so a concurrent newer event can
   * never be overwritten. `stale` means no row moved.
   */
  updateSubscriptionStatus(
    stripeSubscriptionId: string,
    status: string,
    lastEventCreated: number,
  ): Promise<ServiceResult<SubscriptionStatusOutcome>>;
  /**
   * Clear the display-only pending marker when the plan it described actually
   * landed. Conditional on the marker still equalling `planKey`, so a newer
   * scheduled change is never discarded. Never touches `last_event_created`.
   */
  clearPendingPlanIfApplied(
    stripeSubscriptionId: string,
    planKey: string,
  ): Promise<ServiceResult<void>>;
  /** Clear any marker for a subscription that no longer exists. */
  clearPendingPlan(stripeSubscriptionId: string): Promise<ServiceResult<void>>;
  findActiveSubscription(
    owner: { type: 'user'; userId: string } | { type: 'org'; orgId: string },
    livemode: boolean,
  ): Promise<ServiceResult<ActiveSubscriptionRef | null>>;

  /** True while `receivedAt` is still the current claim lease for the event. */
  isClaimOwner(eventId: string, receivedAt: string): Promise<ServiceResult<boolean>>;

  getPlan(planKey: string): Promise<ServiceResult<CatalogPlan | null>>;
  findPrice(priceId: string, livemode: boolean): Promise<ServiceResult<ListedPrice | null>>;

  insertPayment(input: PaymentRowInput): Promise<ServiceResult<PaymentRecordResult>>;
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
    snapshotGeneration: row.snapshot_generation,
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
    private readonly payments: PaymentHistoryWriter = paymentHistoryWriter,
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
  ): Promise<ServiceResult<SubscriptionSyncResult>> {
    const supabase = this.createAdminClient();
    const nextGeneration = input.expectedGeneration + 1;
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
      snapshot_generation: nextGeneration,
      livemode: input.livemode,
    };

    const conditionalUpdate = () =>
      supabase
        .from('billing_subscriptions')
        .update(payload)
        .eq('stripe_subscription_id', input.stripeSubscriptionId)
        .eq('snapshot_generation', input.expectedGeneration)
        .lte('last_event_created', input.eventCreated)
        .select('id, snapshot_generation');

    // A zero-row write is either an older event (`stale`, ignore) or a
    // concurrent same-second writer that moved the generation (`conflict`,
    // retry the delivery). Never guess: read the row and classify.
    const classifyUnapplied = async (): Promise<ServiceResult<SubscriptionSyncResult>> => {
      const { data, error } = await supabase
        .from('billing_subscriptions')
        .select('last_event_created')
        .eq('stripe_subscription_id', input.stripeSubscriptionId)
        .maybeSingle();
      if (error) return toDbFailure(error);
      if (!data) return failure('INTERNAL_SERVER');
      if (data.last_event_created > input.eventCreated) {
        return success({ outcome: 'stale', generation: null });
      }
      return success({ outcome: 'conflict', generation: null });
    };

    const existing = await conditionalUpdate();
    if (existing.error) return toDbFailure(existing.error);
    if (existing.data && existing.data.length > 0) {
      return success({ outcome: 'applied', generation: existing.data[0].snapshot_generation });
    }

    const current = await supabase
      .from('billing_subscriptions')
      .select('id')
      .eq('stripe_subscription_id', input.stripeSubscriptionId)
      .maybeSingle();
    if (current.error) return toDbFailure(current.error);
    if (current.data) return classifyUnapplied();

    const inserted = await supabase
      .from('billing_subscriptions')
      .insert(payload)
      .select('id, snapshot_generation')
      .maybeSingle();
    if (!inserted.error && inserted.data) {
      return success({ outcome: 'applied', generation: inserted.data.snapshot_generation });
    }
    if (inserted.error && inserted.error.code !== '23505') return toDbFailure(inserted.error);
    if (inserted.error?.message.includes('billing_subscriptions_one_active')) {
      return failure('CONFLICT');
    }

    // The row appeared between the read and the insert. Retry the conditional
    // update once; 0 rows now means a newer generation or an older event.
    const retried = await conditionalUpdate();
    if (retried.error) return toDbFailure(retried.error);
    if (retried.data && retried.data.length > 0) {
      return success({ outcome: 'applied', generation: retried.data[0].snapshot_generation });
    }
    return classifyUnapplied();
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
  ): Promise<ServiceResult<SubscriptionStatusOutcome>> {
    const supabase = this.createAdminClient();
    const { data, error } = await supabase
      .from('billing_subscriptions')
      .update({ status, last_event_created: lastEventCreated })
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .lte('last_event_created', lastEventCreated)
      .select('id');

    if (error) return toDbFailure(error);
    return success(data && data.length > 0 ? 'applied' : 'stale');
  }

  async clearPendingPlanIfApplied(
    stripeSubscriptionId: string,
    planKey: string,
  ): Promise<ServiceResult<void>> {
    const supabase = this.createAdminClient();
    const { error } = await supabase
      .from('billing_subscriptions')
      .update({ pending_plan_key: null })
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .eq('pending_plan_key', planKey);

    if (error) return toDbFailure(error);
    return success(undefined);
  }

  async clearPendingPlan(stripeSubscriptionId: string): Promise<ServiceResult<void>> {
    const supabase = this.createAdminClient();
    const { error } = await supabase
      .from('billing_subscriptions')
      .update({ pending_plan_key: null })
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
      .select('key, name, price_monthly, currency, is_active, for_account_type, sort_order')
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
      sortOrder: data.sort_order ?? 0,
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

  async insertPayment(input: PaymentRowInput): Promise<ServiceResult<PaymentRecordResult>> {
    // The shared provider-neutral writer owns the row shape and the
    // `stripe_invoice_id` uniqueness rule (workstream A).
    return this.payments.record({
      provider: 'stripe',
      userId: input.userId,
      organizationId: input.organizationId,
      planKey: input.planKey,
      planName: input.planName,
      amount: input.amount,
      currency: input.currency,
      paidAt: input.paidAt,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      stripeInvoiceId: input.stripeInvoiceId,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      hostedInvoiceUrl: input.hostedInvoiceUrl,
      invoicePdfUrl: input.invoicePdfUrl,
    });
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
