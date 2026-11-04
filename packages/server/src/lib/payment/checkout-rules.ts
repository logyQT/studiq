import { AccountType } from '@studiq/authz';
import { isAccountType } from '@studiq/server/lib/authz';
import type { PaymentOwner } from '@studiq/server/lib/payment/payment-gateway';
import type { CatalogPlan } from '@studiq/server/lib/payment/stripe-repository';
import { failure, isFailure, success, type ServiceResult } from '@studiq/server/lib/service-result';

/**
 * The domain rules that decide whether a plan may be bought, and for whom
 * (#662 §5.2, workstream A3). They used to exist twice — once in
 * `BillingService.startCheckout` and once inside `MockStripeService` — which let
 * the mock and Stripe paths drift apart. Both now go through this module, so
 * the gateway itself only performs provider I/O.
 *
 * Reads only: no entitlement or payment write happens here.
 */
export interface CheckoutRulePort {
  getPlan(planKey: string): Promise<ServiceResult<CatalogPlan | null>>;
  isOrgAdmin(orgId: string, userId: string): Promise<ServiceResult<boolean>>;
}

export interface ResolvedPlan {
  plan: CatalogPlan;
  /** The catalog family is the organization family (`manager`). */
  isOrgPlan: boolean;
}

export interface CheckoutCaller {
  userId: string;
  accountType: AccountType;
}

/** `for_account_type` of the organization family. */
export function isOrganizationPlanFamily(plan: Pick<CatalogPlan, 'forAccountType'>): boolean {
  return plan.forAccountType === AccountType.MANAGER;
}

/**
 * A plan may be *applied* when it exists, is active and belongs to the buyer's
 * account family (a `null` family is available to every type). Free plans are
 * included: they are reached by a lifecycle change (the mock's completion
 * command, Stripe's `customer.subscription.deleted`), not by a purchase.
 *
 * The family is checked before the price on purpose: asking for another
 * family's plan is a `FORBIDDEN` even when that plan is free.
 */
export async function resolveApplicablePlan(
  port: Pick<CheckoutRulePort, 'getPlan'>,
  planKey: string,
  accountType: AccountType,
): Promise<ServiceResult<ResolvedPlan>> {
  const result = await port.getPlan(planKey);
  if (isFailure(result)) return result;

  const plan = result.data;
  if (!plan?.isActive) return failure('BAD_REQUEST');

  if (
    plan.forAccountType &&
    (!isAccountType(plan.forAccountType) || plan.forAccountType !== accountType)
  ) {
    return failure('FORBIDDEN');
  }

  return success({ plan, isOrgPlan: isOrganizationPlanFamily(plan) });
}

/**
 * A plan is *purchasable* only when it may be applied **and** costs money: the
 * free tier is assigned, never checked out.
 */
export async function resolvePurchasablePlan(
  port: Pick<CheckoutRulePort, 'getPlan'>,
  planKey: string,
  accountType: AccountType,
): Promise<ServiceResult<ResolvedPlan>> {
  const result = await resolveApplicablePlan(port, planKey, accountType);
  if (isFailure(result)) return result;
  if (result.data.plan.priceMonthly <= 0) return failure('BAD_REQUEST');
  return result;
}

/**
 * Resolve the billing owner from the authenticated caller, never from the
 * request body. An organization plan requires an explicit org id and a current
 * `admin` membership; the caller is recorded as the purchaser.
 */
export async function resolveCheckoutOwner(
  port: Pick<CheckoutRulePort, 'isOrgAdmin'>,
  plan: ResolvedPlan,
  caller: CheckoutCaller,
  orgId?: string,
): Promise<ServiceResult<PaymentOwner>> {
  if (!plan.isOrgPlan) {
    return success({ type: 'user', userId: caller.userId, accountType: caller.accountType });
  }

  if (!orgId) return failure('BAD_REQUEST');

  const admin = await port.isOrgAdmin(orgId, caller.userId);
  if (isFailure(admin)) return admin;
  if (!admin.data) return failure('FORBIDDEN');

  return success({
    type: 'org',
    orgId,
    userId: caller.userId,
    accountType: caller.accountType,
  });
}
