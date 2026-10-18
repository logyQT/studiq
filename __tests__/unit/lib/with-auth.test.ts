import { AccountType } from '@studiq/authz';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { TRACE_ID_HEADER, withAuth } from '@studiq/server/lib/with-auth';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function request() {
  return new NextRequest('http://localhost/api/v1/example', { method: 'GET' });
}

describe('withAuth — trace id correlation', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  it('returns 401 and still sets x-trace-id when unauthenticated', async () => {
    mock.auth.getUser.mockResolvedValue({ data: { user: null } });
    const handler = vi.fn();

    const res = await withAuth(request(), handler);

    expect(res.status).toBe(401);
    expect(res.headers.get(TRACE_ID_HEADER)).toBeTruthy();
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns the same trace id it exposed on the RequestContext', async () => {
    mock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { account_type: AccountType.STUDENT } } },
    });
    let seenTraceId: string | undefined;

    const res = await withAuth(request(), async (ctx) => {
      seenTraceId = ctx.traceId;
      return toNextResponse({ success: true, statusCode: 200, data: { ok: true } });
    });

    expect(res.status).toBe(200);
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(seenTraceId);
  });

  it('sets x-trace-id on the error path too', async () => {
    mock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { account_type: AccountType.STUDENT } } },
    });

    const res = await withAuth(request(), async () => {
      throw new Error('boom');
    });

    expect(res.status).toBe(500);
    expect(res.headers.get(TRACE_ID_HEADER)).toBeTruthy();
  });
});
