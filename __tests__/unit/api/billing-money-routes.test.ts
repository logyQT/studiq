import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCheckoutSession, changePlan, cancelSubscription, withAuthMock, rateLimitCheck } =
  vi.hoisted(() => ({
    createCheckoutSession: vi.fn(),
    changePlan: vi.fn(),
    cancelSubscription: vi.fn(),
    withAuthMock: vi.fn(),
    rateLimitCheck: vi.fn(),
  }));

vi.mock('@studiq/server/controllers/stripe.controller', () => ({
  stripeController: { createCheckoutSession },
}));

vi.mock('@studiq/server/controllers/billing.controller', () => ({
  billingController: { changePlan, cancelSubscription },
}));

vi.mock('@studiq/server/lib/with-auth', () => ({ withAuth: withAuthMock }));

vi.mock('@studiq/server/lib/rate-limiter', () => ({
  createRateLimiter: () => ({ check: rateLimitCheck }),
}));

import { withAuth } from '@studiq/server/lib/with-auth';
import { POST as cancelRoute } from '@/app/(backend)/api/v1/billing/cancel/route';
import { POST as changePlanRoute } from '@/app/(backend)/api/v1/billing/change-plan/route';
import { POST as checkoutRoute } from '@/app/(backend)/api/v1/stripe/create-checkout-session/route';

const ctx = {
  traceId: 'trace',
  userId: 'u-1',
  accountType: 'student' as const,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

function request(path: string, body: unknown = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ok = { success: true, statusCode: 200, data: {} };

describe('money-action route rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCheck.mockReturnValue({ allowed: true });
    vi.mocked(withAuth).mockImplementation((_req, handler) => handler(ctx));
    createCheckoutSession.mockResolvedValue(ok);
    changePlan.mockResolvedValue(ok);
    cancelSubscription.mockResolvedValue(ok);
  });

  it.each([
    [
      'create-checkout-session',
      checkoutRoute,
      createCheckoutSession,
      '/api/v1/stripe/create-checkout-session',
    ],
    ['change-plan', changePlanRoute, changePlan, '/api/v1/billing/change-plan'],
    ['cancel', cancelRoute, cancelSubscription, '/api/v1/billing/cancel'],
  ])(
    '%s checks the per-user limiter before parsing the body',
    async (_label, route, handler, path) => {
      rateLimitCheck.mockReturnValueOnce({ allowed: false, retryAfterMs: 2_000 });

      // Invalid JSON: a controller/parse-first route would throw a 400/500,
      // while the guard must return 429 without touching either.
      const response = await route(
        new NextRequest(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        }),
      );

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('2');
      expect(rateLimitCheck).toHaveBeenCalledWith(ctx.userId);
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      checkoutRoute,
      createCheckoutSession,
      '/api/v1/stripe/create-checkout-session',
      { planKey: 'spark' },
    ],
    [changePlanRoute, changePlan, '/api/v1/billing/change-plan', { planKey: 'ace' }],
    [cancelRoute, cancelSubscription, '/api/v1/billing/cancel', { cancel: true }],
  ])('forwards an allowed request to its controller', async (route, handler, path, body) => {
    const response = await route(request(path, body));

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(ctx, body);
  });
});
