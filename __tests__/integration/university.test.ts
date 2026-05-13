import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/(backend)/api/v1/admin/universities/route';
import { TEST_USERS, mockUser } from './helpers';
import { createClient } from '@/lib/supabase/server';
import { createNextRequest } from './test-utils';

describe('University Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/admin/universities', () => {
    it('creates a university as sys_admin and returns 201', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const uniqueSlug = `test-uni-${Date.now()}`;
      const req = createNextRequest('http://localhost/api/v1/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test University', slug: uniqueSlug }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Test University');
    });

    it('returns 409 when slug already exists', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const supabase = await createClient();
      const uniqueSlug = `dup-uni-${Date.now()}`;
      await supabase.from('universities').insert({ name: 'Existing', slug: uniqueSlug });

      const req = createNextRequest('http://localhost/api/v1/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Duplicate', slug: uniqueSlug }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test University', slug: 'test-uni' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 403 when non-sys-admin tries to create', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test University', slug: 'test-uni' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });

    it('returns 422 when name is too short', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'AB', slug: 'test-uni' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 422 when slug has invalid format', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test University', slug: 'Invalid_Slug!' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });
  });
});
