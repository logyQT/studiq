import { AccountType, type RequestContext } from '@studiq/authz';
import { success, type ServiceResult } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Client-scoped reads for the shared billing read model (#662 §7.4).
 *
 * Unlike the checkout/webhook repositories this one deliberately uses the
 * caller's session client. `billing_subscriptions` has an own-row and an
 * org-manager SELECT policy, so RLS is the authorization boundary: a member
 * who is not an org manager gets no organization row instead of a service-role
 * read that would have to re-check the role by hand. Provider actions (portal,
 * change plan, cancel) still re-check the stricter `admin` role in the service.
 */
export interface SubscriptionReadRow {
  stripeSubscriptionId: string;
  planKey: string;
  /**
   * Plan actually committed to the entitlement column by the webhook. Null
   * until the fenced entitlement transaction has run for this subscription.
   */
  entitlementAppliedPlanKey: string | null;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlanKey: string | null;
}

export interface HostedInvoiceQuery {
  userId: string;
  organizationId: string | null;
  stripeSubscriptionId: string;
}

export interface BillingReadRepository {
  findSubscription(
    ctx: RequestContext,
    livemode: boolean,
  ): Promise<ServiceResult<SubscriptionReadRow | null>>;
  /**
   * The newest hosted invoice URL for exactly this subscription and owner, so a
   * second organization's invoice (or the other Stripe mode's invoice) can
   * never be rendered as this subscription's document.
   */
  findLatestHostedInvoiceUrl(query: HostedInvoiceQuery): Promise<ServiceResult<string | null>>;
}

const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];

export class SupabaseBillingReadRepository implements BillingReadRepository {
  constructor(
    private readonly clientFactory: () => Promise<SupabaseClient<Database>> = createClient,
  ) {}

  async findSubscription(
    ctx: RequestContext,
    livemode: boolean,
  ): Promise<ServiceResult<SubscriptionReadRow | null>> {
    const supabase = await this.clientFactory();

    const base = supabase
      .from('billing_subscriptions')
      .select(
        'stripe_subscription_id, plan_key, entitlement_applied_plan_key, status, current_period_end, cancel_at_period_end, pending_plan_key',
      )
      .eq('livemode', livemode);

    // A manager's active organization owns the subscription; everyone else
    // reads their own row. The organization id is a hint from the session
    // cookie, and the org-manager RLS policy decides whether the row is visible.
    const scoped =
      ctx.accountType === AccountType.MANAGER && ctx.activeOrgId
        ? base.eq('organization_id', ctx.activeOrgId)
        : base.eq('user_id', ctx.userId);

    const { data, error } = await scoped.order('updated_at', { ascending: false }).limit(10);

    if (error) return toDbFailure(error);
    if (!data || data.length === 0) return success(null);

    // A canceled row is kept as history, so a plain "latest row" could hide the
    // subscription that is still billing. Prefer a live status, then recency.
    const row =
      data.find((candidate) => LIVE_SUBSCRIPTION_STATUSES.includes(candidate.status)) ?? data[0];

    return success({
      stripeSubscriptionId: row.stripe_subscription_id,
      planKey: row.plan_key,
      entitlementAppliedPlanKey: row.entitlement_applied_plan_key ?? null,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      pendingPlanKey: row.pending_plan_key,
    });
  }

  async findLatestHostedInvoiceUrl(
    query: HostedInvoiceQuery,
  ): Promise<ServiceResult<string | null>> {
    const supabase = await this.clientFactory();

    // `payments` is own-row readable, so this can only ever return an invoice
    // attributed to the caller. The subscription and organization filters keep
    // a different subscription/org/mode out of the current card.
    let scoped = supabase
      .from('payments')
      .select('hosted_invoice_url')
      .eq('user_id', query.userId)
      .eq('provider', 'stripe')
      .eq('stripe_subscription_id', query.stripeSubscriptionId)
      .not('hosted_invoice_url', 'is', null);

    scoped = query.organizationId
      ? scoped.eq('organization_id', query.organizationId)
      : scoped.is('organization_id', null);

    const { data, error } = await scoped
      .order('paid_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return toDbFailure(error);
    return success(data?.hosted_invoice_url ?? null);
  }
}

export const billingReadRepository = new SupabaseBillingReadRepository();
