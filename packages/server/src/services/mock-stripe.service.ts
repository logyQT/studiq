import type { Nullable } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
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
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  /** A plan can be bought only if it exists, is active and is meant for the buyer's account type. */
  private async assertPlanPurchasable(
    planKey: string,
    accountType: string,
  ): Promise<ServiceResult<void>> {
    const supabase = await this.createClient();

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('key, is_active, for_account_type')
      .eq('key', planKey)
      .maybeSingle();

    if (!plan || !plan.is_active) return failure('BAD_REQUEST');
    if (plan.for_account_type && plan.for_account_type !== accountType) {
      return failure('FORBIDDEN');
    }
    return success(undefined);
  }

  async createCheckoutSession(
    planId: string,
    accountType: string,
    _userId: string,
    _orgId?: string,
  ): Promise<ServiceResult<{ url: string; sessionId: string }>> {
    const purchasable = await this.assertPlanPurchasable(planId, accountType);
    if (isFailure(purchasable)) return purchasable;

    const sessionId = crypto.randomUUID();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const url = `${baseUrl}/checkout?session_id=${sessionId}&plan_id=${planId}`;

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

    const supabase = await this.createClient();

    const { error } = await supabase
      .from('profiles')
      .update({ personal_plan_key: event.plan_id })
      .eq('id', event.user_id);

    if (error) return toDbFailure(error);

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
