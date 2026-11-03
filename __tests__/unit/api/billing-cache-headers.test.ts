import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listMine, getSubscription, withAuthMock } = vi.hoisted(() => ({
  listMine: vi.fn(),
  getSubscription: vi.fn(),
  withAuthMock: vi.fn(),
}));

vi.mock('@studiq/server/controllers/payment.controller', () => ({
  paymentController: { listMine },
}));

vi.mock('@studiq/server/controllers/billing.controller', () => ({
  billingController: { getSubscription },
}));

vi.mock('@studiq/server/lib/with-auth', () => ({ withAuth: withAuthMock }));

import { withAuth } from '@studiq/server/lib/with-auth';
import { GET as getBillingSubscription } from '@/app/(backend)/api/v1/billing/subscription/route';
import { GET as getPaymentHistory } from '@/app/(backend)/api/v1/me/payments/route';

const ctx = {
  traceId: 'trace',
  userId: 'u-1',
  accountType: 'student' as const,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

function request(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' });
}

describe('sensitive billing responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(withAuth).mockImplementation((_req, handler) => handler(ctx));
  });

  it('marks the payment history response private and uncacheable', async () => {
    listMine.mockResolvedValue({ success: true, statusCode: 200, data: [] });

    const response = await getPaymentHistory(request('/api/v1/me/payments'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('marks the billing read model private and uncacheable', async () => {
    getSubscription.mockResolvedValue({ success: true, statusCode: 200, data: {} });

    const response = await getBillingSubscription(request('/api/v1/billing/subscription'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
