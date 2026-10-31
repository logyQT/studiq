import { AccountType, type RequestContext } from '@studiq/authz';
import { error as logError } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import type {
  BillingLocale,
  CheckoutSessionResult,
  PaymentGateway,
  PaymentOwner,
} from '@studiq/server/lib/payment/payment-gateway';
import { getPaymentGateway } from '@studiq/server/lib/payment/payment-gateway.factory';
import {
  type CatalogPlan,
  type StripeBillingRepository,
  stripeBillingRepository,
  validateListedPrice,
} from '@studiq/server/lib/payment/stripe-repository';
import { failure, isFailure, success, type ServiceResult } from '@studiq/server/lib/service-result';

/** A double-click inside the same 30-minute bucket reuses the same session. */
const CHECKOUT_BUCKET_MS = 30 * 60 * 1000;

/**
 * Deterministic idempotency key for `checkout.sessions.create`: owner + plan +
 * a 30-minute time bucket. Retries and double-clicks collapse onto one session;
 * a new bucket produces a fresh session (the old one expires, §5.5).
 */
export function checkoutIdempotencyKey(
  owner: PaymentOwner,
  planKey: string,
  nowMs: number = Date.now(),
): string {
  const ownerKey = owner.type === 'org' ? owner.orgId : owner.userId;
  const bucket = Math.floor(nowMs / CHECKOUT_BUCKET_MS);
  return `checkout:${owner.type}:${ownerKey}:${planKey}:${bucket}`;
}

/**
 * Billing domain rules (#662 §5.2). The client never supplies an amount,
 * currency, price id, customer id or subscription id: everything is resolved
 * from the catalog, the price map and the authenticated context.
 *
 * The provider adapter only performs I/O. Keeping the rules here means the
 * mock and Stripe paths share them, and the Stripe-specific checks
 * (active-subscription guard, price map) never run for the mock driver.
 */
export class BillingService {
  constructor(
    private readonly gateway: PaymentGateway,
    private readonly repository: StripeBillingRepository = stripeBillingRepository,
  ) {}

  async startCheckout(
    ctx: RequestContext,
    planKey: string,
    orgId?: string,
    locale: BillingLocale = 'pl',
  ): Promise<ServiceResult<CheckoutSessionResult>> {
    const planResult = await this.repository.getPlan(planKey);
    if (isFailure(planResult)) return planResult;

    const plan = planResult.data;
    if (!plan || !plan.isActive || plan.priceMonthly <= 0) return failure('BAD_REQUEST');
    if (plan.forAccountType && plan.forAccountType !== ctx.accountType) {
      return failure('FORBIDDEN');
    }

    const isOrgPlan = plan.forAccountType === AccountType.MANAGER;
    let owner: PaymentOwner;

    if (isOrgPlan) {
      if (!orgId) return failure('BAD_REQUEST');

      const admin = await this.repository.isOrgAdmin(orgId, ctx.userId);
      if (isFailure(admin)) return admin;
      if (!admin.data) return failure('FORBIDDEN');

      owner = { type: 'org', orgId, userId: ctx.userId, accountType: ctx.accountType };
    } else {
      owner = { type: 'user', userId: ctx.userId, accountType: ctx.accountType };
    }

    let priceId: string | undefined;
    if (this.gateway.driver === 'stripe') {
      const priceResult = await this.resolveStripePrice(plan, owner);
      if (isFailure(priceResult)) return priceResult;
      priceId = priceResult.data;
    }

    return this.gateway.createCheckoutSession({
      owner,
      planKey: plan.key,
      planName: plan.name,
      amount: plan.priceMonthly,
      currency: plan.currency,
      billingCycle: 'monthly',
      priceId,
      locale,
      idempotencyKey: checkoutIdempotencyKey(owner, plan.key),
    });
  }

  /**
   * Stripe-only preconditions: no second live subscription for the owner, and a
   * mapped Price that still charges exactly the catalog amount/currency/month.
   */
  private async resolveStripePrice(
    plan: CatalogPlan,
    owner: PaymentOwner,
  ): Promise<ServiceResult<string>> {
    const active = await this.repository.findActiveSubscription(owner, this.gateway.livemode);
    if (isFailure(active)) return active;
    if (active.data) return failure('CONFLICT');

    const listed = await this.repository.findListedPrice(
      plan.key,
      'monthly',
      this.gateway.livemode,
    );
    if (isFailure(listed)) return listed;

    const mismatch = validateListedPrice(plan, listed.data);
    if (mismatch) {
      logError('billing.price_mismatch', { planKey: plan.key, reason: mismatch });
      return failure('SERVICE_UNAVAILABLE');
    }

    return success(listed.data!.stripePriceId);
  }
}

export const billingService = wrapService(
  new BillingService(getPaymentGateway()),
  'billing.service',
);
