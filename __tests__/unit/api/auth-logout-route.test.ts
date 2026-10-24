import { describe, expect, it, vi } from 'vitest';

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
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('HttpOnly');
    expect(await res.json()).toEqual({
      success: true,
      data: { message: 'SUCCESS_LOGOUT' },
    });
  });

  it('still clears the cookie when signOut fails', async () => {
    logout.mockResolvedValueOnce({
      success: false,
      statusCode: 500,
      error: 'INTERNAL_SERVER',
    });

    const res = await POST();

    expect(res.status).toBe(500);
    expect(res.headers.get('set-cookie')).toContain('active_org_id=;');
  });
});
