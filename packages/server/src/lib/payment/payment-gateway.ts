import type { AccountType, RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import type { MockWebhookEvent } from '@studiq/server/services/mock-stripe.service';

/**
 * The provider behind the billing surface (#662).
 *
 * `mock` is the non-production simulation; `stripe` is the real gateway.
 * Plan/owner/org-admin rules live in `lib/payment/checkout-rules.ts` and are
 * called by `BillingService` (and by the mock completion command); the gateway
 * only performs provider operations and maps failures onto `ServiceResult`.
 */
export type PaymentDriver = 'mock' | 'stripe';

/** Monthly is the only cadence in the MVP (#662 D1). */
export type BillingCycle = 'monthly';

/** Locale that Checkout / the Billing Portal should render in. */
export type BillingLocale = 'pl' | 'en';

/**
 * The billing owner resolved from the authenticated context, never from the
 * request body. An organization plan belongs to the organization; the caller
 * is recorded as the purchaser.
 */
export type PaymentOwner =
  | { type: 'user'; userId: string; accountType: AccountType }
  | { type: 'org'; orgId: string; userId: string; accountType: AccountType };

export interface CreateCheckoutSessionInput {
  /** Resolved by `BillingService` from `ctx` (and the verified org admin role). */
  owner: PaymentOwner;
  /** Plan key (`spark`, `hub`, …), not the plan UUID. */
  planKey: string;
  /** Catalog snapshot used to build the provider session. */
  planName: string;
  /** Minor units, from `subscription_plans`. */
  amount: number;
  currency: string;
  billingCycle: BillingCycle;
  /**
   * Stripe Price resolved from `stripe_prices` by `BillingService`. The mock
   * adapter has no provider price, so this is absent there.
   */
  priceId?: string;
  locale?: BillingLocale;
  /**
   * Expiry computed from the same snapshot as `idempotencyKey`, so a retried
   * key always sends identical parameters. The gateway falls back to its own
   * clock only for direct callers/tests.
   */
  expiresAt?: number;
  /**
   * Provider idempotency key. The mock ignores it; the Stripe adapter forwards
   * it to `checkout.sessions.create`.
   */
  idempotencyKey: string;
}

export interface CheckoutSessionResult {
  /** Where the browser should go: hosted Stripe Checkout, or the mock form. */
  url: string;
  sessionId: string;
}

export interface CreatePortalSessionInput {
  /** Resolved from `RequestContext` by `BillingService`, never a request body. */
  owner: PaymentOwner;
  /** Resolved from `billing_customers`; absent for the mock adapter. */
  customerId?: string;
  /** Account-type-aware billing page the portal returns to. */
  returnUrl: string;
  locale?: BillingLocale;
}

export interface PortalSessionResult {
  url: string;
}

export interface ChangePlanInput {
  /** Resolved from `RequestContext` by `BillingService`, never a request body. */
  owner: PaymentOwner;
  customerId: string;
  subscriptionId: string;
  currentPlanKey: string;
  targetPlanKey: string;
  targetPriceId: string;
  direction: 'upgrade' | 'downgrade';
  idempotencyKey: string;
}

export interface ChangePlanResult {
  /**
   * `pending_payment` means Stripe created the update but the immediate invoice
   * still needs payment/authentication (e.g. 3DS); the plan changes only after
   * the invoice is paid.
   */
  status: 'applied' | 'scheduled' | 'pending_payment';
  /** Present for `pending_payment`: where the customer completes the payment. */
  hostedInvoiceUrl?: string | null;
}

export interface CancelAtPeriodEndInput {
  owner: PaymentOwner;
  customerId: string;
  subscriptionId: string;
  /** `true` schedules cancellation, `false` reactivates before it takes effect. */
  cancel: boolean;
}

/**
 * Release a downgrade that was previously scheduled at `current_period_end`
 * (#662 §2.5). This is the "keep my current plan" action: it never writes an
 * entitlement, it only detaches the provider schedule.
 */
export interface ReleaseScheduledPlanInput {
  owner: PaymentOwner;
  customerId: string;
  subscriptionId: string;
  /**
   * Plan the caller believes is billed. The gateway re-reads the live price
   * before releasing: if a scheduled phase already applied, releasing its
   * remainder would report "kept the old plan" while Stripe bills the new one.
   */
  currentPlanKey: string;
}

export interface ReleaseScheduledPlanResult {
  /** `false` when no schedule existed (an upgrade invoice awaiting payment). */
  released: boolean;
}

export interface ReconcileCheckoutInput {
  owner: PaymentOwner;
  /** Stripe Checkout Session id from the `success_url` query. */
  sessionId: string;
}

export interface ReconcileCheckoutResult {
  /** `true` when this call (or an earlier webhook) already applied the plan. */
  activated: boolean;
}

/**
 * The two webhook contracts are deliberately different shapes.
 *
 * A Stripe webhook is unauthenticated at the HTTP layer and is proved by its
 * signature; the mock webhook is called by our own checkout page and is proved
 * by the Supabase session. Keeping them as separate envelope variants makes it
 * impossible to accidentally route an unauthenticated request through the
 * authenticated mock path (or vice versa).
 */
export type PaymentWebhookEnvelope =
  | { kind: 'mock'; ctx: RequestContext; event: MockWebhookEvent }
  | { kind: 'stripe'; rawBody: string; signature: string | null };

export interface WebhookOutcome {
  received: true;
  duplicate?: boolean;
  ignored?: boolean;
}

export interface PaymentGateway {
  readonly driver: PaymentDriver;

  /** Stripe mode derived from the secret key; the mock has no mode. */
  readonly livemode: boolean;

  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<ServiceResult<CheckoutSessionResult>>;

  createPortalSession(input: CreatePortalSessionInput): Promise<ServiceResult<PortalSessionResult>>;

  /** Upgrade (apply now) or downgrade (schedule at period end). */
  changePlan(input: ChangePlanInput): Promise<ServiceResult<ChangePlanResult>>;

  cancelAtPeriodEnd(
    input: CancelAtPeriodEndInput,
  ): Promise<ServiceResult<{ cancelAtPeriodEnd: boolean; releasedSchedule: boolean }>>;

  /** Detach a pending downgrade schedule without changing the plan. */
  releaseScheduledPlan(
    input: ReleaseScheduledPlanInput,
  ): Promise<ServiceResult<ReleaseScheduledPlanResult>>;

  /**
   * Verify a Checkout Session belongs to the caller and run the same idempotent
   * activation path as `checkout.session.completed` (#662 X6).
   */
  reconcileCheckout(input: ReconcileCheckoutInput): Promise<ServiceResult<ReconcileCheckoutResult>>;

  handleWebhook(envelope: PaymentWebhookEnvelope): Promise<ServiceResult<WebhookOutcome>>;
}
