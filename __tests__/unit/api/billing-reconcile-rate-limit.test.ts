import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileCheckout, withAuthMock } = vi.hoisted(() => ({
  reconcileCheckout: vi.fn(),
  withAuthMock: vi.fn(),
}));

vi.mock('@studiq/server/controllers/billing.controller', () => ({
  billingController: { reconcileCheckout },
}));

vi.mock('@studiq/server/lib/with-auth', () => ({ withAuth: withAuthMock }));

import { withAuth } from '@studiq/server/lib/with-auth';
import { POST } from '@/app/(backend)/api/v1/billing/reconcile/route';

/**
 * Boundary test against the **real** module-level limiter (the route test mocks
 * it to exercise the branches). This file gets its own module graph, so the
 * bucket starts empty and the 60 s window can be rolled with fake time.
 */
const ctx = {
  traceId: 'trace',
  userId: 'rate-limit-boundary-user',
  accountType: 'student' as const,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

function request() {
  return new NextRequest('http://localhost/api/v1/billing/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'cs_1' }),
  });
}

describe('POST /api/v1/billing/reconcile rate limit', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));
    vi.mocked(withAuth).mockImplementation((_req, handler) => handler(ctx));
    reconcileCheckout.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { activated: false },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows 20 calls, blocks the 21st for the rest of the window, then resets', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await POST(request())).status).toBe(200);
    }

    const blocked = await POST(request());

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(reconcileCheckout).toHaveBeenCalledTimes(20);

    vi.setSystemTime(new Date('2026-11-03T12:01:01.000Z'));

    expect((await POST(request())).status).toBe(200);
    expect(reconcileCheckout).toHaveBeenCalledTimes(21);
  });
});
