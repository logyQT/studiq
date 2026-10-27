import type { NextResponse } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as listOrgsGet } from '@/app/(backend)/api/v1/me/orgs/route';
import { POST } from '@/app/(backend)/api/v1/organization/route';

const suiteId = crypto.randomUUID().slice(0, 8);

describe(`POST /api/v1/organization`, () => {
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
    useRealSupabase();
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
      body: JSON.stringify({ name: `org-create-${suiteId}-edu-${Date.now()}` }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.name).toContain(`org-create-${suiteId}-edu-`);
    expect(body.data.id).toBeDefined();
    expect(body.data.adminRoleId).toBeDefined();
    createdOrgIds.push(body.data.id);
  });

  it('creates organization as manager and returns 201', async () => {
    mockUser(manager);

    const req = createNextRequest('http://localhost/api/v1/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `org-create-${suiteId}-mgr-${Date.now()}` }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    createdOrgIds.push(body.data.id);
  });

  it('adds creator as org member with admin role', async () => {
    mockUser(educator);

    const orgName = `org-create-${suiteId}-member-${Date.now()}`;
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
      body: JSON.stringify({ name: `org-create-${suiteId}-roles-${Date.now()}` }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.adminRoleId).toBeDefined();
    expect(body.data.teacherRoleId).toBeDefined();
    expect(body.data.memberRoleId).toBeDefined();
    expect(body.data.defaultGroupId).toBeDefined();
    expect((response as NextResponse).cookies.get('active_org_id')?.value).toBe(body.data.id);
    createdOrgIds.push(body.data.id);
  });

  it('activates the new organization for the creator', async () => {
    mockUser(manager);

    const req = createNextRequest('http://localhost/api/v1/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `org-create-${suiteId}-active-${Date.now()}` }),
    });

    const response = await POST(req);
    const body = await response.json();

    expect(response.status).toBe(201);
    createdOrgIds.push(body.data.id);

    // Creating the organization is what makes it the caller's active org — the
    // setup screen relies on this instead of calling POST /api/v1/me/orgs/switch (#306).
    const activeOrgId = (response as NextResponse).cookies.get('active_org_id')?.value;
    expect(activeOrgId).toBe(body.data.id);

    const listResponse = await listOrgsGet(
      createNextRequest('http://localhost/api/v1/me/orgs', undefined, {
        active_org_id: activeOrgId as string,
      }),
    );
    const listBody = await listResponse.json();

    expect(listResponse.status).toBe(200);
    const created = listBody.data.find((org: { id: string }) => org.id === body.data.id);
    expect(created).toMatchObject({ isActive: true, orgRoleName: 'admin' });
  });

  it('returns 403 when student tries to create', async () => {
    mockUser(student);

    const req = createNextRequest('http://localhost/api/v1/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `org-create-${suiteId}-forbidden` }),
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
      body: JSON.stringify({ name: `org-create-${suiteId}-unauth` }),
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
