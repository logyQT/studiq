import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleWebhook, handleStripeWebhook, withAuth, getPaymentGateway, gateway } = vi.hoisted(
  () => {
    const gateway = { driver: 'mock' as 'mock' | 'stripe' };
    return {
      handleWebhook: vi.fn(),
      handleStripeWebhook: vi.fn(),
      withAuth: vi.fn(),
      getPaymentGateway: vi.fn(() => gateway),
      gateway,
    };
  },
);

vi.mock('@studiq/server/controllers/stripe.controller', () => ({
  stripeController: { handleWebhook, handleStripeWebhook },
}));

vi.mock('@studiq/server/lib/payment/payment-gateway.factory', () => ({
  getPaymentGateway,
}));

vi.mock('@studiq/server/lib/with-auth', () => ({ withAuth }));

import { POST } from '@/app/(backend)/api/v1/stripe/webhook/route';

function webhookRequest(body: unknown, signature?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature) headers['stripe-signature'] = signature;
  return new NextRequest('http://localhost/api/v1/stripe/webhook', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/v1/stripe/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gateway.driver = 'mock';
    withAuth.mockImplementation(async (_req, handler) =>
      handler({
        traceId: 'trace',
        userId: 'u-1',
        accountType: 'student',
        orgRoleId: null,
        activeOrgId: null,
        url: '',
        method: 'POST',
        groupIds: [],
        permissionScopes: {},
      }),
    );
  });

  it('keeps the mock webhook authenticated and body-parsed', async () => {
    handleWebhook.mockResolvedValue({ success: true, statusCode: 200, data: { received: true } });

    const body = {
      type: 'checkout.session.completed',
      session_id: 's-1',
      plan_id: 'spark',
      user_id: 'u-1',
    };
    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(200);
    expect(withAuth).toHaveBeenCalledTimes(1);
    expect(handleWebhook).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1' }), body);
    expect(handleStripeWebhook).not.toHaveBeenCalled();
  });

  it('verifies the raw body of a public Stripe webhook without a session', async () => {
    gateway.driver = 'stripe';
    handleStripeWebhook.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { received: true },
    });

    const rawBody = '{"id":"evt_1","type":"invoice.paid"}';
    const response = await POST(webhookRequest(rawBody, 't=1,v1=abc'));

    expect(response.status).toBe(200);
    expect(withAuth).not.toHaveBeenCalled();
    // The raw string must reach the controller unchanged: JSON.parse/stringify
    // would invalidate the Stripe signature.
    expect(handleStripeWebhook).toHaveBeenCalledWith(rawBody, 't=1,v1=abc');
  });

  it('returns a retryable status without a session when Stripe verification fails', async () => {
    gateway.driver = 'stripe';
    handleStripeWebhook.mockResolvedValue({
      success: false,
      statusCode: 400,
      error: 'BAD_REQUEST',
    });

    const response = await POST(webhookRequest('{}'));

    expect(response.status).toBe(400);
    expect(withAuth).not.toHaveBeenCalled();
    expect(handleStripeWebhook).toHaveBeenCalledWith('{}', null);
  });
});
