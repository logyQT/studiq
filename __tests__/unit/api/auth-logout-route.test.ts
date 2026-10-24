import { describe, expect, it, vi } from 'vitest';
import { NEXT_COOKIE_EPOCH, reSerializeThroughNext } from '#test/helpers/next-cookie-round-trip';

const { logout } = vi.hoisted(() => ({
  logout: vi.fn(
    async (): Promise<{
      success: boolean;
      statusCode: number;
      data?: unknown;
      error?: string;
    }> => ({
      success: true,
      statusCode: 200,
      data: { message: 'SUCCESS_LOGOUT' },
    }),
  ),
}));

vi.mock('@studiq/server/controllers/auth.controller', () => ({
  authController: { logout },
}));

import { POST } from '@/app/(backend)/api/v1/auth/logout/route';

describe('POST /api/v1/auth/logout (#186)', () => {
  it('deletes the active_org_id cookie and keeps the response body', async () => {
    const res = await POST();
    const header = res.headers.get('set-cookie');

    expect(res.status).toBe(200);
    expect(header).toContain('active_org_id=;');
    expect(header).toContain(NEXT_COOKIE_EPOCH);
    expect(header).not.toContain('Max-Age');
    expect(header).toContain('HttpOnly');
    expect(await res.json()).toEqual({
      success: true,
      data: { message: 'SUCCESS_LOGOUT' },
    });
  });

  it('keeps the deletion after Next re-serializes the Set-Cookie headers', async () => {
    // `supabase.auth.signOut()` mutates cookies() on this route, which makes Next
    // re-parse and re-serialize every Set-Cookie header. A `maxAge: 0` deletion is
    // dropped by that round-trip and leaves an empty session cookie behind.
    const res = await POST();
    const headers = reSerializeThroughNext(res);
    const header = headers.find((cookie) => cookie.startsWith('active_org_id'));

    expect(header).toBeDefined();
    expect(header).toContain(NEXT_COOKIE_EPOCH);
    expect(header).not.toContain('Max-Age');
  });

  it('still clears the cookie when signOut fails', async () => {
    logout.mockResolvedValueOnce({
      success: false,
      statusCode: 500,
      error: 'INTERNAL_SERVER',
    });

    const res = await POST();
    const headers = reSerializeThroughNext(res);
    const header = headers.find((cookie) => cookie.startsWith('active_org_id'));

    expect(res.status).toBe(500);
    expect(header).toBeDefined();
    expect(header).toContain(NEXT_COOKIE_EPOCH);
  });
});
