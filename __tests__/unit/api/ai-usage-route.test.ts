import { beforeEach, describe, expect, it, vi } from 'vitest';

const myUsageMock = vi.fn();

vi.mock('@studiq/server/controllers/ai-usage.controller', () => ({
  aiUsageController: {
    myUsage: (...args: unknown[]) => myUsageMock(...args),
  },
}));

type WithAuthOptions = { allowedAccountTypes?: string[] };
let capturedOptions: WithAuthOptions | undefined;

vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (
    _req: unknown,
    handler: (ctx: unknown) => Promise<Response>,
    options?: WithAuthOptions,
  ) => {
    capturedOptions = options;
    return handler({ userId: 'u-1', accountType: 'student', activeOrgId: null });
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
    capturedOptions = undefined;
    myUsageMock.mockResolvedValue({ success: true, statusCode: 200, data: usage });
  });

  it('returns the usage envelope from the controller', async () => {
    const res = await GET(new Request('http://localhost/api/v1/ai/usage') as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: usage });
    expect(myUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', accountType: 'student' }),
    );
  });

  it('allows students and educators only (same audience as /api/v1/ai/chat)', async () => {
    await GET(new Request('http://localhost/api/v1/ai/usage') as never);

    expect(capturedOptions?.allowedAccountTypes).toEqual(['student', 'educator']);
  });
});
