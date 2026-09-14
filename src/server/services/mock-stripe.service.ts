import type { SupabaseClient } from '@supabase/supabase-js';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type { Nullable } from '@/types';

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

  async createCheckoutSession(
    planId: string,
    _userId: string,
    _orgId?: string,
  ): Promise<ServiceResult<{ url: string; sessionId: string }>> {
    const supabase = await this.createClient();

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('key')
      .eq('key', planId)
      .maybeSingle();

    if (!plan) return failure('BAD_REQUEST');

    const sessionId = crypto.randomUUID();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const url = `${baseUrl}/checkout?session_id=${sessionId}&plan_id=${planId}`;

    return success({ url, sessionId });
  }

  async handleWebhook(event: {
    type: string;
    session_id: string;
    plan_id: string;
    user_id: string;
    org_id?: string;
  }): Promise<ServiceResult<void>> {
    if (event.type !== 'checkout.session.completed') return success(undefined);

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
