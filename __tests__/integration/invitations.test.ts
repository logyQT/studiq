import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as bulkPost } from '@/app/(backend)/api/v1/organization/invites/bulk/route';
import {
  GET as inviteGet,
  POST as invitePost,
} from '@/app/(backend)/api/v1/organization/invites/route';
import {
  cleanupInvitations,
  cleanupOrganizationByName,
  createServiceClient,
  mockUser,
  seedOrgMembership,
  seedOrganization,
  TEST_USERS,
} from './helpers';
import { createNextRequest } from './test-utils';

const ORG_PREFIX = 'invite-test-';

describe('Invitations Integration', () => {
  let orgId: string;
  let adminRoleId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupInvitations(user.id);
    }

    const seeded = await seedOrganization(`${ORG_PREFIX}${Date.now()}`);
    orgId = seeded.org.id;
    adminRoleId = seeded.adminRoleId;

    await seedOrgMembership({
      organizationId: orgId,
      userId: TEST_USERS.UNIVERSITY_ADMIN.id,
      orgRoleId: adminRoleId,
    });
  });

  afterAll(async () => {
    await cleanupOrganizationByName(ORG_PREFIX);
  });

  describe('POST /api/v1/organization/invites', () => {
    it('creates an invitation as university_admin and returns 201', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/organization/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `invite-${Date.now()}@example.com`,
          targetOrgRoleId: adminRoleId,
          organizationId: orgId,
        }),
      });

      const response = await invitePost(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('returns 422 when email is invalid', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/organization/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email', targetOrgRoleId: adminRoleId }),
      });

      const response = await invitePost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/organization/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', targetOrgRoleId: adminRoleId }),
      });

      const response = await invitePost(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 403 when student tries to invite', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/organization/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com', targetOrgRoleId: adminRoleId }),
      });

      const response = await invitePost(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/organization/invites?token=...', () => {
    it('returns invitation when token is valid', async () => {
      const supabase = createServiceClient();
      const { data: invitation, error } = await supabase
        .from('invitations')
        .insert({
          email: 'valid@example.com',
          target_org_role_id: adminRoleId,
          token: `valid-token-${Date.now()}`,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          inviter_id: TEST_USERS.UNIVERSITY_ADMIN.id,
          organization_id: orgId,
        })
        .select()
        .single();
      if (error || !invitation) throw new Error(`Failed to insert invitation: ${error?.message}`);

      const req = createNextRequest(
        `http://localhost/api/v1/organization/invites?token=${invitation.token}`,
      );
      const response = await inviteGet(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.email).toBe('valid@example.com');
    });

    it('returns 404 when token does not exist', async () => {
      const req = createNextRequest(
        'http://localhost/api/v1/organization/invites?token=nonexistent-token',
      );
      const response = await inviteGet(req);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });

    it('returns 410 when token is expired', async () => {
      const supabase = createServiceClient();
      await supabase.from('invitations').insert({
        email: 'expired@example.com',
        target_org_role_id: adminRoleId,
        token: 'expired-token-123',
        expires_at: new Date(Date.now() - 86400000).toISOString(),
        inviter_id: TEST_USERS.UNIVERSITY_ADMIN.id,
        organization_id: orgId,
      });

      const req = createNextRequest(
        'http://localhost/api/v1/organization/invites?token=expired-token-123',
      );
      const response = await inviteGet(req);
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.success).toBe(false);
    });

    it('returns 401 when token is empty (treated as no token, requires auth)', async () => {
      mockUser(null);
      const req = createNextRequest('http://localhost/api/v1/organization/invites?token=');
      const response = await inviteGet(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('POST /api/v1/organization/invites/bulk', () => {
    it('bulk creates invitations and returns 200', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/organization/invites/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invitations: [
            { email: `bulk1-${Date.now()}@example.com`, targetOrgRoleId: adminRoleId },
            { email: `bulk2-${Date.now()}@example.com`, targetOrgRoleId: adminRoleId },
          ],
        }),
      });

      const response = await bulkPost(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data.results)).toBe(true);
    });

    it('returns 422 when invitations array is empty', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/organization/invites/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitations: [] }),
      });

      const response = await bulkPost(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });
  });
});
