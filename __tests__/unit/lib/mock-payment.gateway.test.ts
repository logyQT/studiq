import { AccountType, type RequestContext } from '@studiq/authz';
import {
  MockPaymentGateway,
  type MockStripePort,
} from '@studiq/server/lib/payment/mock-payment.gateway';
import { success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createPort(): MockStripePort {
  return {
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    handleWebhook: vi.fn(),
  } as unknown as MockStripePort;
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
  });

  it('delegates checkout with the authenticated actor and target org', async () => {
    const result = { url: '/checkout?plan_id=hub&org_id=org-1', sessionId: 's-1' };
    vi.mocked(port.createCheckoutSession).mockResolvedValueOnce(success(result));

    await expect(
      gateway.createCheckoutSession({
        userId: 'u-1',
        accountType: AccountType.MANAGER,
        planKey: 'hub',
        orgId: 'org-1',
        idempotencyKey: 'checkout-key',
      }),
    ).resolves.toEqual(success(result));

    expect(port.createCheckoutSession).toHaveBeenCalledWith(
      'hub',
      AccountType.MANAGER,
      'u-1',
      'org-1',
    );
  });

  it('passes no org for a personal plan', async () => {
    vi.mocked(port.createCheckoutSession).mockResolvedValueOnce(
      success({ url: '/checkout?plan_id=spark', sessionId: 's-1' }),
    );

    await gateway.createCheckoutSession({
      userId: 'u-1',
      accountType: AccountType.STUDENT,
      planKey: 'spark',
      idempotencyKey: 'checkout-key',
    });

    expect(port.createCheckoutSession).toHaveBeenCalledWith(
      'spark',
      AccountType.STUDENT,
      'u-1',
      undefined,
    );
  });

  it('delegates the portal session for the authenticated user', async () => {
    vi.mocked(port.createPortalSession).mockResolvedValueOnce(
      success({ url: 'http://localhost:3000/app/billing' }),
    );

    const result = await gateway.createPortalSession({
      userId: 'u-1',
      accountType: AccountType.STUDENT,
      activeOrgId: null,
    });

    expect(result).toEqual(success({ url: 'http://localhost:3000/app/billing' }));
    expect(port.createPortalSession).toHaveBeenCalledWith('u-1');
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

  it('reports NOT_FOUND for change plan and cancel (the mock has no subscription)', async () => {
    await expect(
      gateway.changePlan({
        userId: 'u-1',
        accountType: AccountType.STUDENT,
        targetPlanKey: 'ace',
        idempotencyKey: 'change-key',
      }),
    ).resolves.toEqual({ success: false, error: 'NOT_FOUND' });

    await expect(
      gateway.cancelAtPeriodEnd({
        userId: 'u-1',
        accountType: AccountType.STUDENT,
        cancel: true,
      }),
    ).resolves.toEqual({ success: false, error: 'NOT_FOUND' });
  });
});
