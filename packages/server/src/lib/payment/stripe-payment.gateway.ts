// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import type Stripe from 'stripe';
import { error as logError, warn as logWarn } from '@studiq/server/lib/log';
import { isRecord, readString } from '@studiq/server/lib/record';
import { wrapService } from '@studiq/server/lib/observability';
import { checkoutExpiresAt } from '@studiq/server/lib/payment/checkout-timing';
import type {
  CancelAtPeriodEndInput,
  ChangePlanInput,
  ChangePlanResult,
  CreateCheckoutSessionInput,
  CreatePortalSessionInput,
  PaymentGateway,
  PaymentOwner,
  PaymentWebhookEnvelope,
  PortalSessionResult,
  ReconcileCheckoutInput,
  ReconcileCheckoutResult,
  WebhookOutcome,
} from '@studiq/server/lib/payment/payment-gateway';
import type { StripeConfig } from '@studiq/server/lib/payment/payment-gateway.factory';
import type { StripeClient } from '@studiq/server/lib/payment/stripe-client';
import {
  type CustomerDetails,
  type CustomerMapping,
  type StripeBillingRepository,
  stripeBillingRepository,
  SupabaseStripeBillingRepository,
  validateListedPrice,
} from '@studiq/server/lib/payment/stripe-repository';
import { failure, isFailure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import { getSiteUrl } from '@studiq/server/lib/site-url';
import { StripeWebhookService } from '@studiq/server/services/stripe-webhook.service';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StripePaymentGatewayOptions {
  client: StripeClient;
  config: StripeConfig;
  /** Test seam; production resolves the service-role repository singleton. */
  repository?: StripeBillingRepository;
  /** Test seam; production lazily builds the webhook service from `client`. */
  webhooks?: StripeWebhookService;
  createAdminClient?: () => SupabaseClient;
  siteUrl?: () => string;
  now?: () => Date;
}

const METADATA_PREFIX = 'studiq';

function ownerId(owner: PaymentOwner): string {
  return owner.type === 'user' ? owner.userId : owner.orgId;
}

function customerIdOf(customer: string | { id: string } | null | undefined): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

function ownerMetadata(owner: PaymentOwner): Record<string, string> {
  return {
    [`${METADATA_PREFIX}_owner_type`]: owner.type,
    [`${METADATA_PREFIX}_user_id`]: owner.userId,
    [`${METADATA_PREFIX}_org_id`]: owner.type === 'org' ? owner.orgId : '',
  };
}

/**
 * Map provider failures onto the domain's error vocabulary. Never log request
 * parameters: they contain the customer email/name.
 */
function stripeFailure(error: unknown): ServiceResult<never> {
  const type = isRecord(error) ? readString(error, 'type') : undefined;
  const code = isRecord(error) ? readString(error, 'code') : undefined;

  if (code === 'resource_missing') {
    // A Stripe-side deletion (customer/configuration/price) leaves a stale
    // local id; the caller should see "not found", not a generic 400.
    logError('billing.stripe_resource_missing', { type: type ?? 'unknown' });
    return failure('NOT_FOUND');
  }

  if (type === 'StripeRateLimitError') return failure('RATE_LIMITED');
  if (type === 'StripeInvalidRequestError' || type === 'StripeCardError') {
    // Log the shape, never the request parameters (customer email/name).
    logError('billing.stripe_invalid_request', {
      type,
      code: code ?? 'unknown',
    });
    return failure('BAD_REQUEST');
  }

  logError('billing.stripe_error', {
    type: type ?? 'unknown',
    message: error instanceof Error ? error.message : 'Stripe request failed',
  });
  return failure('SERVICE_UNAVAILABLE');
}

/**
 * Real Stripe adapter (#662 phase 2A, portal in phase 4).
 *
 * Owns provider I/O for checkout and the Billing Portal: customer
 * create/reuse, Price validation, the hosted Checkout Session and the hosted
 * portal session. Webhooks are delegated to `StripeWebhookService`; plan
 * changes and cancellation are added in phase 4 and fail until then.
 */
export class StripePaymentGateway implements PaymentGateway {
  readonly driver = 'stripe' as const;
  readonly livemode: boolean;

  private readonly client: StripeClient;
  private readonly repository: StripeBillingRepository;
  private readonly siteUrl: () => string;
  private readonly now: () => Date;
  private readonly webhookSecret: string;
  private readonly portalConfigurationId: string;
  private webhooks: StripeWebhookService | undefined;

  constructor(options: StripePaymentGatewayOptions) {
    this.client = options.client;
    this.livemode = options.config.livemode;
    this.webhookSecret = options.config.webhookSecret;
    this.portalConfigurationId = options.config.portalConfigurationId;
    this.webhooks = options.webhooks;
    this.repository =
      options.repository ??
      (options.createAdminClient
        ? new SupabaseStripeBillingRepository(options.createAdminClient)
        : stripeBillingRepository);
    this.siteUrl = options.siteUrl ?? getSiteUrl;
    this.now = options.now ?? (() => new Date());
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<ServiceResult<{ url: string; sessionId: string }>> {
    if (!input.priceId) {
      logError('billing.price_mismatch', { planKey: input.planKey, reason: 'missing' });
      return failure('SERVICE_UNAVAILABLE');
    }

    // Defense in depth: `BillingService` already validated the mapping, but the
    // gateway must never charge an amount the catalog does not know about.
    const [planResult, priced] = await Promise.all([
      this.repository.getPlan(input.planKey),
      this.repository.findPriceById(input.priceId, this.livemode),
    ]);
    if (isFailure(planResult)) return planResult;
    if (isFailure(priced)) return priced;

    const plan = planResult.data;
    if (
      !plan ||
      !plan.isActive ||
      plan.priceMonthly !== input.amount ||
      plan.currency.toUpperCase() !== input.currency.toUpperCase()
    ) {
      logError('billing.price_mismatch', {
        planKey: input.planKey,
        priceId: input.priceId,
        reason: 'catalog',
      });
      return failure('SERVICE_UNAVAILABLE');
    }

    const mismatch = validateListedPrice(plan, priced.data);
    if (mismatch) {
      logError('billing.price_mismatch', {
        planKey: input.planKey,
        priceId: input.priceId,
        reason: mismatch,
      });
      return failure('SERVICE_UNAVAILABLE');
    }

    const customer = await this.ensureCustomer(input.owner);
    if (isFailure(customer)) return customer;

    const metadata = {
      ...ownerMetadata(input.owner),
      [`${METADATA_PREFIX}_plan_key`]: input.planKey,
      [`${METADATA_PREFIX}_billing_cycle`]: input.billingCycle,
      [`${METADATA_PREFIX}_livemode`]: String(this.livemode),
    };

    try {
      const session = await this.client.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: customer.data.stripeCustomerId,
          line_items: [{ price: input.priceId, quantity: 1 }],
          client_reference_id: ownerId(input.owner),
          metadata,
          subscription_data: {
            metadata,
            // #662 X1: classic mode keeps the billing-cycle anchor resettable,
            // which the phase-4 upgrade (reset + unused-time credit) requires.
            billing_mode: { type: 'classic' },
          },
          success_url: `${this.siteUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}&plan_id=${encodeURIComponent(
            input.planKey,
          )}${input.owner.type === 'org' ? `&org_id=${input.owner.orgId}` : ''}`,
          cancel_url: `${this.siteUrl()}/checkout?plan_id=${input.planKey}&canceled=1${
            input.owner.type === 'org' ? `&org_id=${input.owner.orgId}` : ''
          }`,
          locale: input.locale === 'en' ? 'en' : 'pl',
          // BillingService derives this from the same snapshot as the
          // idempotency key, so a retry sends identical parameters.
          expires_at: input.expiresAt ?? checkoutExpiresAt(this.now().getTime()),
          allow_promotion_codes: false,
          automatic_tax: { enabled: false },
          tax_id_collection: { enabled: false },
        },
        { idempotencyKey: input.idempotencyKey },
      );

      if (!session.url) {
        logError('billing.checkout_missing_url', { sessionId: session.id });
        return failure('SERVICE_UNAVAILABLE');
      }

      return success({ url: session.url, sessionId: session.id });
    } catch (error) {
      return stripeFailure(error);
    }
  }

  async createPortalSession(
    input: CreatePortalSessionInput,
  ): Promise<ServiceResult<PortalSessionResult>> {
    if (!input.customerId) {
      // No `billing_customers` row: a mock purchase or a user who never bought
      // through Stripe. The UI shows "buy a plan" instead of a broken portal.
      return failure('NOT_FOUND');
    }

    try {
      const session = await this.client.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
        configuration: this.portalConfigurationId,
        locale: input.locale === 'en' ? 'en' : 'pl',
      });

      return success({ url: session.url });
    } catch (error) {
      return stripeFailure(error);
    }
  }

  async changePlan(input: ChangePlanInput): Promise<ServiceResult<ChangePlanResult>> {
    try {
      // Re-fetch so the item id, customer and period boundaries are the current
      // ones; the mirror may lag a webhook by a few seconds.
      const subscription = await this.client.subscriptions.retrieve(input.subscriptionId);

      // Defence in depth: the subscription must belong to the customer the
      // service resolved from the authenticated owner.
      const customerId = customerIdOf(subscription.customer);
      if (!customerId || customerId !== input.customerId) {
        logError('billing.subscription_owner_mismatch', {
          subscriptionId: input.subscriptionId,
        });
        return failure('FORBIDDEN');
      }

      // The MVP bills one plan item per subscription (D4). A second item means
      // the local model cannot represent the subscription, so fail closed.
      if (subscription.items.data.length !== 1) {
        logError('billing.change_plan_multi_item', {
          subscriptionId: input.subscriptionId,
          itemCount: subscription.items.data.length,
        });
        return failure('SERVICE_UNAVAILABLE');
      }

      const item = subscription.items.data[0];
      const livePriceId = item.price.id;

      // A retry after the webhook already applied the target (or a stale
      // mirror) must not reset the anchor and charge a second full period.
      if (livePriceId === input.targetPriceId) {
        return success({ status: 'applied' });
      }

      // The live price must still be the plan the caller/D B thought it was.
      const currentPrice = await this.repository.findPriceById(livePriceId, this.livemode);
      if (isFailure(currentPrice)) return currentPrice;
      if (currentPrice.data?.planKey !== input.currentPlanKey) {
        logError('billing.subscription_plan_mismatch', {
          subscriptionId: input.subscriptionId,
          expected: input.currentPlanKey,
          actual: currentPrice.data?.planKey ?? null,
        });
        return failure('CONFLICT');
      }

      // A pending downgrade schedule would otherwise override this change at its
      // next phase boundary. Release it before applying the new direction.
      await this.releaseSchedule(subscription);

      if (input.direction === 'upgrade') {
        const updated = await this.client.subscriptions.update(
          input.subscriptionId,
          {
            items: [{ id: item.id, price: input.targetPriceId }],
            // Classic billing mode (#662 X1) is what makes this reset legal.
            // stripe-node types the update form as `{ type: 'now' }` (the API
            // accepts the same value as `billing_cycle_anchor=now`).
            billing_cycle_anchor: { type: 'now' },
            proration_behavior: 'always_invoice',
            // A 3DS upgrade invoice must not apply the new price before payment.
            payment_behavior: 'pending_if_incomplete',
            expand: ['latest_invoice'],
          },
          { idempotencyKey: input.idempotencyKey },
        );

        if (updated.pending_update) {
          // Stripe accepted the update but the immediate invoice is not paid;
          // the price changes only after authentication. Surface the hosted
          // invoice instead of pretending the plan is already applied.
          const invoice = updated.latest_invoice;
          const hostedInvoiceUrl =
            typeof invoice === 'string' ? null : (invoice?.hosted_invoice_url ?? null);
          return success({ status: 'pending_payment', hostedInvoiceUrl });
        }

        return success({ status: 'applied' });
      }

      const start = item.current_period_start;
      const end = item.current_period_end;
      if (typeof start !== 'number' || typeof end !== 'number' || !livePriceId) {
        logError('billing.change_plan_missing_period', { subscriptionId: input.subscriptionId });
        return failure('SERVICE_UNAVAILABLE');
      }

      const schedule = await this.createSchedule(input);

      // Phases replace the whole phase object, so carry our owner metadata into
      // both phases instead of letting Stripe unset it on the active one.
      const metadata = subscription.metadata ?? undefined;

      await this.client.subscriptionSchedules.update(
        schedule.id,
        {
          phases: [
            {
              start_date: start,
              end_date: end,
              items: [{ price: livePriceId, quantity: 1 }],
              metadata,
            },
            {
              start_date: end,
              items: [{ price: input.targetPriceId, quantity: 1 }],
              metadata,
            },
          ],
        },
        { idempotencyKey: `${input.idempotencyKey}:phases:${schedule.id}` },
      );

      return success({ status: 'scheduled' });
    } catch (error) {
      return stripeFailure(error);
    }
  }

  /**
   * Create a schedule, reusing the deterministic idempotency key. A replay
   * inside Stripe's 24 h window can return a schedule that was subsequently
   * released (e.g. a downgrade followed by cancel); that snapshot cannot be
   * updated, so read the live state and create a replacement under a key that
   * includes the stale id.
   */
  private async createSchedule(input: ChangePlanInput): Promise<Stripe.SubscriptionSchedule> {
    const created = await this.client.subscriptionSchedules.create(
      { from_subscription: input.subscriptionId },
      { idempotencyKey: `${input.idempotencyKey}:schedule` },
    );

    const live = await this.client.subscriptionSchedules.retrieve(created.id);
    if (live.status !== 'released' && live.status !== 'canceled') return created;

    return this.client.subscriptionSchedules.create(
      { from_subscription: input.subscriptionId },
      { idempotencyKey: `${input.idempotencyKey}:schedule:${created.id}` },
    );
  }

  async cancelAtPeriodEnd(
    input: CancelAtPeriodEndInput,
  ): Promise<ServiceResult<{ cancelAtPeriodEnd: boolean; releasedSchedule: boolean }>> {
    try {
      const subscription = await this.client.subscriptions.retrieve(input.subscriptionId);
      const customerId = customerIdOf(subscription.customer);
      if (!customerId || customerId !== input.customerId) {
        logError('billing.subscription_owner_mismatch', {
          subscriptionId: input.subscriptionId,
        });
        return failure('FORBIDDEN');
      }

      // A scheduled downgrade must not keep its own phase-level cancel flag;
      // release it first so cancel/reactivate has one authoritative source.
      const releasedSchedule = await this.releaseSchedule(subscription);

      const updated = await this.client.subscriptions.update(input.subscriptionId, {
        cancel_at_period_end: input.cancel,
      });

      // Return Stripe's authoritative value, not the requested one.
      return success({
        cancelAtPeriodEnd: updated.cancel_at_period_end,
        releasedSchedule,
      });
    } catch (error) {
      return stripeFailure(error);
    }
  }

  /** Detach a pending schedule created by an earlier downgrade, if any. */
  private async releaseSchedule(subscription: Stripe.Subscription): Promise<boolean> {
    const schedule = subscription.schedule;
    const scheduleId = typeof schedule === 'string' ? schedule : schedule?.id;
    if (!scheduleId) return false;

    try {
      await this.client.subscriptionSchedules.release(scheduleId);
      return true;
    } catch (error) {
      // Two concurrent changes can both observe the same schedule; the loser
      // sees "already released". That is benign, not a failed change.
      const message =
        error instanceof Error
          ? error.message
          : isRecord(error)
            ? (readString(error, 'message') ?? '')
            : '';
      const type = isRecord(error) ? readString(error, 'type') : undefined;
      if (type === 'StripeInvalidRequestError' && /released/i.test(message)) {
        logWarn('billing.schedule_already_released', { scheduleId });
        return true;
      }
      throw error;
    }
  }

  async handleWebhook(envelope: PaymentWebhookEnvelope): Promise<ServiceResult<WebhookOutcome>> {
    // A mock envelope on the Stripe driver is a wiring bug: the route only
    // builds it behind `withAuth`.
    if (envelope.kind !== 'stripe') return failure('BAD_REQUEST');

    return this.webhookService().handle(envelope.rawBody, envelope.signature);
  }

  async reconcileCheckout(
    input: ReconcileCheckoutInput,
  ): Promise<ServiceResult<ReconcileCheckoutResult>> {
    try {
      const session = await this.client.checkout.sessions.retrieve(input.sessionId);

      if (session.livemode !== this.livemode) {
        logError('billing.reconcile_livemode_mismatch', {
          sessionId: session.id,
          sessionLivemode: session.livemode,
          expectedLivemode: this.livemode,
        });
        return failure('BAD_REQUEST');
      }

      // Session ids are unguessable, but ownership is still mandatory (#662
      // §9.2): a leaked/forwarded success URL must not activate a plan.
      if (!this.checkoutBelongsTo(session, input.owner)) {
        // A user replaying a foreign/expired success URL is expected noise, not
        // an infrastructure error.
        logWarn('billing.reconcile_owner_mismatch', { sessionId: session.id });
        return failure('FORBIDDEN');
      }

      // A delayed/3DS payment is not an entitlement yet; the success page keeps
      // showing "processing" and the webhook activates it when paid.
      if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
        return success({ activated: false });
      }

      const result = await this.webhookService().reconcileCheckout(session);
      if (isFailure(result)) return result;

      return success({ activated: result.data.activated });
    } catch (error) {
      return stripeFailure(error);
    }
  }

  /** A Checkout Session belongs to the owner that created it server-side. */
  private checkoutBelongsTo(session: Stripe.Checkout.Session, owner: PaymentOwner): boolean {
    const metadata = session.metadata ?? {};

    if (owner.type === 'user') {
      return (
        session.client_reference_id === owner.userId &&
        metadata[`${METADATA_PREFIX}_owner_type`] === 'user' &&
        metadata[`${METADATA_PREFIX}_user_id`] === owner.userId
      );
    }

    return (
      session.client_reference_id === owner.orgId &&
      metadata[`${METADATA_PREFIX}_owner_type`] === 'org' &&
      metadata[`${METADATA_PREFIX}_org_id`] === owner.orgId
    );
  }

  /** Lazily built so the process does not need the webhook repository until needed. */
  private webhookService(): StripeWebhookService {
    this.webhooks ??= wrapService(
      new StripeWebhookService({
        client: this.client,
        webhookSecret: this.webhookSecret,
        livemode: this.livemode,
        now: this.now,
      }),
      'stripe-webhook.service',
    );

    return this.webhooks;
  }

  /** Reuse the owner's customer mapping or create one in Stripe. */
  private async ensureCustomer(owner: PaymentOwner): Promise<ServiceResult<CustomerMapping>> {
    const existing = await this.repository.findCustomer(owner, this.livemode);
    if (isFailure(existing)) return existing;
    if (existing.data) return success(existing.data);

    const details = await this.repository.getCustomerDetails(owner);
    if (isFailure(details)) return details;

    try {
      // No persistent idempotency key here: Stripe replays a key for at least
      // 24 h *even if the customer was deleted*, which would break a re-checkout
      // after a stale mapping is removed. `insertCustomer` already resolves
      // concurrent creates through its unique index; the loser may leave an
      // orphan customer, which is preferable to a poisoned key.
      const customer = await this.client.customers.create(this.customerParams(owner, details.data));
      return this.repository.insertCustomer(owner, customer.id, this.livemode);
    } catch (error) {
      return stripeFailure(error);
    }
  }

  private customerParams(
    owner: PaymentOwner,
    details: CustomerDetails,
  ): Stripe.CustomerCreateParams {
    return {
      email: details.email,
      name: details.name,
      metadata: ownerMetadata(owner),
    };
  }
}
