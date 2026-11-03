import { AccountType, type RequestContext } from '@studiq/authz';
import { isAccountType } from '@studiq/server/lib/authz';
import { error as logError, warn as logWarn } from '@studiq/server/lib/log';
import { wrapService } from '@studiq/server/lib/observability';
import {
  billingReadRepository,
  type BillingReadRepository,
} from '@studiq/server/lib/payment/billing-read.repository';
import { billingPath } from '@studiq/server/lib/payment/billing-paths';
import {
  changePlanIdempotencyKey,
  checkoutExpiresAt,
  checkoutIdempotencyKey,
} from '@studiq/server/lib/payment/checkout-timing';
import type {
  BillingLocale,
  ChangePlanResult,
  CheckoutSessionResult,
  PaymentDriver,
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
import { getSiteUrl } from '@studiq/server/lib/site-url';
import {
  type SubscriptionPlanService,
  subscriptionPlanService,
} from '@studiq/server/services/subscription-plan.service';

/** Stripe subscription status plus the two states only the read model has. */
export type BillingReadStatus =
  | 'none'
  | 'free'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/**
 * The single shape all three billing dashboards render (#662 §7.4).
 *
 * Provider-specific ids never leave the server: the customer/subscription ids
 * stay in the repositories and the portal endpoint resolves them again for the
 * authenticated owner.
 */
export interface BillingSubscriptionView {
  provider: PaymentDriver;
  planKey: string | null;
  planName: string | null;
  status: BillingReadStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Target plan of a scheduled downgrade, until the webhook applies it. */
  pendingPlanKey: string | null;
  /** Minor units, matching `subscription_plans.price_monthly`. */
  priceMonthly: number;
  currency: string;
  canManagePortal: boolean;
  canChangePlan: boolean;
  canCancel: boolean;
  hostedInvoiceUrl: string | null;
}

const SUBSCRIBABLE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** The owner is the authenticated context's, never the request body (#662 §9.2). */
function ownerFromContext(ctx: RequestContext): PaymentOwner {
  if (ctx.accountType === AccountType.MANAGER && ctx.activeOrgId) {
    return {
      type: 'org',
      orgId: ctx.activeOrgId,
      userId: ctx.userId,
      accountType: ctx.accountType,
    };
  }
  return { type: 'user', userId: ctx.userId, accountType: ctx.accountType };
}

function isBillingReadStatus(value: string): value is BillingReadStatus {
  return (
    value === 'active' ||
    value === 'trialing' ||
    value === 'past_due' ||
    value === 'unpaid' ||
    value === 'canceled' ||
    value === 'incomplete' ||
    value === 'incomplete_expired' ||
    value === 'paused'
  );
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
    private readonly reads: BillingReadRepository = billingReadRepository,
    private readonly plans: Pick<SubscriptionPlanService, 'getMyPlan'> = subscriptionPlanService,
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
    if (
      plan.forAccountType &&
      (!isAccountType(plan.forAccountType) || plan.forAccountType !== ctx.accountType)
    ) {
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

    // One clock snapshot for the key and expiry: Stripe rejects a reused key
    // whose parameters differ, so these must never straddle a bucket boundary.
    const nowMs = Date.now();

    return this.gateway.createCheckoutSession({
      owner,
      planKey: plan.key,
      planName: plan.name,
      amount: plan.priceMonthly,
      currency: plan.currency,
      billingCycle: 'monthly',
      priceId,
      locale,
      expiresAt: checkoutExpiresAt(nowMs),
      idempotencyKey: checkoutIdempotencyKey(owner, plan.key, locale, nowMs),
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

  /**
   * The shared billing read model (#662 §7.4).
   *
   * Stripe mode reads `billing_subscriptions` through the caller's session
   * client, so the own-row/org-manager RLS policies decide visibility. Mock mode
   * has no subscription row at all: it synthesizes the effective plan
   * (`/me/plan`) and keeps every provider action disabled, which is exactly
   * what the existing mock QA specs expect.
   *
   * The plan fields always describe the **effective** entitlement (#971), so
   * this endpoint cannot disagree with `/me/plan` for a seated student. The
   * mirror supplies only lifecycle state (status/dates/cancel/pending plan).
   */
  async getSubscription(ctx: RequestContext): Promise<ServiceResult<BillingSubscriptionView>> {
    const planResult = await this.plans.getMyPlan(ctx);

    // A caller with no plan yet (an incomplete account) still gets a read model;
    // a real database failure must not be hidden behind a synthetic free plan.
    if (isFailure(planResult) && planResult.error !== 'NOT_FOUND') return planResult;

    const effectivePlan = planResult.success ? planResult.data : null;
    const base: BillingSubscriptionView = {
      provider: this.gateway.driver,
      planKey: effectivePlan?.key ?? null,
      planName: effectivePlan?.name ?? null,
      status: effectivePlan ? (effectivePlan.priceMonthly > 0 ? 'active' : 'free') : 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      pendingPlanKey: null,
      priceMonthly: effectivePlan?.priceMonthly ?? 0,
      currency: effectivePlan?.currency ?? 'PLN',
      canManagePortal: false,
      canChangePlan: false,
      canCancel: false,
      // The simulation never exposes a hosted Stripe invoice.
      hostedInvoiceUrl: null,
    };

    if (this.gateway.driver === 'mock') {
      return success(base);
    }

    const subscriptionResult = await this.reads.findSubscription(ctx, this.gateway.livemode);
    if (isFailure(subscriptionResult)) return subscriptionResult;

    const subscription = subscriptionResult.data;
    if (!subscription) return success(base);

    // No effective plan is unusual, but the mirror still knows what Stripe
    // bills, so fall back to the catalog row for display values only.
    let planKey = base.planKey;
    let planName = base.planName;
    let priceMonthly = base.priceMonthly;
    let currency = base.currency;
    if (!effectivePlan) {
      const catalog = await this.repository.getPlan(subscription.planKey);
      if (isFailure(catalog)) return catalog;
      planKey = subscription.planKey;
      planName = catalog.data?.name ?? subscription.planKey;
      priceMonthly = catalog.data?.priceMonthly ?? 0;
      currency = catalog.data?.currency ?? 'PLN';
    }

    const owner = ownerFromContext(ctx);
    const invoiceResult = await this.reads.findLatestHostedInvoiceUrl({
      userId: ctx.userId,
      organizationId: owner.type === 'org' ? owner.orgId : null,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
    });
    if (isFailure(invoiceResult)) return invoiceResult;

    const status = isBillingReadStatus(subscription.status) ? subscription.status : 'none';
    const subscribable = SUBSCRIBABLE_STATUSES.has(subscription.status);

    // The read-side RLS accepts an org manager (the `member.manage` capability),
    // while the provider actions below require the stricter `admin` role. Do
    // not advertise an action the portal/change/cancel endpoints would refuse.
    let canManage = true;
    if (owner.type === 'org') {
      const admin = await this.repository.isOrgAdmin(owner.orgId, ctx.userId);
      if (isFailure(admin)) return admin;
      canManage = admin.data;
    }

    return success({
      ...base,
      planKey,
      planName,
      status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      // A scheduled change that already landed is history: the applied plan
      // equals the marker, so never render "changing to the current plan".
      pendingPlanKey:
        subscription.pendingPlanKey && subscription.pendingPlanKey !== planKey
          ? subscription.pendingPlanKey
          : null,
      priceMonthly,
      currency,
      canManagePortal: canManage,
      canChangePlan: canManage && subscribable,
      canCancel: canManage && subscribable,
      hostedInvoiceUrl: invoiceResult.data,
    });
  }

  /**
   * Open the Billing Portal for the authenticated owner (#662 §7.1).
   *
   * The owner comes from `ctx` only. An organization call re-checks
   * `org_members` + the `admin` role on every request because `active_org_id`
   * is a cookie hint, not an authorization. A missing customer mapping is a
   * clean `NOT_FOUND` ("buy a plan"), never a broken portal.
   */
  async createPortalSession(
    ctx: RequestContext,
    locale: BillingLocale = 'pl',
  ): Promise<ServiceResult<{ url: string }>> {
    const owner = ownerFromContext(ctx);

    if (owner.type === 'org') {
      const admin = await this.repository.isOrgAdmin(owner.orgId, ctx.userId);
      if (isFailure(admin)) return admin;
      if (!admin.data) return failure('FORBIDDEN');
    }

    const returnUrl = `${getSiteUrl()}${billingPath(ctx.accountType)}`;

    // The mock has no customer mapping or hosted portal; it returns the local
    // account-type-aware billing page.
    if (this.gateway.driver === 'mock') {
      return this.gateway.createPortalSession({ owner, returnUrl, locale });
    }

    const customer = await this.repository.findCustomer(owner, this.gateway.livemode);
    if (isFailure(customer)) return customer;
    if (!customer.data) return failure('NOT_FOUND');

    return this.gateway.createPortalSession({
      owner,
      customerId: customer.data.stripeCustomerId,
      returnUrl,
      locale,
    });
  }

  /**
   * Upgrade now (anchor reset + unused-time credit) or downgrade at period end
   * (#662 §2.5). The entitlement is **not** written here: the webhook applies
   * the target plan when Stripe reports the new price.
   */
  async changePlan(
    ctx: RequestContext,
    targetPlanKey: string,
  ): Promise<ServiceResult<ChangePlanResult>> {
    if (this.gateway.driver === 'mock') return failure('NOT_FOUND');

    const targetResult = await this.repository.getPlan(targetPlanKey);
    if (isFailure(targetResult)) return targetResult;

    const target = targetResult.data;
    if (!target || !target.isActive || target.priceMonthly <= 0) return failure('BAD_REQUEST');

    const owner = ownerFromContext(ctx);
    const targetIsOrgPlan = target.forAccountType === AccountType.MANAGER;

    // A plan belongs to exactly one family; an organization plan can never be
    // attached to a personal owner (and vice versa), even if a caller guesses
    // the key.
    if (targetIsOrgPlan !== (owner.type === 'org')) return failure('FORBIDDEN');
    if (
      !targetIsOrgPlan &&
      target.forAccountType &&
      (!isAccountType(target.forAccountType) || target.forAccountType !== ctx.accountType)
    ) {
      return failure('FORBIDDEN');
    }

    if (owner.type === 'org') {
      const admin = await this.repository.isOrgAdmin(owner.orgId, ctx.userId);
      if (isFailure(admin)) return admin;
      if (!admin.data) return failure('FORBIDDEN');
    }

    const activeResult = await this.repository.findActiveSubscription(owner, this.gateway.livemode);
    if (isFailure(activeResult)) return activeResult;
    const active = activeResult.data;
    if (!active) return failure('NOT_FOUND');
    if (active.planKey === target.key) return failure('BAD_REQUEST');

    const currentResult = await this.repository.getPlan(active.planKey);
    if (isFailure(currentResult)) return currentResult;
    const current = currentResult.data;
    if (!current) return failure('NOT_FOUND');

    // Money-affecting direction must not depend on a display-only sort order:
    // require the catalog price and sort order to agree, and fail closed when a
    // catalog edit makes them disagree.
    const priceDirection =
      target.priceMonthly > current.priceMonthly
        ? 'upgrade'
        : target.priceMonthly < current.priceMonthly
          ? 'downgrade'
          : null;
    const sortDirection =
      target.sortOrder > current.sortOrder
        ? 'upgrade'
        : target.sortOrder < current.sortOrder
          ? 'downgrade'
          : null;

    if (!priceDirection && !sortDirection) return failure('BAD_REQUEST');
    if (priceDirection && sortDirection && priceDirection !== sortDirection) {
      logError('billing.plan_direction_mismatch', {
        currentPlanKey: current.key,
        targetPlanKey: target.key,
      });
      return failure('SERVICE_UNAVAILABLE');
    }
    const direction: 'upgrade' | 'downgrade' = priceDirection ?? sortDirection ?? 'upgrade';

    const customer = await this.repository.findCustomer(owner, this.gateway.livemode);
    if (isFailure(customer)) return customer;
    if (!customer.data) return failure('NOT_FOUND');

    const listed = await this.repository.findListedPrice(
      target.key,
      'monthly',
      this.gateway.livemode,
    );
    if (isFailure(listed)) return listed;

    const mismatch = validateListedPrice(target, listed.data);
    if (mismatch) {
      logError('billing.price_mismatch', { planKey: target.key, reason: mismatch });
      return failure('SERVICE_UNAVAILABLE');
    }

    const result = await this.gateway.changePlan({
      owner,
      customerId: customer.data.stripeCustomerId,
      subscriptionId: active.stripeSubscriptionId,
      currentPlanKey: active.planKey,
      targetPlanKey: target.key,
      targetPriceId: listed.data!.stripePriceId,
      direction,
      idempotencyKey: changePlanIdempotencyKey(
        active.stripeSubscriptionId,
        target.key,
        listed.data!.stripePriceId,
        active.currentPeriodEnd,
      ),
    });
    if (isFailure(result)) return result;

    // `pending_plan_key` is a display marker for a scheduled phase or an
    // upgrade invoice awaiting authentication. The plan key itself still
    // changes only when the webhook applies the new price.
    const pendingForNextPeriod =
      result.data.status === 'scheduled' || result.data.status === 'pending_payment';
    const marker = await this.repository.setPendingPlan(
      active.stripeSubscriptionId,
      pendingForNextPeriod ? target.key : null,
    );
    if (isFailure(marker)) {
      // The provider change already succeeded; a failed marker must not invite
      // a retry that would create a second schedule.
      logWarn('billing.pending_plan_marker_failed', {
        subscriptionId: active.stripeSubscriptionId,
        planKey: target.key,
      });
    }

    return success(result.data);
  }

  /**
   * Cancel at period end, or reactivate before it takes effect (#662 §7.3).
   * The mirror and the entitlement change only when the webhook arrives, so a
   * cancelled subscription keeps access until `customer.subscription.deleted`.
   */
  async cancelSubscription(
    ctx: RequestContext,
    cancel: boolean,
  ): Promise<ServiceResult<{ cancelAtPeriodEnd: boolean }>> {
    if (this.gateway.driver === 'mock') return failure('NOT_FOUND');

    const owner = ownerFromContext(ctx);

    if (owner.type === 'org') {
      const admin = await this.repository.isOrgAdmin(owner.orgId, ctx.userId);
      if (isFailure(admin)) return admin;
      if (!admin.data) return failure('FORBIDDEN');
    }

    const activeResult = await this.repository.findActiveSubscription(owner, this.gateway.livemode);
    if (isFailure(activeResult)) return activeResult;
    if (!activeResult.data) return failure('NOT_FOUND');

    const customer = await this.repository.findCustomer(owner, this.gateway.livemode);
    if (isFailure(customer)) return customer;
    if (!customer.data) return failure('NOT_FOUND');

    const result = await this.gateway.cancelAtPeriodEnd({
      owner,
      customerId: customer.data.stripeCustomerId,
      subscriptionId: activeResult.data.stripeSubscriptionId,
      cancel,
    });
    if (isFailure(result)) return result;

    return success(result.data);
  }
}

export const billingService = wrapService(
  new BillingService(getPaymentGateway()),
  'billing.service',
);
