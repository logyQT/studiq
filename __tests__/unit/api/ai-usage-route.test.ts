import { NextRequest } from 'next/server';
import { AppError } from '@studiq/server/lib/errors';
import { isRecord, readNumber, readString } from '@studiq/server/lib/record';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstRecorded } from '#test/mocks/recorded';

const myUsageMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@studiq/server/controllers/ai-usage.controller', () => ({
  aiUsageController: {
    myUsage: (...args: unknown[]) => myUsageMock(...args),
  },
}));

const requireEntitlementMock = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock('@studiq/server/lib/entitlements', () => ({
  requireEntitlement: (...args: unknown[]) => requireEntitlementMock(...args),
}));

let mockCtx: Record<string, unknown>;

vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (_req: unknown, handler: (ctx: unknown) => Promise<Response>) => {
    try {
      return await handler(mockCtx);
    } catch (error) {
      const record = isRecord(error) ? error : {};
      const status = readNumber(record, 'statusCode') ?? 500;
      const code = readString(record, 'code') ?? 'INTERNAL_SERVER';
      return new Response(JSON.stringify({ success: false, error: code }), { status });
    }
  },
}));

import { GET } from '@/app/(backend)/api/v1/ai/usage/route';

const usage = {
  current: 0,
  limit: 200000,
  plan: 'ace',
  resetsAt: '2026-10-26T00:00:00.000Z',
};

describe('GET /api/v1/ai/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = { userId: 'u-1', accountType: 'student', activeOrgId: null };
    requireEntitlementMock.mockResolvedValue(undefined);
    myUsageMock.mockResolvedValue({ success: true, statusCode: 200, data: usage });
  });

  it('requires the ai.chat entitlement before the controller runs', async () => {
    const res = await GET(new NextRequest('http://localhost/api/v1/ai/usage'));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: usage });
    expect(requireEntitlementMock).toHaveBeenCalledWith(mockCtx, 'ai.chat');
    expect(firstRecorded(requireEntitlementMock.mock.invocationCallOrder)).toBeLessThan(
      firstRecorded(myUsageMock.mock.invocationCallOrder),
    );
    expect(myUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', accountType: 'student' }),
    );
  });

  it('answers 403 without calling the controller when the entitlement is missing', async () => {
    requireEntitlementMock.mockRejectedValue(new AppError('FORBIDDEN'));

    const res = await GET(new NextRequest('http://localhost/api/v1/ai/usage'));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ success: false, error: 'FORBIDDEN' });
    expect(myUsageMock).not.toHaveBeenCalled();
  });
});
