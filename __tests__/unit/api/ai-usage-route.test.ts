import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUsageMock = vi.fn();
vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: {
    getUsage: (...args: unknown[]) => getUsageMock(...args),
  },
}));

let mockCtx: Record<string, unknown>;
const withAuthOptions: unknown[] = [];
vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (
    _req: unknown,
    handler: (ctx: unknown) => Promise<Response>,
    options?: unknown,
  ) => {
    withAuthOptions.push(options);
    return handler(mockCtx);
  },
}));

import { GET } from '@/app/(backend)/api/v1/ai/usage/route';

function getRequest() {
  return new Request('http://localhost/api/v1/ai/usage', {
    method: 'GET',
  }) as unknown as Parameters<typeof GET>[0];
}

const usage = {
  current: 0,
  limit: 0,
  plan: 'base',
  resetsAt: '2026-10-26T00:00:00.000Z',
};

describe('GET /api/v1/ai/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withAuthOptions.length = 0;
    mockCtx = { userId: 'user-1', accountType: 'student', activeOrgId: 'org-1' };
    getUsageMock.mockResolvedValue(usage);
  });

  it('returns the caller’s usage position', async () => {
    const res = await GET(getRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: usage });
  });

  it('resolves the shared daily AI token limit key for the request context', async () => {
    await GET(getRequest());

    expect(getUsageMock).toHaveBeenCalledTimes(1);
    expect(getUsageMock).toHaveBeenCalledWith(mockCtx, 'max_ai_tokens_per_day');
  });

  it('is limited to students and educators, like the chat route', async () => {
    await GET(getRequest());

    expect(withAuthOptions).toEqual([{ allowedAccountTypes: ['student', 'educator'] }]);
  });
});
