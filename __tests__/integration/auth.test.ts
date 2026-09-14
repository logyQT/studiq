import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as loginPost } from '@/app/(backend)/api/v1/auth/login/route';
import { POST as logoutPost } from '@/app/(backend)/api/v1/auth/logout/route';
import { POST as resetPost } from '@/app/(backend)/api/v1/auth/password/reset/route';
import { POST as updatePasswordPost } from '@/app/(backend)/api/v1/auth/password/update/route';
import { POST as registerPost } from '@/app/(backend)/api/v1/auth/register/route';
import { mockUser, TEST_USERS, useRealSupabase } from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

describe('Auth Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns 202', async () => {
      const uniqueEmail = `test-${Date.now()}@example.com`;
      const req = createNextRequest('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: uniqueEmail,
          password: 'TestPass123',
          name: 'Test User',
          accountType: 'educator',
        }),
      });

      const response = await registerPost(req);
      const body = await response.json();

      expect(response.status).toBe(202);
      expect(body.success).toBe(true);
    });

    it('returns 422 when email is invalid', async () => {
      const req = createNextRequest('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'TestPass123',
          name: 'Test User',
          accountType: 'educator',
        }),
      });

      const response = await registerPost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns 422 when password is too short', async () => {
      const req = createNextRequest('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'short',
          name: 'Test User',
          accountType: 'educator',
        }),
      });

      const response = await registerPost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('assigns correct brand plan key via handle_new_user trigger', async () => {
      const { createServiceClient } = await import('@/lib/supabase/service');
      const serviceClient = createServiceClient();
      const uniqueEmail = `plan-test-${Date.now()}@example.com`;

      const req = createNextRequest('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: uniqueEmail,
          password: 'TestPass123',
          name: 'Plan Test',
          accountType: 'educator',
        }),
      });

      const response = await registerPost(req);
      expect(response.status).toBe(202);

      const { data: profile } = await serviceClient
        .from('profiles')
        .select('personal_plan_key')
        .eq('email', uniqueEmail)
        .single();

      expect(profile?.personal_plan_key).toBe('lite');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('logs in with valid credentials and returns 200', async () => {
      const req = createNextRequest('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: TEST_USERS.TEACHER.email,
          password: TEST_USERS.TEACHER.password,
        }),
      });

      const response = await loginPost(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 401 with wrong password', async () => {
      const req = createNextRequest('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: TEST_USERS.TEACHER.email,
          password: 'wrongpassword',
        }),
      });

      const response = await loginPost(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 422 when email is missing', async () => {
      const req = createNextRequest('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'TestPass123' }),
      });

      const response = await loginPost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('returns 200 on logout', async () => {
      const req = createNextRequest('http://localhost/api/v1/auth/logout', { method: 'POST' });
      const response = await logoutPost(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('POST /api/v1/auth/password/reset', () => {
    it('accepts password reset request and returns 200', async () => {
      const req = createNextRequest('http://localhost/api/v1/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_USERS.TEACHER.email }),
      });

      const response = await resetPost(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 422 when email is invalid', async () => {
      const req = createNextRequest('http://localhost/api/v1/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });

      const response = await resetPost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/password/update', () => {
    it('returns 422 when passwords do not match', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/auth/password/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'NewPass123',
          confirmPassword: 'DifferentPass123',
        }),
      });

      const response = await updatePasswordPost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });
  });
});
