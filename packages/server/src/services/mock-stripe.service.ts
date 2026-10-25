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
    event: {
      type: string;
      session_id: string;
      plan_id: string;
      user_id: string;
      org_id?: string;
    },
    accountType: string,
  ): Promise<ServiceResult<void>> {
    if (event.type !== 'checkout.session.completed') return success(undefined);

    const purchasable = await this.assertPlanPurchasable(event.plan_id, accountType);
    if (isFailure(purchasable)) return purchasable;

    if (purchasable.data.isOrgPlan) {
      const admin = await this.assertOrgAdmin(event.org_id, event.user_id);
      if (isFailure(admin)) return admin;

      // organizations.plan alone changes nothing: features and limits are
      // snapshots, so the DB function moves the plan and re-syncs them.
      const { error: planError } = await this.createAdminClient().rpc('apply_org_plan', {
        p_org_id: event.org_id,
        p_plan: event.plan_id,
      });
      if (planError) return toDbFailure(planError);
    }

    // profiles is write-locked for `authenticated` (see migration
    // 20261022000001_profiles_write_lockdown.sql) so a plan upgrade must go
    // through the service-role client, not the caller's session.
    const admin = this.createAdminClient();

    const { error } = await admin
      .from('profiles')
      .update({ personal_plan_key: event.plan_id })
      .eq('id', event.user_id);

    if (error) return toDbFailure(error);

    // Append-only purchase log for "Historia płatności" (#392). The plan
    // update above stays the source of truth for entitlements; this row only
    // records what was bought, at the catalog price read during this request.
    // `session_id` is unique, so a replayed webhook collapses onto the same row
    // (`ignoreDuplicates` → ON CONFLICT DO NOTHING).
    const { error: paymentError } = await admin.from('payments').upsert(
      {
        user_id: event.user_id,
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
