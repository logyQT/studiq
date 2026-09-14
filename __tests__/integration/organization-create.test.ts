import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { POST } from '@/app/(backend)/api/v1/organization/route';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import {
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { createNextRequest } from '#test/integration/test-utils';

forEachCopy((copyId) => {
  describe(`POST /api/v1/organization [${copyId}]`, () => {
    registerMock(copyId, null);

    let educator!: TestUserFixture;
    let manager!: TestUserFixture;
    let student!: TestUserFixture;
    const createdOrgIds: string[] = [];

    beforeAll(async () => {
      educator = await createTestUser({ role: 'educator' });
      manager = await createTestUser({ role: 'manager' });
      student = await createTestUser({ role: 'student' });
    });

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
    });

    afterAll(async () => {
      for (const orgId of createdOrgIds) {
        await cleanupOrganizationDeep(orgId);
      }
    });

    it('creates organization as educator and returns 201 with cookie', async () => {
      mockUser(educator);

      const req = createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `org-create-${copyId}-edu-${Date.now()}` }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toContain(`org-create-${copyId}-edu-`);
      expect(body.data.id).toBeDefined();
      expect(body.data.adminRoleId).toBeDefined();
      createdOrgIds.push(body.data.id);
    });

    it('creates organization as manager and returns 201', async () => {
      mockUser(manager);

      const req = createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `org-create-${copyId}-mgr-${Date.now()}` }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      createdOrgIds.push(body.data.id);
    });

    it('adds creator as org member with admin role', async () => {
      mockUser(educator);

      const orgName = `org-create-${copyId}-member-${Date.now()}`;
      const req = createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName }),
      });

      const response = await POST(req);
      const body = await response.json();
      expect(response.status).toBe(201);
      createdOrgIds.push(body.data.id);

      const supabase = createServiceClient();
      const { data: members } = await supabase
        .from('org_members')
        .select('*, org_roles!inner(name)')
        .eq('organization_id', body.data.id)
        .eq('user_id', educator.id);

      expect(members?.length).toBe(1);
      expect(members?.[0].org_roles.name).toBe('admin');
    });

    it('returns 201 with cookie, role ids and default group', async () => {
      mockUser(educator);

      const req = createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `org-create-${copyId}-roles-${Date.now()}` }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.adminRoleId).toBeDefined();
      expect(body.data.teacherRoleId).toBeDefined();
      expect(body.data.memberRoleId).toBeDefined();
      expect(body.data.defaultGroupId).toBeDefined();
      createdOrgIds.push(body.data.id);
    });

    it('returns 403 when student tries to create', async () => {
      mockUser(student);

      const req = createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `org-create-${copyId}-forbidden` }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `org-create-${copyId}-unauth` }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 422 when name is too short', async () => {
      mockUser(educator);

      const req = createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'AB' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });
  });
});
