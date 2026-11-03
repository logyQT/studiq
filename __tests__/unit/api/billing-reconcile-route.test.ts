import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function reconcileRequest(body: unknown) {
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
    vi.mocked(withAuth).mockImplementation((_req, handler) => handler(ctx));
  });

  it('requires an authenticated context through withAuth', async () => {
    reconcileCheckout.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { activated: true },
    });

    const response = await POST(reconcileRequest({ sessionId: 'cs_1' }));

    expect(response.status).toBe(200);
    expect(withAuthMock).toHaveBeenCalledTimes(1);
    expect(reconcileCheckout).toHaveBeenCalledWith(ctx, { sessionId: 'cs_1' });
  });

  it('maps a controller failure to its HTTP status', async () => {
    reconcileCheckout.mockResolvedValue({
      success: false,
      statusCode: 403,
      error: 'FORBIDDEN',
    });

    const response = await POST(reconcileRequest({ sessionId: 'cs_1' }));

    expect(response.status).toBe(403);
  });
});
