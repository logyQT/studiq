import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '@admin/lib/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('admin api helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves the data payload on a successful response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: [{ id: '1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/organizations')).resolves.toEqual([{ id: '1' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/organizations', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    });
  });

  it('throws an ApiError carrying status and app error code for a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'NOT_FOUND' }, 404)),
    );

    const error = await apiGet('/organizations/missing').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'NOT_FOUND' });
  });

  it('surfaces the proxy 401 shape as an ApiError with status 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, error: 'ERROR_UNAUTHORIZED' }, 401)),
    );

    const error = await apiPost('/feature-flags', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'ERROR_UNAUTHORIZED', status: 401 });
  });

  it('keeps the status for a non-JSON 5xx response instead of throwing a SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })),
    );

    const error = await apiPut('/feature-flags/1', { name: 'x' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: 'PUT /api/v1/feature-flags/1 failed' });
  });

  it('uses the HTTP status even when the body says success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: null }, 409)),
    );

    const error = await apiDelete('/subscription-plans/1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409 });
  });
});
