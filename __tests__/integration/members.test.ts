import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PUT } from '@/app/(backend)/api/v1/organization/members/route';
import {
  before,
  createTestUser,
  type BeforeResult,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { cleanupOrganizationByName, createServiceClient, mockUser } from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

describe('Members Integration', () => {
  let fixture!: BeforeResult;
  let orgId!: string;
  let adminRoleId!: string;
  let member!: TestUserFixture;

  beforeAll(async () => {
    fixture = await before({
      role: 'manager',
      org: true,
      members: { count: 1 },
    });
    orgId = fixture.orgId!;
    member = fixture.memberUsers[0];

    const supabase = createServiceClient();
    const { data: adminRole } = await supabase
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', 'admin')
      .single();
    adminRoleId = adminRole!.id;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await cleanupOrganizationByName('seed-org-');
  });

  describe('GET /api/v1/organization/members', () => {
    it('lists members for the org admin', async () => {
      mockUser(fixture.user);

      const req = createNextRequest('http://localhost/api/v1/organization/members', undefined, {
        active_org_id: orgId,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('filters members by role', async () => {
      mockUser(fixture.user);

      const req = createNextRequest('http://localhost/api/v1/organization/members?role=member', undefined, {
        active_org_id: orgId,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 403 when user has no organization', async () => {
      const noOrg = await createTestUser({ role: 'student' });
      mockUser(noOrg);

      const req = createNextRequest('http://localhost/api/v1/organization/members');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/organization/members');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/organization/members', () => {
    it('changes role successfully', async () => {
      mockUser(fixture.user);

      const req = createNextRequest('http://localhost/api/v1/organization/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: member.id,
          newOrgRoleId: adminRoleId,
        }),
      }, { active_org_id: orgId });

      const response = await PUT(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 422 when input is invalid', async () => {
      mockUser(fixture.user);

      const req = createNextRequest('http://localhost/api/v1/organization/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: '',
          newOrgRoleId: 'invalid-uuid',
        }),
      }, { active_org_id: orgId });

      const response = await PUT(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/organization/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: member.id,
          newOrgRoleId: adminRoleId,
        }),
      });

      const response = await PUT(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/organization/members', () => {
    it('removes member successfully', async () => {
      mockUser(fixture.user);

      const req = createNextRequest(
        `http://localhost/api/v1/organization/members?userId=${member.id}`,
        { method: 'DELETE' },
        { active_org_id: orgId },
      );

      const response = await DELETE(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 400 when userId is empty', async () => {
      mockUser(fixture.user);

      const req = createNextRequest('http://localhost/api/v1/organization/members?userId=', {
        method: 'DELETE',
      }, { active_org_id: orgId });

      const response = await DELETE(req);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest(
        `http://localhost/api/v1/organization/members?userId=${member.id}`,
        { method: 'DELETE' },
      );

      const response = await DELETE(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });
});