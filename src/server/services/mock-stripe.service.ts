import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/logger';
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
  async createCheckoutSession(planId: string, userId: string, orgId?: string): Promise<{ url: string; sessionId: string }> {
    const supabase = await createClient();

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id, name, category, price')
      .eq('name', planId)
      .single();

    if (!plan) throw new AppError('NOT_FOUND');

    const sessionId = crypto.randomUUID();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const url = `${baseUrl}/checkout?session_id=${sessionId}&plan_id=${planId}`;

    log.ai.info('mock checkout session created', {
      metadata: { sessionId, planId, userId, orgId: orgId ?? null, price: plan.price },
    });

    return { url, sessionId };
  }

  async handleWebhook(event: {
    type: string;
    session_id: string;
    plan_id: string;
    user_id: string;
    org_id?: string;
  }): Promise<void> {
    if (event.type !== 'checkout.session.completed') return;

    const supabase = await createClient();

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id, name, category')
      .eq('name', event.plan_id)
      .single();

    if (!plan) {
      log.ai.error('mock webhook: plan not found', { metadata: { planId: event.plan_id } });
      return;
    }

    if (plan.category === 'org' && event.org_id) {
      await this.upgradeOrgSubscription(supabase, event.org_id, plan.id, event.user_id);
    } else {
      await this.upgradeUserSubscription(supabase, event.user_id, plan.id);
    }

    log.ai.info('mock webhook processed', {
      metadata: { sessionId: event.session_id, planId: event.plan_id, userId: event.user_id },
    });
  }

  async createPortalSession(_userId: string): Promise<{ url: string }> {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    return { url: `${baseUrl}/app/billing` };
  }

  private async upgradeOrgSubscription(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, planId: string, _userId?: string): Promise<void> {
    const { data: existing } = await supabase
      .from('org_subscriptions')
      .select('id')
      .eq('organization_id', orgId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('org_subscriptions')
        .update({ plan_id: planId, status: 'active', updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('org_subscriptions').insert({
        organization_id: orgId,
        plan_id: planId,
        status: 'active',
      });
    }
  }

  private async upgradeUserSubscription(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, planId: string): Promise<void> {
    const { data: existing } = await supabase
      .from('user_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    const stripeSubId = `mock_sub_${crypto.randomUUID().slice(0, 8)}`;
    const stripeCustId = `mock_cus_${crypto.randomUUID().slice(0, 8)}`;

    if (existing) {
      await supabase
        .from('user_subscriptions')
        .update({
          plan_id: planId,
          plan_status: 'active',
          stripe_subscription_id: stripeSubId,
          stripe_customer_id: stripeCustId,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('user_subscriptions').insert({
        user_id: userId,
        plan_id: planId,
        plan_status: 'active',
        stripe_subscription_id: stripeSubId,
        stripe_customer_id: stripeCustId,
      });
    }

    await supabase.rpc('upgrade_user_to_premium', {
      p_user_id: userId,
      p_stripe_cust_id: stripeCustId,
      p_stripe_sub_id: stripeSubId,
      p_ends_at: null,
    });
  }
}

export const mockStripeService = new MockStripeService();
