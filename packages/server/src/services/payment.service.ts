import type { RequestContext } from '@studiq/authz';
import type { PaymentDriver } from '@studiq/server/lib/payment/payment-gateway';
import { wrapService } from '@studiq/server/lib/observability';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { dbRows } from '@studiq/server/lib/supabase/rows';
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
  /** `mock` or `stripe`; the simulation and the real provider share this table. */
  provider: PaymentDriver;
  /** Signed Stripe-hosted invoice URL; only present for the payment owner. */
  hostedInvoiceUrl: string | null;
}

/**
 * Read model for the "Historia płatności" page (#392). Rows are written with the
 * service-role client by the mock webhook and by the real Stripe webhook
 * (`invoice.paid` only); this service reads the caller's own rows with their
 * session client (the `payments` table has an own-row SELECT policy and no
 * write policy).
 *
 * The column is `text` in Postgres with a two-value CHECK; the DTO narrows it
 * to the same union the billing read model uses.
 */
export class PaymentService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async listMine(ctx: RequestContext): Promise<ServiceResult<PaymentHistoryItem[]>> {
    const supabase = await this.clientFactory();

    const { data, error } = await supabase
      .from('payments')
      .select('id, plan_key, plan_name, amount, currency, paid_at, provider, hosted_invoice_url')
      .eq('user_id', ctx.userId)
      .order('paid_at', { ascending: false });

    if (error) return toDbFailure(error);

    return success(
      dbRows(data).map((payment) => ({
        id: payment.id,
        planKey: payment.plan_key,
        planName: payment.plan_name,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paid_at,
        provider: payment.provider === 'stripe' ? 'stripe' : 'mock',
        hostedInvoiceUrl: payment.hosted_invoice_url,
      })),
    );
  }
}
export const paymentService = wrapService(new PaymentService(createClient), 'payment.service');
