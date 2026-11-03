import type {
  CancelAtPeriodEndInput,
  ChangePlanInput,
  ChangePlanResult,
  CreateCheckoutSessionInput,
  CreatePortalSessionInput,
  PaymentGateway,
  PaymentWebhookEnvelope,
  PortalSessionResult,
  WebhookOutcome,
} from '@studiq/server/lib/payment/payment-gateway';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import {
  type MockStripeService,
  mockStripeService,
} from '@studiq/server/services/mock-stripe.service';

/**
 * Minimal surface of the simulated provider used by the gateway. Keeping it
 * narrow lets tests pass a plain fake and stops the adapter from reaching into
 * the mock service's private rules.
 */
export type MockStripePort = Pick<MockStripeService, 'createCheckoutSession' | 'handleWebhook'>;

/**
 * The simulation adapter. Behaviour is intentionally identical to the old
 * controller → `MockStripeService` path: the fake checkout URL and the
 * authenticated webhook delegate to the same service.
 *
 * The Billing Portal is not simulated: `BillingService` builds the
 * account-type-aware local billing page and the adapter returns it unchanged.
 * Plan changes and cancellation only exist once a real provider owns a
 * subscription, so the mock reports `NOT_FOUND` rather than pretending.
 */
export class MockPaymentGateway implements PaymentGateway {
  readonly driver = 'mock' as const;
  readonly livemode = false;

  constructor(private readonly stripe: MockStripePort = mockStripeService) {}

  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<ServiceResult<{ url: string; sessionId: string }>> {
    const orgId = input.owner.type === 'org' ? input.owner.orgId : undefined;

    return this.stripe.createCheckoutSession(
      input.planKey,
      input.owner.accountType,
      input.owner.userId,
      orgId,
    );
  }

  createPortalSession(
    input: CreatePortalSessionInput,
  ): Promise<ServiceResult<PortalSessionResult>> {
    // There is no hosted portal in the simulation. `BillingService` already
    // built the account-type-aware page, so the mock "portal" is that page.
    return Promise.resolve(success({ url: input.returnUrl }));
  }

  changePlan(_input: ChangePlanInput): Promise<ServiceResult<ChangePlanResult>> {
    return Promise.resolve(failure('NOT_FOUND'));
  }

  cancelAtPeriodEnd(
    _input: CancelAtPeriodEndInput,
  ): Promise<ServiceResult<{ cancelAtPeriodEnd: boolean; releasedSchedule: boolean }>> {
    return Promise.resolve(failure('NOT_FOUND'));
  }

  async handleWebhook(envelope: PaymentWebhookEnvelope): Promise<ServiceResult<WebhookOutcome>> {
    if (envelope.kind !== 'mock') {
      // Only the mock driver is active in phase 1, and the route only builds
      // this envelope behind `withAuth`. A Stripe envelope here is a wiring bug.
      return failure('BAD_REQUEST');
    }

    const result = await this.stripe.handleWebhook(
      envelope.event,
      envelope.ctx.accountType,
      envelope.ctx.userId,
    );

    if (!result.success) return result;

    return success({ received: true });
  }
}

export const mockPaymentGateway = new MockPaymentGateway();
