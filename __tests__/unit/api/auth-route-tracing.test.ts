import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { register, login, requestPasswordReset } = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

vi.mock('@studiq/server/controllers/auth.controller', () => ({
  authController: { register, login, requestPasswordReset },
}));

import { POST as loginPost } from '@/app/(backend)/api/v1/auth/login/route';
import { POST as resetPost } from '@/app/(backend)/api/v1/auth/password/reset/route';
import { POST as registerPost } from '@/app/(backend)/api/v1/auth/register/route';

const TRACE_ID = /^[0-9a-f]{32}$/;

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// #301: the auth surface returns x-trace-id and the x-error-code the controller
// produced, so a failed login / register 500 can be correlated with Tempo/Loki.
describe('auth route tracing (#301)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('register 500 carries x-trace-id and the controller error code', async () => {
    register.mockResolvedValue({
      success: false,
      statusCode: 500,
      error: 'INTERNAL_SERVER',
    });

    const res = await registerPost(
      jsonRequest('http://localhost/api/v1/auth/register', {
        email: 'a@b.co',
        password: 'TestPass123',
        name: 'A',
        accountType: 'student',
      }),
    );

    expect(res.status).toBe(500);
    expect(res.headers.get('x-trace-id')).toMatch(TRACE_ID);
    expect(res.headers.get('x-error-code')).toBe('INTERNAL_SERVER');
  });

  it('login 401 (wrong password) carries x-trace-id and UNAUTHORIZED', async () => {
    login.mockResolvedValue({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });

    const res = await loginPost(
      jsonRequest('http://localhost/api/v1/auth/login', {
        email: 'a@b.co',
        password: 'wrong',
      }),
    );

    expect(res.status).toBe(401);
    expect(res.headers.get('x-trace-id')).toMatch(TRACE_ID);
    expect(res.headers.get('x-error-code')).toBe('UNAUTHORIZED');
  });

  it('password reset 200 carries x-trace-id', async () => {
    requestPasswordReset.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: { message: 'SUCCESS_RESET_LINK_SENT' },
    });

    const res = await resetPost(
      jsonRequest('http://localhost/api/v1/auth/password/reset', { email: 'a@b.co' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-trace-id')).toMatch(TRACE_ID);
  });

  it('maps malformed JSON to 400 BAD_REQUEST instead of an unhandled 500', async () => {
    const req = new NextRequest('http://localhost/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });

    const res = await registerPost(req);

    expect(res.status).toBe(400);
    expect(res.headers.get('x-error-code')).toBe('BAD_REQUEST');
    expect(res.headers.get('x-trace-id')).toMatch(TRACE_ID);
    expect(register).not.toHaveBeenCalled();
  });
});
