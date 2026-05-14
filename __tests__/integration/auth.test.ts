import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as registerPost } from '@/app/(backend)/api/v1/auth/register/route';
import { POST as loginPost } from '@/app/(backend)/api/v1/auth/login/route';
import { POST as logoutPost } from '@/app/(backend)/api/v1/auth/logout/route';
import { POST as resetPost } from '@/app/(backend)/api/v1/auth/password/reset/route';
import { POST as updatePasswordPost } from '@/app/(backend)/api/v1/auth/password/update/route';
import { TEST_USERS } from './helpers';
import { createNextRequest } from './test-utils';

describe('Auth Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns 201', async () => {
      const uniqueEmail = `test-${Date.now()}@example.com`;
      const req = createNextRequest('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: uniqueEmail,
          password: 'TestPass123',
          name: 'Test User',
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
          firstName: 'Test',
          lastName: 'User',
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
          firstName: 'Test',
          lastName: 'User',
        }),
      });

      const response = await registerPost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
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
      const response = await logoutPost();
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
