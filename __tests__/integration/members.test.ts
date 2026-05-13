import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET, PUT, DELETE } from '@/app/(backend)/api/v1/university/members/route';
import { TEST_USERS, mockUser } from './helpers';
import { createNextRequest } from './test-utils';

describe('Members Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/university/members', () => {
    it('lists members for university_admin', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/members');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('filters members by role', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/members?role=student');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 403 when user has no university', async () => {
      mockUser(TEST_USERS.FREE);

      const req = createNextRequest('http://localhost/api/v1/university/members');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/university/members');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/university/members', () => {
    it('changes role successfully', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: TEST_USERS.STUDENT.id,
          newRole: 'teacher',
        }),
      });

      const response = await PUT(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 422 when input is invalid', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: '',
          newRole: 'invalid_role',
        }),
      });

      const response = await PUT(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/university/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: TEST_USERS.STUDENT.id,
          newRole: 'teacher',
        }),
      });

      const response = await PUT(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/university/members', () => {
    it('removes member successfully', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest(
        `http://localhost/api/v1/university/members?userId=${TEST_USERS.STUDENT.id}`,
        {
          method: 'DELETE',
        },
      );

      const response = await DELETE(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 400 when userId is empty', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/members?userId=', {
        method: 'DELETE',
      });

      const response = await DELETE(req);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest(
        `http://localhost/api/v1/university/members?userId=${TEST_USERS.STUDENT.id}`,
        {
          method: 'DELETE',
        },
      );

      const response = await DELETE(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });
});
