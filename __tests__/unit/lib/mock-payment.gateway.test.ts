import { AccountType, type RequestContext } from '@studiq/authz';
import {
  MockPaymentGateway,
  type MockStripePort,
} from '@studiq/server/lib/payment/mock-payment.gateway';
import { success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createPort(): MockStripePort {
  return {
    handleWebhook: vi.fn(),
  };
}

const ctx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.STUDENT,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

describe('MockPaymentGateway', () => {
  let port: MockStripePort;
  let gateway: MockPaymentGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    port = createPort();
    gateway = new MockPaymentGateway(port);
  });

  it('reports the mock driver', () => {
    expect(gateway.driver).toBe('mock');
    expect(gateway.livemode).toBe(false);
  });

  it('builds a local checkout URL for a personal plan', async () => {
    const result = await gateway.createCheckoutSession({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      planKey: 'spark',
      planName: 'StudiQ Spark',
      amount: 999,
      currency: 'PLN',
      billingCycle: 'monthly',
      idempotencyKey: 'checkout-key',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const url = new URL(result.data.url);
    expect(url.pathname).toBe('/checkout');
    expect(url.searchParams.get('plan_id')).toBe('spark');
    expect(url.searchParams.get('session_id')).toBe(result.data.sessionId);
    expect(url.searchParams.get('org_id')).toBeNull();
    // The provider-only adapter performs no domain validation or DB write.
    expect(port.handleWebhook).not.toHaveBeenCalled();
  });

  it('carries the organization id for an org plan', async () => {
    const result = await gateway.createCheckoutSession({
      owner: {
        type: 'org',
        orgId: 'org-1',
        userId: 'u-1',
        accountType: AccountType.MANAGER,
      },
      planKey: 'hub',
      planName: 'StudiQ Hub',
      amount: 29900,
      currency: 'PLN',
      billingCycle: 'monthly',
      idempotencyKey: 'checkout-key',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const url = new URL(result.data.url);
    expect(url.searchParams.get('plan_id')).toBe('hub');
    expect(url.searchParams.get('org_id')).toBe('org-1');
  });

  it('returns the account-type-aware local page as the mock portal', async () => {
    const result = await gateway.createPortalSession({
      owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
      returnUrl: 'http://localhost:3000/app/billing',
      locale: 'pl',
    });

    expect(result).toEqual(success({ url: 'http://localhost:3000/app/billing' }));
  });

  it('maps a mock webhook envelope onto the authenticated service call', async () => {
    const event = {
      type: 'checkout.session.completed',
      session_id: 's-1',
      plan_id: 'spark',
    };
    vi.mocked(port.handleWebhook).mockResolvedValueOnce(success(undefined));

    const result = await gateway.handleWebhook({ kind: 'mock', ctx, event });

    expect(result).toEqual(success({ received: true }));
    expect(port.handleWebhook).toHaveBeenCalledWith(event, AccountType.STUDENT, 'u-1');
  });

  it('refuses a Stripe envelope without touching the mock service', async () => {
    const result = await gateway.handleWebhook({
      kind: 'stripe',
      rawBody: '{}',
      signature: 't=1,v1=abc',
    });

    expect(result).toEqual({ success: false, error: 'BAD_REQUEST' });
    expect(port.handleWebhook).not.toHaveBeenCalled();
  });

  it('reports NOT_FOUND for reconcile (the mock has no Checkout Session)', async () => {
    await expect(
      gateway.reconcileCheckout({
        owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
        sessionId: 'cs_1',
      }),
    ).resolves.toEqual({ success: false, error: 'NOT_FOUND' });
  });

  it('reports NOT_FOUND for change plan and cancel (the mock has no subscription)', async () => {
    await expect(
      gateway.changePlan({
        owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        currentPlanKey: 'spark',
        targetPlanKey: 'ace',
        targetPriceId: 'price_ace',
        direction: 'upgrade',
        idempotencyKey: 'change-key',
      }),
    ).resolves.toEqual({ success: false, error: 'NOT_FOUND' });

    await expect(
      gateway.cancelAtPeriodEnd({
        owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        cancel: true,
      }),
    ).resolves.toEqual({ success: false, error: 'NOT_FOUND' });

    await expect(
      gateway.releaseScheduledPlan({
        owner: { type: 'user', userId: 'u-1', accountType: AccountType.STUDENT },
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
        currentPlanKey: 'spark',
      }),
    ).resolves.toEqual({ success: false, error: 'NOT_FOUND' });
  });
});
