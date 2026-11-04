import type { PaymentDriver } from '@studiq/server/lib/payment/payment-gateway';
import { failure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { createServiceClient } from '@studiq/server/lib/supabase/service';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * One append-only purchase log for every payment driver (#662 workstream A).
 *
 * Mock and Stripe rows share `payments`, but each provider has exactly one
 * replay-safe key:
 *
 * - mock → `session_id` (the id the checkout page receives from the checkout
 *   URL and reuses on a retry);
 * - Stripe → `stripe_invoice_id` (one row per paid invoice, renewals and
 *   upgrades included).
 *
 * `provider` and `status` are always written explicitly, never relied on as
 * column defaults, so a new driver cannot silently masquerade as `mock`.
 * Uniqueness is enforced by the unique indexes in the schema; a duplicate
 * delivery is a normal outcome, not an error — but the stored row must belong
 * to the same purchase, otherwise the caller gets `CONFLICT` instead of
 * silently re-entitling one owner on another owner's key.
 */
export type PaymentInsertOutcome = 'inserted' | 'duplicate';

/** Identity of the stored purchase a replay collided with. */
export interface RecordedPayment {
  userId: string;
  organizationId: string | null;
  planKey: string;
}

export interface PaymentRecordResult {
  outcome: PaymentInsertOutcome;
  /** Present on a duplicate: the purchase that already owns the provider key. */
  existing: RecordedPayment | null;
}

interface PaymentHistoryBase {
  userId: string;
  organizationId: string | null;
  planKey: string;
  planName: string;
  /** Minor units: the catalog price for mock, `invoice.amount_paid` for Stripe. */
  amount: number;
  currency: string;
  /** Defaults to `now()` in the database when omitted. */
  paidAt?: string;
}

export type PaymentHistoryInput =
  | (PaymentHistoryBase & {
      provider: Extract<PaymentDriver, 'mock'>;
      sessionId: string;
    })
  | (PaymentHistoryBase & {
      provider: Extract<PaymentDriver, 'stripe'>;
      stripeInvoiceId: string;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
      stripeCheckoutSessionId: string | null;
      hostedInvoiceUrl: string | null;
      invoicePdfUrl: string | null;
    });

export interface PaymentHistoryWriter {
  record(input: PaymentHistoryInput): Promise<ServiceResult<PaymentRecordResult>>;
}

const RECORDED_PAYMENT_COLUMNS = 'user_id, organization_id, plan_key';

export class SupabasePaymentHistoryWriter implements PaymentHistoryWriter {
  constructor(
    private readonly createAdminClient: () => SupabaseClient<Database> = createServiceClient,
  ) {}

  async record(input: PaymentHistoryInput): Promise<ServiceResult<PaymentRecordResult>> {
    const supabase = this.createAdminClient();

    const common = {
      user_id: input.userId,
      organization_id: input.organizationId,
      plan_key: input.planKey,
      plan_name: input.planName,
      amount: input.amount,
      currency: input.currency,
      provider: input.provider,
      status: 'paid' as const,
      ...(input.paidAt ? { paid_at: input.paidAt } : {}),
    };

    const { data, error } =
      input.provider === 'mock'
        ? await supabase
            .from('payments')
            .insert({ ...common, session_id: input.sessionId })
            .select('id')
            .maybeSingle()
        : await supabase
            .from('payments')
            .insert({
              ...common,
              session_id: null,
              stripe_customer_id: input.stripeCustomerId,
              stripe_subscription_id: input.stripeSubscriptionId,
              stripe_invoice_id: input.stripeInvoiceId,
              stripe_checkout_session_id: input.stripeCheckoutSessionId,
              hosted_invoice_url: input.hostedInvoiceUrl,
              invoice_pdf_url: input.invoicePdfUrl,
            })
            .select('id')
            .maybeSingle();

    if (!error && data) return success({ outcome: 'inserted', existing: null });
    if (error?.code !== '23505') {
      if (error) return toDbFailure(error);
      return failure('INTERNAL_SERVER');
    }

    // The provider key already owns a row: return its identity so the caller
    // can reject a replay that tries to turn one purchase into another.
    const existing = await this.findRecordedByProviderKey(input);
    if (!existing) {
      // A unique violation that does not resolve to this provider's key is a
      // real integrity problem (e.g. the other provider's key), not a replay.
      return failure('CONFLICT');
    }

    return success({ outcome: 'duplicate', existing });
  }

  private async findRecordedByProviderKey(
    input: PaymentHistoryInput,
  ): Promise<RecordedPayment | null> {
    const supabase = this.createAdminClient();

    if (input.provider === 'mock') {
      const { data } = await supabase
        .from('payments')
        .select(RECORDED_PAYMENT_COLUMNS)
        .eq('session_id', input.sessionId)
        .maybeSingle();
      return data ? toRecordedPayment(data) : null;
    }

    // `stripe_checkout_session_id` is unique too (first invoice only); a retry
    // may collide on either index depending on which row won.
    if (input.stripeCheckoutSessionId) {
      const { data } = await supabase
        .from('payments')
        .select(RECORDED_PAYMENT_COLUMNS)
        .eq('stripe_checkout_session_id', input.stripeCheckoutSessionId)
        .maybeSingle();
      if (data) return toRecordedPayment(data);
    }

    const { data } = await supabase
      .from('payments')
      .select(RECORDED_PAYMENT_COLUMNS)
      .eq('stripe_invoice_id', input.stripeInvoiceId)
      .maybeSingle();
    return data ? toRecordedPayment(data) : null;
  }
}

function toRecordedPayment(row: {
  user_id: string;
  organization_id: string | null;
  plan_key: string;
}): RecordedPayment {
  return {
    userId: row.user_id,
    organizationId: row.organization_id,
    planKey: row.plan_key,
  };
}

export const paymentHistoryWriter = new SupabasePaymentHistoryWriter();
