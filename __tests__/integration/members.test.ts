import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PUT } from '@/app/(backend)/api/v1/organization/members/route';
import {
  cleanupOrganizationByName,
  mockUser,
  seedOrgMembership,
  seedOrganization,
  TEST_USERS,
} from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

const ORG_PREFIX = 'members-test-';

describe('Members Integration', () => {
  let orgId: string;
  let adminRoleId: string;
  let memberRoleId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const seeded = await seedOrganization(`${ORG_PREFIX}${Date.now()}`);
    orgId = seeded.org.id;
    adminRoleId = seeded.adminRoleId;
    memberRoleId = seeded.memberRoleId;

    await seedOrgMembership({
      organizationId: orgId,
      userId: TEST_USERS.UNIVERSITY_ADMIN.id,
      orgRoleId: adminRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: TEST_USERS.STUDENT.id,
      orgRoleId: memberRoleId,
    });
  });

  afterAll(async () => {
    await cleanupOrganizationByName(ORG_PREFIX);
  });

  describe('GET /api/v1/organization/members', () => {
    it('lists members for university_admin', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/organization/members', undefined, {
        active_org_id: orgId,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('filters members by role', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/organization/members?role=student', undefined, {
        active_org_id: orgId,
      });
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 403 when user has no organization', async () => {
      mockUser(TEST_USERS.STUDENT);

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
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest('http://localhost/api/v1/organization/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: TEST_USERS.STUDENT.id,
          newOrgRoleId: adminRoleId,
        }),
      }, { active_org_id: orgId });

      const response = await PUT(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 422 when input is invalid', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

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
          targetUserId: TEST_USERS.STUDENT.id,
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
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const req = createNextRequest(
        `http://localhost/api/v1/organization/members?userId=${TEST_USERS.STUDENT.id}`,
        { method: 'DELETE' },
        { active_org_id: orgId },
      );

      const response = await DELETE(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 400 when userId is empty', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

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
        `http://localhost/api/v1/organization/members?userId=${TEST_USERS.STUDENT.id}`,
        { method: 'DELETE' },
      );

      const response = await DELETE(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });
});
