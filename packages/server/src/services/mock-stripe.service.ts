import type { AccountType } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import {
  resolveApplicablePlan,
  resolveCheckoutOwner,
} from '@studiq/server/lib/payment/checkout-rules';
import {
  type PaymentHistoryWriter,
  paymentHistoryWriter,
} from '@studiq/server/lib/payment/payment-history.repository';
import type { StripeBillingRepository } from '@studiq/server/lib/payment/stripe-repository';
import { stripeBillingRepository } from '@studiq/server/lib/payment/stripe-repository';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import {
  type EntitlementService,
  entitlementService,
} from '@studiq/server/services/entitlement.service';

/**
 * The (mock) Stripe event fields the service may trust. The caller identity is
 * deliberately absent: it comes from the authenticated RequestContext
 * (`ctx.userId`), never from the request body.
 */
export type MockWebhookEvent = {
  type: string;
  session_id: string;
  plan_id: string;
  org_id?: string;
};

type MockCheckoutRules = Pick<StripeBillingRepository, 'getPlan' | 'isOrgAdmin'>;
type MockEntitlements = Pick<EntitlementService, 'applyPlan'>;

/**
 * Completion half of the simulated provider (workstream A).
 *
 * The mock checkout page posts one authenticated command per purchase (and the
 * QA fixtures use the same command to simulate a lifecycle change). This
 * service applies exactly the same downstream domain behaviour as the Stripe
 * webhook path:
 *
 * 1. plan/owner rules come from the shared `checkout-rules` validator, so the
 *    mock cannot accept a plan or an org the real path would refuse;
 * 2. the entitlement is written only by `EntitlementService`, never here;
 * 3. a **paid** plan writes the purchase history row through the shared
 *    provider-neutral writer (`provider='mock'`, `session_id` uniqueness). A
 *    free plan is a lifecycle change (like Stripe's `customer.subscription.deleted`)
 *    and writes no history row.
 *
 * Replay is record-first: a session id that already owns a different purchase
 * is rejected with `CONFLICT` before any entitlement is written, so a forged or
 * stale `session_id` cannot re-entitle another owner or another plan. A replay
 * of the *same* purchase is a no-op that also re-applies the absolute
 * entitlement, which self-heals a crash between the two writes.
 *
 * There is deliberately no `stripe_webhook_events` row: the mock webhook is a
 * single authenticated command, not a provider retry stream.
 */
export class MockStripeService {
  constructor(
    private readonly rules: MockCheckoutRules = stripeBillingRepository,
    private readonly entitlements: MockEntitlements = entitlementService,
    private readonly payments: PaymentHistoryWriter = paymentHistoryWriter,
  ) {}

  async handleWebhook(
    event: MockWebhookEvent,
    accountType: AccountType,
    // The authenticated caller (ctx.userId), never the request body.
    userId: string,
  ): Promise<ServiceResult<void>> {
    if (event.type !== 'checkout.session.completed') return success(undefined);

    const applicable = await resolveApplicablePlan(this.rules, event.plan_id, accountType);
    if (isFailure(applicable)) return applicable;

    const owner = await resolveCheckoutOwner(
      this.rules,
      applicable.data,
      { userId, accountType },
      event.org_id,
    );
    if (isFailure(owner)) return owner;

    const organizationId = owner.data.type === 'org' ? owner.data.orgId : null;
    const plan = applicable.data.plan;

    if (plan.priceMonthly > 0) {
      // Append-only purchase log for "Historia płatności" (#392), through the
      // same writer the Stripe `invoice.paid` handler uses.
      const payment = await this.payments.record({
        provider: 'mock',
        userId,
        organizationId,
        planKey: plan.key,
        planName: plan.name,
        amount: plan.priceMonthly,
        currency: plan.currency,
        sessionId: event.session_id,
      });
      if (isFailure(payment)) return payment;

      // `duplicate` only proves the key exists, not that it is this purchase.
      // Refuse before the entitlement write so a stolen/stale session id cannot
      // re-entitle a different owner or plan.
      if (payment.data.outcome === 'duplicate') {
        const existing = payment.data.existing;
        const samePurchase =
          existing?.userId === userId &&
          existing.organizationId === organizationId &&
          existing.planKey === plan.key;
        if (!samePurchase) {
          return failure('CONFLICT');
        }
      }
    }

    // The only entitlement writer (#662 §6.6). Absolute writes make a genuine
    // replay harmless; an org purchase never touches the buyer's personal plan.
    const entitlement = await this.entitlements.applyPlan(
      owner.data.type === 'org'
        ? { type: 'org', orgId: owner.data.orgId }
        : { type: 'user', userId: owner.data.userId },
      plan.key,
    );
    if (isFailure(entitlement)) return entitlement;

    return success(undefined);
  }
}
export const mockStripeService = wrapService(new MockStripeService(), 'mock-stripe.service');
