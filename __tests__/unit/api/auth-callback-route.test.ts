import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('@studiq/server/lib/log', () => ({ log: vi.fn(), warn, error: vi.fn() }));

const { claimInvitation } = vi.hoisted(() => ({ claimInvitation: vi.fn() }));

vi.mock('@studiq/server/services/auth.service', () => ({
  authService: { claimInvitation },
}));

import { GET } from '@/app/(backend)/api/v1/auth/callback/route';

function callback(query: string) {
  return new NextRequest(`http://localhost/api/v1/auth/callback${query}`);
}

// #301: /auth/callback reports failures as a 3xx redirect, so the shared
// 4xx/5xx logger never fires. Failures are logged explicitly (code/status only,
// never the token) and every response carries a trace id.
describe('GET /api/v1/auth/callback (#301)', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  it('logs a failed verification without leaking the token and still redirects', async () => {
    mock.auth.verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: 'otp_expired', status: 403 },
    });

    const res = await GET(callback('?token_hash=SUPERSECRET&type=signup'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login?error=ERROR_INTERNAL_SERVER');
    expect(res.headers.get('x-trace-id')).toMatch(/^[0-9a-f]{32}$/);
    expect(warn).toHaveBeenCalledWith(
      'Auth callback verification failed',
      expect.objectContaining({ 'error.code': 'otp_expired', 'error.status': 403 }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SUPERSECRET');
  });

  it('logs when neither token_hash nor code is present', async () => {
    const res = await GET(callback(''));

    expect(res.status).toBe(307);
    expect(res.headers.get('x-trace-id')).toMatch(/^[0-9a-f]{32}$/);
    expect(warn).toHaveBeenCalledWith('Auth callback called without token_hash or code');
    expect(mock.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('keeps the activation redirect and does not warn on success', async () => {
    claimInvitation.mockResolvedValue(null);
    mock.auth.verifyOtp.mockResolvedValue({
      data: { user: { id: 'u1', user_metadata: {} }, session: null },
      error: null,
    });

    const res = await GET(callback('?token_hash=fake&type=signup&next=/app'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/app');
    expect(res.headers.get('x-trace-id')).toMatch(/^[0-9a-f]{32}$/);
    expect(warn).not.toHaveBeenCalled();
  });
});
