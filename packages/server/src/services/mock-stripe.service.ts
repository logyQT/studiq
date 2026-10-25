import { isOrgAdminRole, type Nullable } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

export type MockCheckoutSession = {
  id: string;
  planId: string;
  userId: string;
  orgId: Nullable<string>;
  status: 'open' | 'completed' | 'expired';
  url: string;
};

/**
 * The (mock) Stripe event fields the service may trust. The caller identity is
 * deliberately absent: it comes from the authenticated RequestContext
 * (`ctx.userId`), never from the request body.
 */
export type MockWebhookEvent = {
  type: string;
  session_id: string;
  plan_id: string;
  org_id?: string;
};

export class MockStripeService {
  constructor(
    private createClient: () => Promise<SupabaseClient>,
    private createAdminClient: () => SupabaseClient = createServiceClient,
  ) {}

  /**
   * A plan can be bought only if it exists, is active and is meant for the buyer's account type.
   * Reports whether it is an organization plan (bought for an org, not for the buyer) and the
   * catalog values that are snapshotted into the purchase history.
   */
  private async assertPlanPurchasable(
    planKey: string,
    accountType: string,
  ): Promise<
    ServiceResult<{ isOrgPlan: boolean; planName: string; amount: number; currency: string }>
  > {
    const supabase = await this.createClient();

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('key, name, is_active, for_account_type, price_monthly, currency')
      .eq('key', planKey)
      .maybeSingle();

    if (!plan?.is_active) return failure('BAD_REQUEST');
    if (plan.for_account_type && plan.for_account_type !== accountType) {
      return failure('FORBIDDEN');
    }
    return success({
      isOrgPlan: plan.for_account_type === 'manager',
      planName: plan.name ?? plan.key,
      amount: plan.price_monthly ?? 0,
      currency: plan.currency ?? 'PLN',
    });
  }

  /** An organization plan can be bought only by an admin of that organization. */
  private async assertOrgAdmin(
    orgId: string | undefined,
    userId: string,
  ): Promise<ServiceResult<void>> {
    if (!orgId) return failure('BAD_REQUEST');

    const supabase = await this.createClient();
    const { data: membership, error } = await supabase
      .from('org_members')
      .select('org_roles!inner(name)')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return toDbFailure(error);

    const role = membership?.org_roles as { name?: string } | { name?: string }[] | undefined;
    const roleName = Array.isArray(role) ? role[0]?.name : role?.name;
    if (!isOrgAdminRole(roleName)) return failure('FORBIDDEN');
    return success(undefined);
  }

  async createCheckoutSession(
    planId: string,
    accountType: string,
    userId: string,
    orgId?: string,
  ): Promise<ServiceResult<{ url: string; sessionId: string }>> {
    const purchasable = await this.assertPlanPurchasable(planId, accountType);
    if (isFailure(purchasable)) return purchasable;

    if (purchasable.data.isOrgPlan) {
      const admin = await this.assertOrgAdmin(orgId, userId);
      if (isFailure(admin)) return admin;
    }

    const sessionId = crypto.randomUUID();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const orgParam = purchasable.data.isOrgPlan ? `&org_id=${orgId}` : '';
    const url = `${baseUrl}/checkout?session_id=${sessionId}&plan_id=${planId}${orgParam}`;

    return success({ url, sessionId });
  }

  async handleWebhook(
    event: MockWebhookEvent,
    accountType: string,
    // The authenticated caller (ctx.userId), never the request body.
    userId: string,
  ): Promise<ServiceResult<void>> {
    if (event.type !== 'checkout.session.completed') return success(undefined);

    const purchasable = await this.assertPlanPurchasable(event.plan_id, accountType);
    if (isFailure(purchasable)) return purchasable;

    // `profiles` is write-locked for `authenticated` (see migration
    // 20261022000001_profiles_write_lockdown.sql) and `apply_org_plan` is
    // service-role only, so entitlement writes use the admin client, never the
    // caller's session.
    const admin = this.createAdminClient();

    if (purchasable.data.isOrgPlan) {
      const adminMembership = await this.assertOrgAdmin(event.org_id, userId);
      if (isFailure(adminMembership)) return adminMembership;

      // organizations.plan alone changes nothing: features and limits are
      // snapshots, so the DB function moves the plan and re-syncs them.
      const { error: planError } = await admin.rpc('apply_org_plan', {
        p_org_id: event.org_id,
        p_plan: event.plan_id,
      });
      if (planError) return toDbFailure(planError);
    } else {
      // An organization purchase changes the organization, never the buyer's
      // personal plan: a manager's personal plan is the free `launch` tier and
      // applies only outside an organization (#228). Only a plan bought for the
      // buyer themselves updates `profiles.personal_plan_key`.
      const { error } = await admin
        .from('profiles')
        .update({ personal_plan_key: event.plan_id })
        .eq('id', userId);

      if (error) return toDbFailure(error);
    }

    // Append-only purchase log for "Historia płatności" (#392). The entitlement
    // write above (`organizations.plan` or `profiles.personal_plan_key`) stays
    // the source of truth; this row only records what was bought, at the
    // catalog price read during this request.
    // `session_id` is unique, so a replayed webhook collapses onto the same row
    // (`ignoreDuplicates` → ON CONFLICT DO NOTHING).
    const { error: paymentError } = await admin.from('payments').upsert(
      {
        user_id: userId,
        organization_id: purchasable.data.isOrgPlan ? (event.org_id ?? null) : null,
        plan_key: event.plan_id,
        plan_name: purchasable.data.planName,
        amount: purchasable.data.amount,
        currency: purchasable.data.currency,
        session_id: event.session_id,
      },
      { onConflict: 'session_id', ignoreDuplicates: true },
    );

    if (paymentError) return toDbFailure(paymentError);

    return success(undefined);
  }

  async createPortalSession(_userId: string): Promise<ServiceResult<{ url: string }>> {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    return success({ url: `${baseUrl}/app/billing` });
  }
}
export const mockStripeService = wrapService(
  new MockStripeService(createClient),
  'mock-stripe.service',
);
