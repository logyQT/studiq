import { log } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
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
  async createCheckoutSession(
    planId: string,
    userId: string,
    orgId?: string,
  ): Promise<{ url: string; sessionId: string }> {
    if (!PLAN_CATEGORIES[planId]) {
      log.ai.error('unknown plan', { metadata: { planId } });
      throw new Error('Unknown plan');
    }

    const sessionId = crypto.randomUUID();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const url = `${baseUrl}/checkout?session_id=${sessionId}&plan_id=${planId}`;

    log.ai.info('mock checkout session created', {
      metadata: { sessionId, planId, userId, orgId: orgId ?? null },
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

    const category = PLAN_CATEGORIES[event.plan_id];
    if (!category) {
      log.ai.error('mock webhook: unknown plan', { metadata: { planId: event.plan_id } });
      return;
    }

    if (category === 'individual') {
      // Upgrade user to premium role
      const { error } = await supabase
        .from('profiles')
        .update({ role: 'premium' })
        .eq('id', event.user_id)
        .eq('role', 'free');

      if (error) {
        log.ai.error('mock webhook: failed to upgrade user', {
          metadata: { error, userId: event.user_id },
        });
        return;
      }
    }

    log.ai.info('mock webhook processed', {
      metadata: { sessionId: event.session_id, planId: event.plan_id, userId: event.user_id },
    });
  }

  async createPortalSession(_userId: string): Promise<{ url: string }> {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    return { url: `${baseUrl}/app/billing` };
  }
}

export const mockStripeService = new MockStripeService();
