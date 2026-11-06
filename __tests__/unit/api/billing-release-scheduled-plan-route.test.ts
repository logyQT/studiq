import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { releaseScheduledPlan, withAuthMock, rateLimitCheck } = vi.hoisted(() => ({
  releaseScheduledPlan: vi.fn(),
  withAuthMock: vi.fn(),
  rateLimitCheck: vi.fn(),
}));

vi.mock('@studiq/server/controllers/billing.controller', () => ({
  billingController: { releaseScheduledPlan },
}));

vi.mock('@studiq/server/lib/with-auth', () => ({ withAuth: withAuthMock }));

vi.mock('@studiq/server/lib/rate-limiter', () => ({
  createRateLimiter: () => ({ check: rateLimitCheck }),
}));

import { withAuth } from '@studiq/server/lib/with-auth';
import { POST } from '@/app/(backend)/api/v1/billing/release-scheduled-plan/route';

function releaseRequest() {
  return new NextRequest('http://localhost/api/v1/billing/release-scheduled-plan', {
    method: 'POST',
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

describe('POST /api/v1/billing/release-scheduled-plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCheck.mockReturnValue({ allowed: true });
    vi.mocked(withAuth).mockImplementation((_req, handler) => handler(ctx));
  });

  it('requires an authenticated context through withAuth', async () => {
    releaseScheduledPlan.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { released: true },
    });

    const response = await POST(releaseRequest());

    expect(response.status).toBe(200);
    expect(withAuthMock).toHaveBeenCalledTimes(1);
    // The route never reads or forwards a body: owner/customer/subscription
    // come from the authenticated context and the mirror.
    expect(releaseScheduledPlan).toHaveBeenCalledWith(ctx);
  });

  it('maps a controller failure to its HTTP status', async () => {
    releaseScheduledPlan.mockResolvedValue({
      success: false,
      statusCode: 403,
      error: 'FORBIDDEN',
    });

    const response = await POST(releaseRequest());

    expect(response.status).toBe(403);
  });

  it('returns 429 and skips the controller when the per-user bucket is full', async () => {
    rateLimitCheck.mockReturnValue({ allowed: false, retryAfterMs: 5_000 });

    const response = await POST(releaseRequest());

    expect(rateLimitCheck).toHaveBeenCalledWith('u-1');
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ success: false, error: 'RATE_LIMITED' });
    expect(response.headers.get('retry-after')).toBe('5');
    expect(releaseScheduledPlan).not.toHaveBeenCalled();
  });
});
