import { createClient } from '@/lib/supabase/server';
import type { Nullable } from '@/types';
import { log } from '@/lib/logger';

export type SubscriptionPlan = {
  id: string;
  name: string;
  category: 'individual' | 'org';
};

export type SubscriptionCheckResult = {
  allowed: boolean;
  plan: Nullable<SubscriptionPlan>;
  reason?: string;
};

export async function checkSubscription(userId: string): Promise<SubscriptionCheckResult> {
  try {
    const supabase = await createClient();

    const { data: sub } = await supabase
      .from('user_subscriptions')
      .select('plan_id, plan_status, ends_at')
      .eq('user_id', userId)
      .eq('plan_status', 'active')
      .maybeSingle();

    if (!sub || !sub.plan_id) {
      return { allowed: true, plan: { id: 'free', name: 'Free', category: 'individual' } };
    }

    if (sub.ends_at && new Date(sub.ends_at) < new Date()) {
      return { allowed: true, plan: { id: 'free', name: 'Free', category: 'individual' }, reason: 'Subscription expired' };
    }

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id, name, category')
      .eq('id', sub.plan_id)
      .single();

    if (!plan) {
      return { allowed: true, plan: { id: 'free', name: 'Free', category: 'individual' } };
    }

    return { allowed: true, plan: { id: plan.id, name: plan.name, category: plan.category as 'individual' | 'org' } };
  } catch (error) {
    log.api.error('checkSubscription error', { metadata: { error: String(error) } });
    return { allowed: true, plan: null };
  }
}
