import { ORG_ADMIN_ROLE } from '@studiq/authz';
import { type CatalogPlan, type ListedPrice } from '@studiq/server/lib/payment/stripe-repository';
import { failure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
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
  lastEventCreated: number;
  livemode: boolean;
}

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
  upsertSubscription(input: SubscriptionUpsert): Promise<ServiceResult<void>>;
  updateSubscriptionStatus(
    stripeSubscriptionId: string,
    status: string,
    lastEventCreated: number,
  ): Promise<ServiceResult<void>>;
  findActiveSubscription(
    owner: { type: 'user'; userId: string } | { type: 'org'; orgId: string },
    livemode: boolean,
  ): Promise<ServiceResult<ActiveSubscriptionRef | null>>;

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

function mapCustomer(row: Record<string, unknown>): CustomerRow {
  return {
    id: row.id as string,
    stripeCustomerId: row.stripe_customer_id as string,
    userId: (row.user_id as string | null) ?? null,
    organizationId: (row.organization_id as string | null) ?? null,
    livemode: row.livemode as boolean,
  };
}

function mapSubscription(row: Record<string, unknown>): SubscriptionMirror {
  return {
    id: row.id as string,
    stripeSubscriptionId: row.stripe_subscription_id as string,
    billingCustomerId: row.billing_customer_id as string,
    userId: (row.user_id as string | null) ?? null,
    organizationId: (row.organization_id as string | null) ?? null,
    purchaserUserId: (row.purchaser_user_id as string | null) ?? null,
    checkoutSessionId: (row.checkout_session_id as string | null) ?? null,
    planKey: row.plan_key as string,
    priceId: row.price_id as string,
    status: row.status as string,
    currentPeriodStart: (row.current_period_start as string | null) ?? null,
    currentPeriodEnd: (row.current_period_end as string | null) ?? null,
    cancelAtPeriodEnd: (row.cancel_at_period_end as boolean | null) ?? false,
    cancelAt: (row.cancel_at as string | null) ?? null,
    canceledAt: (row.canceled_at as string | null) ?? null,
    lastEventCreated: (row.last_event_created as number | null) ?? 0,
    livemode: row.livemode as boolean,
  };
}

function mapPrice(row: Record<string, unknown>): ListedPrice {
  return {
    planKey: row.plan_key as string,
    stripePriceId: row.stripe_price_id as string,
    currency: row.currency as string,
    unitAmount: row.unit_amount as number,
    interval: row.interval as string,
    active: row.active as boolean,
  };
}

export class SupabaseStripeWebhookRepository implements StripeWebhookRepository {
  constructor(private readonly createAdminClient: () => SupabaseClient = createServiceClient) {}

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
      return success({ outcome: 'claimed', receivedAt: data.received_at as string });
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
      Date.now() - new Date(existing.received_at as string).getTime() >= PROCESSING_LEASE_MS;
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

    return success({ outcome: 'retry', receivedAt: reclaimed[0].received_at as string });
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

  async upsertSubscription(input: SubscriptionUpsert): Promise<ServiceResult<void>> {
    const supabase = this.createAdminClient();
    const { error } = await supabase.from('billing_subscriptions').upsert(
      {
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
      },
      { onConflict: 'stripe_subscription_id' },
    );

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
      stripeSubscriptionId: data.stripe_subscription_id as string,
      planKey: data.plan_key as string,
    });
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
      key: data.key as string,
      name: (data.name as string | null) ?? (data.key as string),
      priceMonthly: (data.price_monthly as number | null) ?? 0,
      currency: (data.currency as string | null) ?? 'PLN',
      isActive: (data.is_active as boolean | null) ?? true,
      forAccountType: (data.for_account_type as string | null) ?? null,
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
    return success((data?.user_id as string | undefined) ?? null);
  }
}

export const stripeWebhookRepository = new SupabaseStripeWebhookRepository();
