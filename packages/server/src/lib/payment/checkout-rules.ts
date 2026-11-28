import { AccountType, SALES_CHANNEL_INDIVIDUAL } from '@studiq/authz';
import {
  billingModeAllowsSelfServe,
  isPubliclyListable,
} from '@studiq/server/lib/payment/plan-availability';
import type { PaymentOwner } from '@studiq/server/lib/payment/payment-gateway';
import type { CatalogPlan } from '@studiq/server/lib/payment/stripe-repository';
import { failure, isFailure, success, type ServiceResult } from '@studiq/server/lib/service-result';

/**
 * The domain rules that decide whether a plan may be bought, and for whom
 * (#662 §5.2, workstream A3; plan scope since ADR-0015 phase 4a, D34). They
 * used to exist twice — once in `BillingService.startCheckout` and once inside
 * `MockStripeService` — which let the mock and Stripe paths drift apart. Both
 * now go through this module, so the gateway itself only performs provider I/O.
 *
 * Reads only: no entitlement or payment write happens here.
 */
export interface CheckoutRulePort {
  getPlan(planKey: string): Promise<ServiceResult<CatalogPlan | null>>;
  /**
   * Whether `userId` holds `org.billing.manage` in `orgId`, evaluated at the
   * database (the `has_permission` definer RPC), never by role name and never
   * from a request context — the resolver is shared with the mock-completion
   * path, which has no ctx.
   */
  canManageBilling(orgId: string, userId: string): Promise<ServiceResult<boolean>>;
  /** Whether the plan is pinned to the organization through `plan_assignments`. */
  planIsAssignedToOrg(planKey: string, orgId: string): Promise<ServiceResult<boolean>>;
}

export interface ResolvedPlan {
  plan: CatalogPlan;
  /** The plan's `scope` is `organization`. */
  isOrgPlan: boolean;
}

export interface CheckoutCaller {
  userId: string;
  accountType: AccountType;
}

/** An organization plan has `scope='organization'`. */
export function isOrganizationPlanFamily(plan: Pick<CatalogPlan, 'scope'>): boolean {
  return plan.scope === 'organization';
}

/**
 * A plan may be *applied* when it exists, is active and its billing mode allows
 * self-serve checkout (B3: `invoice` and `none` are sales-led, never bought
 * through checkout). A personal plan is applicable to a content subscriber when
 * it is sold on the `individual` channel — a `seat_pool`-only licence is bought
 * by the organization through the pool path, never here (#1511). A manager is
 * an organization buyer and holds no personal plan (ADR-0007), so a personal
 * plan is refused for them. An organization plan is applicable too, and the
 * owner rule below decides who may buy it. A free plan is applicable only when
 * its billing mode allows checkout (`stripe`): it is then reached by a
 * lifecycle change (the mock's completion command, Stripe's
 * `customer.subscription.deleted`), not by a purchase.
 */
export async function resolveApplicablePlan(
  port: Pick<CheckoutRulePort, 'getPlan'>,
  planKey: string,
  caller: CheckoutCaller,
): Promise<ServiceResult<ResolvedPlan>> {
  const result = await port.getPlan(planKey);
  if (isFailure(result)) return result;

  const plan = result.data;
  if (!plan?.isActive) return failure('BAD_REQUEST');
  if (!billingModeAllowsSelfServe(plan.billingMode)) return failure('BAD_REQUEST');

  const isOrgPlan = isOrganizationPlanFamily(plan);
  if (!isOrgPlan && !plan.salesChannels.includes(SALES_CHANNEL_INDIVIDUAL)) {
    return failure('BAD_REQUEST');
  }
  if (!isOrgPlan && caller.accountType === AccountType.MANAGER) return failure('FORBIDDEN');

  return success({ plan, isOrgPlan });
}

/**
 * A plan is *purchasable* only when it may be applied **and** costs money: the
 * free tier is assigned, never checked out.
 */
export async function resolvePurchasablePlan(
  port: Pick<CheckoutRulePort, 'getPlan'>,
  planKey: string,
  caller: CheckoutCaller,
): Promise<ServiceResult<ResolvedPlan>> {
  const result = await resolveApplicablePlan(port, planKey, caller);
  if (isFailure(result)) return result;
  if (result.data.plan.priceMonthly <= 0) return failure('BAD_REQUEST');
  return result;
}

/**
 * Resolve the billing owner from the authenticated caller, never from the
 * request body. An organization plan requires an explicit org id and
 * `org.billing.manage` **in that target org**; the caller is recorded as the
 * purchaser.
 *
 * The target org is explicit and need not be the active one: authority is
 * proven in the target org itself, so a caller who manages billing in org B
 * but not in A may buy for B and is refused for A. There is deliberately no
 * active-org equality requirement here (ADR-0015 phase 5b, 2b-9 register
 * row 7).
 */
export async function resolveCheckoutOwner(
  port: Pick<CheckoutRulePort, 'canManageBilling'>,
  plan: ResolvedPlan,
  caller: CheckoutCaller,
  orgId?: string,
): Promise<ServiceResult<PaymentOwner>> {
  if (!plan.isOrgPlan) {
    return success({ type: 'user', userId: caller.userId, accountType: caller.accountType });
  }

  // An organization plan without an org the caller may bill is an
  // authorization answer, not a syntax one (BIL-05 stays a 403).
  if (!orgId) return failure('FORBIDDEN');

  const canManage = await port.canManageBilling(orgId, caller.userId);
  if (isFailure(canManage)) return canManage;
  if (!canManage.data) return failure('FORBIDDEN');

  return success({
    type: 'org',
    orgId,
    userId: caller.userId,
    accountType: caller.accountType,
  });
}

/**
 * An unlisted plan (B3) is bought or changed only by the organization it is
 * pinned to. The owner must already be resolved, because the answer depends on
 * it: the same plan key is refused for every other organization.
 *
 * `FORBIDDEN` matches the owner rule above: this is "not yours", not a syntax
 * error, and it does not confirm that the plan exists to a caller who does not
 * own it.
 */
export async function resolvePlanAssignment(
  port: Pick<CheckoutRulePort, 'planIsAssignedToOrg'>,
  plan: CatalogPlan,
  owner: PaymentOwner,
): Promise<ServiceResult<null>> {
  if (isPubliclyListable(plan)) return success(null);
  if (owner.type !== 'org') return failure('FORBIDDEN');

  const assigned = await port.planIsAssignedToOrg(plan.key, owner.orgId);
  if (isFailure(assigned)) return assigned;
  if (!assigned.data) return failure('FORBIDDEN');

  return success(null);
}
