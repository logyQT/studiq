import type { AccountType, RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import type { MockWebhookEvent } from '@studiq/server/services/mock-stripe.service';

/**
 * The provider behind the billing surface (#662).
 *
 * `mock` is the simulation that ships today; `stripe` is the real gateway.
 * Domain rules (is the plan purchasable, is the caller an org admin, may the
 * owner start a second subscription) live in the caller — the gateway only
 * performs provider operations and maps failures onto `ServiceResult`.
 *
 * Phase 1 keeps the input shapes identical to `MockStripeService`: the actor
 * is passed explicitly instead of a resolved owner, so routing the existing
 * controller through the gateway cannot change behaviour. Phase 2 introduces
 * `BillingService` and the resolved `PaymentOwner` used by the Stripe adapter.
 */
export type PaymentDriver = 'mock' | 'stripe';

/** Locale that Checkout / the Billing Portal should render in. */
export type BillingLocale = 'pl' | 'en';

export interface CreateCheckoutSessionInput {
  /** Authenticated caller; never a value from the request body. */
  userId: string;
  accountType: AccountType;
  /** Plan key (`spark`, `hub`, …), not the plan UUID. */
  planKey: string;
  /** Target organization for an organization plan; ignored for personal plans. */
  orgId?: string;
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

  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<ServiceResult<CheckoutSessionResult>>;

  createPortalSession(input: CreatePortalSessionInput): Promise<ServiceResult<PortalSessionResult>>;

  /** Upgrade (apply now) or downgrade (schedule at period end). */
  changePlan(input: ChangePlanInput): Promise<ServiceResult<ChangePlanResult>>;

  cancelAtPeriodEnd(input: CancelAtPeriodEndInput): Promise<ServiceResult<void>>;

  handleWebhook(envelope: PaymentWebhookEnvelope): Promise<ServiceResult<WebhookOutcome>>;
}
