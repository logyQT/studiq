import { AccountType } from '@studiq/authz';
import type {
  ChangePlanPreview,
  ChangePlanResult,
} from '@studiq/server/lib/payment/payment-gateway';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { apiPost } from '@/lib/api';

/**
 * Pure decisions for the shared billing card (#662 §7.4). Keeping them out of
 * the component makes the plan/status/date rules testable without a renderer
 * (the repo has no component-test stack).
 */

const KNOWN_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'paused',
  'free',
  'none',
]);

const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

export type PlanFamily = 'student' | 'educator' | 'manager';

export function billingPlanFamily(accountType: AccountType): PlanFamily {
  if (accountType === AccountType.MANAGER) return 'manager';
  if (accountType === AccountType.EDUCATOR) return 'educator';
  return 'student';
}

/** Paid plans of the caller's plan family, cheapest first, excluding the current plan. */
export function alternativePlans(
  plans: PlanInfo[] | undefined,
  subscription: BillingSubscriptionView,
  accountType: AccountType,
): PlanInfo[] {
  const family = billingPlanFamily(accountType);
  // The effective plan may be a seat plan; exclude what Stripe already bills.
  const currentPlanKey = subscription.billedPlanKey ?? subscription.planKey;

  return (plans ?? [])
    .filter((plan) => {
      if (plan.priceMonthly <= 0 || plan.key === currentPlanKey) return false;
      // Managers see the organization catalogue; everyone else the one
      // individual ladder, which no longer has an audience (#1193).
      return family === 'manager' ? plan.scope === 'organization' : plan.scope === 'personal';
    })
    .toSorted((a, b) => a.priceMonthly - b.priceMonthly);
}

/** `status_active` for a known status, `null` to render the raw provider value. */
export function billingStatusKey(status: string): string | null {
  return KNOWN_STATUSES.has(status) ? `status_${status}` : null;
}

export interface PeriodRow {
  labelKey: 'period_label';
  messageKey: 'renews_on';
  date: string;
}

/**
 * The renewal row, or `null` when the period is not meaningful (a canceled
 * subscription must not claim it "renews" in the past) or when cancellation is
 * scheduled — that date is the explicit cancellation row, not a renewal.
 */
export function periodRow(subscription: BillingSubscriptionView): PeriodRow | null {
  if (!subscription.currentPeriodEnd) return null;
  if (scheduledCancellationDate(subscription)) return null;
  if (LIVE_STATUSES.has(subscription.status)) {
    return {
      labelKey: 'period_label',
      messageKey: 'renews_on',
      date: subscription.currentPeriodEnd,
    };
  }
  return null;
}

/**
 * The date access ends when cancellation is scheduled, or `null`. A canceled
 * status means the date is already history, so it never renders as scheduled.
 */
export function scheduledCancellationDate(subscription: BillingSubscriptionView): string | null {
  if (!subscription.cancelAtPeriodEnd || !subscription.currentPeriodEnd) return null;
  if (!LIVE_STATUSES.has(subscription.status)) return null;
  return subscription.currentPeriodEnd;
}

export function hasProviderActions(subscription: BillingSubscriptionView): boolean {
  return subscription.canManagePortal || subscription.canCancel || subscription.canChangePlan;
}

/**
 * What to show when no provider action is available: the simulation, a member
 * who is not an org admin, or an account that never bought through Stripe.
 */
export function noActionsMessageKey(
  subscription: BillingSubscriptionView,
): 'mock_billing_note' | 'no_manage_permission' | 'no_billing_account' {
  if (subscription.provider === 'mock') return 'mock_billing_note';
  const hasPlan = Boolean(subscription.planKey) && subscription.status !== 'none';
  if (hasPlan && subscription.status !== 'free') return 'no_manage_permission';
  return 'no_billing_account';
}

/** The billed plan's catalogue name for the success confirmation (never the seat plan). */
export function activatedPlanLabel(
  subscription: BillingSubscriptionView | null | undefined,
): string | null {
  return subscription?.billedPlanName ?? null;
}

/** A Stripe-hosted URL is rendered only when it is a non-empty string. */
export function invoiceHref(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  return trimmed ? trimmed : null;
}

interface SeatPoolSummary {
  used: number;
  total: number;
  visible: boolean;
}

export function seatsSummary(
  pools: readonly { total: number; assigned: number }[] | undefined,
): SeatPoolSummary {
  const total = pools?.reduce((sum, pool) => sum + pool.total, 0) ?? 0;
  const used = pools?.reduce((sum, pool) => sum + pool.assigned, 0) ?? 0;
  return { used, total, visible: total > 0 };
}

export interface PlanChangeFeedback {
  messageKey: 'change_plan_applied' | 'change_plan_scheduled' | 'change_plan_pending';
  tone: 'success' | 'info';
  hostedInvoiceUrl: string | null;
}

export function planChangeFeedback(result: ChangePlanResult): PlanChangeFeedback {
  if (result.status === 'scheduled') {
    return {
      messageKey: 'change_plan_scheduled',
      tone: 'success',
      hostedInvoiceUrl: null,
    };
  }
  if (result.status === 'pending_payment') {
    return {
      messageKey: 'change_plan_pending',
      tone: 'info',
      hostedInvoiceUrl: invoiceHref(result.hostedInvoiceUrl),
    };
  }
  return { messageKey: 'change_plan_applied', tone: 'success', hostedInvoiceUrl: null };
}

/** Where the account's payment history lives, or `null` for managers. */
export function invoiceHistoryPath(accountType: AccountType): string | null {
  if (accountType === AccountType.STUDENT) return '/app/account/payments';
  if (accountType === AccountType.EDUCATOR) return '/edu/account/payments';
  return null;
}

/**
 * The `/app/billing` and `/edu/billing` surfaces read and act on the caller's
 * own subscription, even when they may bill the active organization
 * (#1493 follow-up). `/manage/billing` asks for no scope and keeps the
 * org-first owner.
 */
export function billingScopeUrl(url: string, personal: boolean): string {
  if (!personal) return url;
  return `${url}${url.includes('?') ? '&' : '?'}scope=personal`;
}

/** A billing action body that selects the caller's own subscription. */
export function withPersonalScope<T extends object>(
  body: T,
  personal: boolean,
): T & { scope?: 'personal' } {
  return personal ? { ...body, scope: 'personal' } : body;
}

export type BillingCardAction =
  | { type: 'portal'; locale: string }
  | { type: 'cancel'; cancel: boolean }
  | { type: 'release' }
  | { type: 'preview'; planKey: string }
  | { type: 'change'; planKey: string };

export interface BillingCardRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: Record<string, unknown>;
}

/**
 * The one request builder behind the billing card's four provider actions.
 *
 * The read and the portal/release actions carry the personal scope in the URL;
 * cancel and change carry it in the JSON body. Keeping the decision here pins
 * every call site: a card that renders on a personal surface must never send
 * one of the four without `scope=personal`.
 */
export function billingCardRequest(
  action: BillingCardAction,
  personal: boolean,
): BillingCardRequest {
  if (action.type === 'portal') {
    return {
      method: 'GET',
      url: billingScopeUrl(`/api/v1/stripe/portal?locale=${action.locale}`, personal),
    };
  }
  if (action.type === 'cancel') {
    return {
      method: 'POST',
      url: '/api/v1/billing/cancel',
      body: withPersonalScope({ cancel: action.cancel }, personal),
    };
  }
  if (action.type === 'release') {
    return {
      method: 'POST',
      url: billingScopeUrl('/api/v1/billing/release-scheduled-plan', personal),
      body: {},
    };
  }
  if (action.type === 'preview') {
    return {
      method: 'POST',
      url: '/api/v1/billing/change-plan/preview',
      body: withPersonalScope({ planKey: action.planKey }, personal),
    };
  }
  return {
    method: 'POST',
    url: '/api/v1/billing/change-plan',
    body: withPersonalScope({ planKey: action.planKey }, personal),
  };
}

/**
 * The plan button's click action: fetch the read-only preview. The confirmed
 * change is a separate call from the dialog, so a click can never charge.
 */
export async function previewPlanChange(
  planKey: string,
  personal: boolean,
  post: (url: string, body: unknown) => Promise<ChangePlanPreview> = apiPost,
): Promise<ChangePlanPreview> {
  const request = billingCardRequest({ type: 'preview', planKey }, personal);
  return post(request.url, request.body);
}
