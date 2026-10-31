import type { AccountType, RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import type { MockWebhookEvent } from '@studiq/server/services/mock-stripe.service';

/**
 * The provider behind the billing surface (#662).
 *
 * `mock` is the simulation that ships today; `stripe` is the real gateway.
 * Domain rules (is the plan purchasable, is the caller an org admin, may the
 * owner start a second subscription) live in `BillingService` — the gateway
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
  userId: string;
  accountType: AccountType;
  /** Active organization from the session cookie (a hint, re-checked by the adapter). */
  activeOrgId?: string | null;
  locale?: BillingLocale;
}

export interface PortalSessionResult {
  url: string;
}

export interface ChangePlanInput {
  userId: string;
  accountType: AccountType;
  /** Target organization for an organization plan. */
  orgId?: string;
  targetPlanKey: string;
  idempotencyKey: string;
}

export interface ChangePlanResult {
  status: 'applied' | 'scheduled';
}

export interface CancelAtPeriodEndInput {
  userId: string;
  accountType: AccountType;
  orgId?: string;
  /** `true` schedules cancellation, `false` reactivates before it takes effect. */
  cancel: boolean;
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

  cancelAtPeriodEnd(input: CancelAtPeriodEndInput): Promise<ServiceResult<void>>;

  handleWebhook(envelope: PaymentWebhookEnvelope): Promise<ServiceResult<WebhookOutcome>>;
}
