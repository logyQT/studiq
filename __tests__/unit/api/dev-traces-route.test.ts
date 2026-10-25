import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getByFiltersMock = vi.fn();
const getStatusMock = vi.fn();

vi.mock('@studiq/server/services/agent-trace.service', () => ({
  agentTraceService: {
    getByFilters: (...args: unknown[]) => getByFiltersMock(...args),
    getStatus: () => getStatusMock(),
  },
}));

let withAuthCalls = 0;

vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (_req: unknown, handler: (ctx: unknown) => Promise<Response>) => {
    withAuthCalls++;
    return handler({ userId: 'u-1', accountType: 'student' });
  },
}));

import { GET } from '@/app/(backend)/api/v1/dev/traces/route';

/**
 * #189: the NODE_ENV gate answers 403 in production, but in development the
 * route used to be open to anonymous callers (the proxy skips /api/*). It now
 * requires a session.
 */
describe('GET /api/v1/dev/traces (#189)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withAuthCalls = 0;
    getByFiltersMock.mockReturnValue({ events: [], total: 0 });
    getStatusMock.mockReturnValue('ok');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 403 outside development without ever calling withAuth', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const res = await GET(new Request('http://localhost/api/v1/dev/traces') as never);

    expect(res.status).toBe(403);
    expect(withAuthCalls).toBe(0);
    expect(getByFiltersMock).not.toHaveBeenCalled();
  });

  it('requires a session in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const res = await GET(new Request('http://localhost/api/v1/dev/traces') as never);
    const body = await res.json();

    expect(withAuthCalls).toBe(1);
    expect(res.status).toBe(200);
    expect(body.total).toBe(0);
  });
});
