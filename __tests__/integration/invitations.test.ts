import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  POST as invitePost,
  GET as inviteGet,
} from '@/app/(backend)/api/v1/university/invitations/route';
import { POST as bulkPost } from '@/app/(backend)/api/v1/university/invitations/bulk/route';
import { TEST_USERS, mockUser, cleanupInvitations } from './helpers';
import { createClient } from '@/lib/supabase/server';
import { createNextRequest } from './test-utils';

describe('Invitations Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupInvitations(user.id);
    }
  });

  describe('POST /api/v1/university/invitations', () => {
    it('creates an invitation as university_admin and returns 201', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `invite-${Date.now()}@example.com`,
          role: 'student',
        }),
      });

      const response = await invitePost(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('returns 422 when email is invalid', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', role: 'student' }),
      });

      const response = await invitePost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/university/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', role: 'student' }),
      });

      const response = await invitePost(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 403 when student tries to invite', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/university/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', role: 'student' }),
      });

      const response = await invitePost(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/university/invitations?token=...', () => {
    it('returns invitation when token is valid', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = await createClient();
      const { data: invitation } = await supabase
        .from('invitations')
        .insert({
          email: 'valid@example.com',
          role: 'student',
          token: 'valid-token-123',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          created_by: TEST_USERS.UNIVERSITY_ADMIN.id,
          university_id: '00000000-0000-0000-0000-000000000001',
        })
        .select()
        .single();

      const req = createNextRequest(
        `http://localhost/api/v1/university/invitations?token=${invitation.token}`,
      );
      const response = await inviteGet(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.email).toBe('valid@example.com');
    });

    it('returns 404 when token does not exist', async () => {
      const req = createNextRequest(
        'http://localhost/api/v1/university/invitations?token=nonexistent-token',
      );
      const response = await inviteGet(req);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });

    it('returns 410 when token is expired', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = await createClient();
      await supabase.from('invitations').insert({
        email: 'expired@example.com',
        role: 'student',
        token: 'expired-token-123',
        expires_at: new Date(Date.now() - 86400000).toISOString(),
        created_by: TEST_USERS.UNIVERSITY_ADMIN.id,
        university_id: '00000000-0000-0000-0000-000000000001',
      });

      const req = createNextRequest(
        'http://localhost/api/v1/university/invitations?token=expired-token-123',
      );
      const response = await inviteGet(req);
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.success).toBe(false);
    });

    it('returns 400 when token is empty', async () => {
      const req = createNextRequest('http://localhost/api/v1/university/invitations?token=');
      const response = await inviteGet(req);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });
  });

  describe('POST /api/v1/university/invitations/bulk', () => {
    it('bulk creates invitations and returns 200', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/invitations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: [`bulk1-${Date.now()}@example.com`, `bulk2-${Date.now()}@example.com`],
          role: 'student',
        }),
      });

      const response = await bulkPost(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 422 when emails array is empty', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/university/invitations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [], role: 'student' }),
      });

      const response = await bulkPost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });
  });
});
