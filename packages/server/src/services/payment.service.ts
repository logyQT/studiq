import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export interface PaymentHistoryItem {
  id: string;
  planKey: string;
  planName: string;
  amount: number;
  currency: string;
  paidAt: string;
}

/**
 * Read model for the "Historia płatności" page (#392). Rows are written only by
 * the mock-stripe webhook through the service-role client; this service reads
 * the caller's own rows with their session client (the `payments` table has an
 * own-row SELECT policy and no write policy).
 */
export class PaymentService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async listMine(ctx: RequestContext): Promise<ServiceResult<PaymentHistoryItem[]>> {
    const supabase = await this.clientFactory();

    const { data, error } = await supabase
      .from('payments')
      .select('id, plan_key, plan_name, amount, currency, paid_at')
      .eq('user_id', ctx.userId)
      .order('paid_at', { ascending: false });

    if (error) return toDbFailure(error);

    return success(
      (data ?? []).map((payment) => ({
        id: payment.id,
        planKey: payment.plan_key,
        planName: payment.plan_name,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paid_at,
      })),
    );
  }
}
export const paymentService = wrapService(new PaymentService(createClient), 'payment.service');
