import { afterAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/(backend)/api/v1/organization/route';
import {
  cleanupOrganizationByName,
  createServiceClient,
  mockUser,
  TEST_USERS,
} from './helpers';
import { createNextRequest } from './test-utils';

const TEST_PREFIX = 'org-create-';

describe('POST /api/v1/organization', () => {
  afterAll(async () => {
    await cleanupOrganizationByName(TEST_PREFIX);
  });

  it('creates organization as educator and returns 201 with cookie', async () => {
    mockUser(TEST_USERS.TEACHER);

    const req = createNextRequest('http://localhost/api/v1/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${TEST_PREFIX}edu-${Date.now()}` }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.name).toContain(TEST_PREFIX);
    expect(body.data.id).toBeDefined();
    expect(body.data.adminRoleId).toBeDefined();
  });

  it('creates organization as manager and returns 201', async () => {
    mockUser(TEST_USERS.UNIVERSITY_ADMIN);

    const req = createNextRequest('http://localhost/api/v1/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${TEST_PREFIX}mgr-${Date.now()}` }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
  });

  it('adds creator as org member with admin role', async () => {
    mockUser(TEST_USERS.TEACHER);

    const orgName = `${TEST_PREFIX}member-${Date.now()}`;
    const req = createNextRequest('http://localhost/api/v1/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: orgName }),
    });

    const response = await POST(req);
    const body = await response.json();
    expect(response.status).toBe(201);

    const supabase = createServiceClient();
    const { data: members } = await supabase
      .from('org_members')
      .select('*, org_roles!inner(name)')
      .eq('organization_id', body.data.id)
      .eq('user_id', TEST_USERS.TEACHER.id);

    expect(members?.length).toBe(1);
    expect(members?.[0].org_roles.name).toBe('admin');
  });

  it('returns 201 with cookie, role ids and default group', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${TEST_PREFIX}roles-${Date.now()}` }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.adminRoleId).toBeDefined();
      expect(body.data.teacherRoleId).toBeDefined();
      expect(body.data.memberRoleId).toBeDefined();
      expect(body.data.defaultGroupId).toBeDefined();
    });

    it('returns 403 when student tries to create', async () => {
    mockUser(TEST_USERS.STUDENT);

    const req = createNextRequest('http://localhost/api/v1/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${TEST_PREFIX}forbidden` }),
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
      body: JSON.stringify({ name: `${TEST_PREFIX}unauth` }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('returns 422 when name is too short', async () => {
    mockUser(TEST_USERS.TEACHER);

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
