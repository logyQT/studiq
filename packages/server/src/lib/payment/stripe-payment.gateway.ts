// eslint-disable-next-line import/no-named-as-default -- stripe's default export is the Stripe class; the rule sees the `Stripe` namespace.
import type Stripe from 'stripe';
import { error as logError } from '@studiq/server/lib/log';
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
          success_url: `${this.siteUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${this.siteUrl()}/checkout?plan_id=${input.planKey}&canceled=1`,
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

  changePlan(_input: ChangePlanInput): Promise<ServiceResult<ChangePlanResult>> {
    // Phase 4 (#662 §2.5): anchor reset for upgrades, schedule for downgrades.
    return Promise.resolve(failure('SERVICE_UNAVAILABLE'));
  }

  cancelAtPeriodEnd(_input: CancelAtPeriodEndInput): Promise<ServiceResult<void>> {
    // Phase 4 (#662 §7.3).
    return Promise.resolve(failure('SERVICE_UNAVAILABLE'));
  }

  async handleWebhook(envelope: PaymentWebhookEnvelope): Promise<ServiceResult<WebhookOutcome>> {
    // A mock envelope on the Stripe driver is a wiring bug: the route only
    // builds it behind `withAuth`.
    if (envelope.kind !== 'stripe') return failure('BAD_REQUEST');

    // Lazily built so the process does not need the webhook repository until a
    // real event arrives; `parseStripeConfig` already validated the secret at
    // boot, so an empty secret here cannot be a misconfiguration.
    this.webhooks ??= wrapService(
      new StripeWebhookService({
        client: this.client,
        webhookSecret: this.webhookSecret,
        livemode: this.livemode,
        now: this.now,
      }),
      'stripe-webhook.service',
    );

    return this.webhooks.handle(envelope.rawBody, envelope.signature);
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
