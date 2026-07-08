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

const PLAN_CATEGORIES: Record<string, 'individual' | 'org'> = {
  free: 'individual',
  student_premium: 'individual',
  teacher_license: 'org',
  org_pro: 'org',
};

export class MockStripeService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async createCheckoutSession(
    planId: string,
    _userId: string,
    _orgId?: string,
  ): Promise<ServiceResult<{ url: string; sessionId: string }>> {
    if (!PLAN_CATEGORIES[planId]) {
      return failure('BAD_REQUEST');
    }

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

    const category = PLAN_CATEGORIES[event.plan_id];
    if (!category) {
      return success(undefined);
    }

    if (category === 'individual') {
      const { error } = await supabase
        .from('profiles')
        .update({ role: 'premium' })
        .eq('id', event.user_id)
        .eq('role', 'free');

      if (error) return toDbFailure(error);
    }

    return success(undefined);
  }

  async createPortalSession(_userId: string): Promise<ServiceResult<{ url: string }>> {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    return success({ url: `${baseUrl}/app/billing` });
  }
}
