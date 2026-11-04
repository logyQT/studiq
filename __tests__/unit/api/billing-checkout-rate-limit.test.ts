import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createCheckoutSession, withAuthMock } = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  withAuthMock: vi.fn(),
}));

vi.mock('@studiq/server/controllers/stripe.controller', () => ({
  stripeController: { createCheckoutSession },
}));

vi.mock('@studiq/server/lib/with-auth', () => ({ withAuth: withAuthMock }));

import { withAuth } from '@studiq/server/lib/with-auth';
import { POST } from '@/app/(backend)/api/v1/stripe/create-checkout-session/route';

const ctx = {
  traceId: 'trace',
  userId: 'checkout-rate-limit-user',
  accountType: 'student' as const,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

function request() {
  return new NextRequest('http://localhost/api/v1/stripe/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planKey: 'spark' }),
  });
}

describe('POST /api/v1/stripe/create-checkout-session rate limit', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T12:00:00.000Z'));
    vi.mocked(withAuth).mockImplementation((_req, handler) => handler(ctx));
    createCheckoutSession.mockResolvedValue({ success: true, statusCode: 200, data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows 10 calls, blocks the 11th, then resets after the window', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await POST(request())).status).toBe(200);
    }

    const blocked = await POST(request());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(createCheckoutSession).toHaveBeenCalledTimes(10);

    vi.setSystemTime(new Date('2026-11-04T12:01:01.000Z'));

    expect((await POST(request())).status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledTimes(11);
  });
});
