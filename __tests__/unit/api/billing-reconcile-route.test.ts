import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileCheckout, withAuthMock, rateLimitCheck } = vi.hoisted(() => ({
  reconcileCheckout: vi.fn(),
  withAuthMock: vi.fn(),
  rateLimitCheck: vi.fn(),
}));

vi.mock('@studiq/server/controllers/billing.controller', () => ({
  billingController: { reconcileCheckout },
}));

vi.mock('@studiq/server/lib/with-auth', () => ({ withAuth: withAuthMock }));

vi.mock('@studiq/server/lib/rate-limiter', () => ({
  createRateLimiter: () => ({ check: rateLimitCheck }),
}));

import { withAuth } from '@studiq/server/lib/with-auth';
import { POST } from '@/app/(backend)/api/v1/billing/reconcile/route';

function reconcileRequest(body: unknown = { sessionId: 'cs_1' }) {
  return new NextRequest('http://localhost/api/v1/billing/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

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

describe('POST /api/v1/billing/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCheck.mockReturnValue({ allowed: true });
    vi.mocked(withAuth).mockImplementation((_req, handler) => handler(ctx));
    reconcileCheckout.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { activated: false },
    });
  });

  it('requires an authenticated context through withAuth', async () => {
    const response = await POST(reconcileRequest());

    expect(response.status).toBe(200);
    expect(withAuthMock).toHaveBeenCalledTimes(1);
    expect(reconcileCheckout).toHaveBeenCalledWith(ctx, { sessionId: 'cs_1' });
  });

  it('keys the bucket by the authenticated user', async () => {
    await POST(reconcileRequest());

    expect(rateLimitCheck).toHaveBeenCalledWith('u-1');
  });

  it('returns a RATE_LIMITED body and Retry-After when the bucket is full', async () => {
    rateLimitCheck.mockReturnValue({ allowed: false, retryAfterMs: 5_000 });

    const response = await POST(reconcileRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ success: false, error: 'RATE_LIMITED' });
    expect(response.headers.get('x-error-code')).toBe('RATE_LIMITED');
    expect(response.headers.get('retry-after')).toBe('5');
    expect(reconcileCheckout).not.toHaveBeenCalled();
  });

  it('rounds the retry hint up to whole seconds and omits it when absent', async () => {
    rateLimitCheck.mockReturnValue({ allowed: false, retryAfterMs: 1_499 });
    expect((await POST(reconcileRequest())).headers.get('retry-after')).toBe('2');

    rateLimitCheck.mockReturnValue({ allowed: false });
    const response = await POST(reconcileRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeNull();
  });

  it('never reads the body when the request is throttled', async () => {
    rateLimitCheck.mockReturnValue({ allowed: false, retryAfterMs: 1_000 });
    const request = new NextRequest('http://localhost/api/v1/billing/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(reconcileCheckout).not.toHaveBeenCalled();
  });

  it('does not spend another user’s budget', async () => {
    rateLimitCheck.mockImplementation((userId: string) =>
      userId === 'u-1' ? { allowed: false, retryAfterMs: 1_000 } : { allowed: true },
    );

    expect((await POST(reconcileRequest())).status).toBe(429);

    vi.mocked(withAuth).mockImplementation((_req, handler) => handler({ ...ctx, userId: 'u-2' }));
    expect((await POST(reconcileRequest())).status).toBe(200);
    expect(reconcileCheckout).toHaveBeenCalledTimes(1);
  });

  it('maps a controller failure to its HTTP status', async () => {
    reconcileCheckout.mockResolvedValue({
      success: false,
      statusCode: 403,
      error: 'FORBIDDEN',
    });

    const response = await POST(reconcileRequest());

    expect(response.status).toBe(403);
  });
});
