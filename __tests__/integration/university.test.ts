import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { POST, GET } from '@/app/(backend)/api/v1/admin/organizations/route';
import { GET as GET_BY_ID, PUT, DELETE } from '@/app/(backend)/api/v1/admin/organizations/[id]/route';
import { TEST_USERS, mockUser, createRealClient, cleanupOrganization } from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('Organization Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await cleanupOrganization('test-');
    await cleanupOrganization('dup-');
    await cleanupOrganization('updated-');
  });

  describe('POST /api/v1/admin/universities', () => {
    it('creates an organization as sys_admin and returns 201', async () => {
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

      const supabase = createRealClient();
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

  describe('GET /api/v1/admin/universities', () => {
    it('lists all organizations as sys_admin and returns 200', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const uniqueSlug = `test-list-${Date.now()}`;
      const supabase = createRealClient();
      await supabase.from('universities').insert({ name: 'List Test', slug: uniqueSlug });

      const req = createNextRequest('http://localhost/api/v1/admin/universities');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/admin/universities');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 403 when non-sys-admin tries to list', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/admin/universities');
      const response = await GET(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/admin/universities/:id', () => {
    it('gets a single organization by id and returns 200', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const uniqueSlug = `test-get-${Date.now()}`;
      const supabase = createRealClient();
      const { data: created } = await supabase
        .from('universities')
        .insert({ name: 'Get Test', slug: uniqueSlug })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${created.id}`,
        { id: created.id },
      );
      const response = await GET_BY_ID(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(created.id);
      expect(body.data.name).toBe('Get Test');
    });

    it('returns 404 for non-existent organization', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${VALID_UUID}`,
        { id: VALID_UUID },
      );
      const response = await GET_BY_ID(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });

    it('returns 400 for invalid UUID format', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/admin/universities/invalid-id',
        { id: 'invalid-id' },
      );
      const response = await GET_BY_ID(request, { params });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${VALID_UUID}`,
        { id: VALID_UUID },
      );
      const response = await GET_BY_ID(request, { params });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 403 when non-sys-admin tries to get', async () => {
      mockUser(TEST_USERS.TEACHER);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${VALID_UUID}`,
        { id: VALID_UUID },
      );
      const response = await GET_BY_ID(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/admin/universities/:id', () => {
    it('updates organization name and returns 200', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const uniqueSlug = `test-put-${Date.now()}`;
      const supabase = createRealClient();
      const { data: created } = await supabase
        .from('universities')
        .insert({ name: 'Original Name', slug: uniqueSlug })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${created.id}`,
        { id: created.id },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Name' }),
        },
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Updated Name');
    });

    it('updates organization slug and returns 200', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const uniqueSlug = `test-put-slug-${Date.now()}`;
      const supabase = createRealClient();
      const { data: created } = await supabase
        .from('universities')
        .insert({ name: 'Slug Test', slug: uniqueSlug })
        .select()
        .single();

      const newSlug = `updated-slug-${Date.now()}`;
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${created.id}`,
        { id: created.id },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: newSlug }),
        },
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.slug).toBe(newSlug);
    });

    it('returns 409 for duplicate slug', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const supabase = createRealClient();
      const slug1 = `dup-slug-1-${Date.now()}`;
      const slug2 = `dup-slug-2-${Date.now()}`;
      const { data: uni1 } = await supabase
        .from('universities')
        .insert({ name: 'Uni 1', slug: slug1 })
        .select()
        .single();
      await supabase.from('universities').insert({ name: 'Uni 2', slug: slug2 });

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${uni1.id}`,
        { id: uni1.id },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: slug2 }),
        },
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.success).toBe(false);
    });

    it('returns 404 for non-existent organization', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${VALID_UUID}`,
        { id: VALID_UUID },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Name' }),
        },
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });

    it('returns 422 for invalid body', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${VALID_UUID}`,
        { id: VALID_UUID },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'AB' }),
        },
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 400 for invalid UUID format', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/admin/universities/invalid-id',
        { id: 'invalid-id' },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'New Name' }),
        },
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/admin/universities/:id', () => {
    it('deletes an organization and returns 200', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const uniqueSlug = `test-delete-${Date.now()}`;
      const supabase = createRealClient();
      const { data: created } = await supabase
        .from('universities')
        .insert({ name: 'Delete Test', slug: uniqueSlug })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${created.id}`,
        { id: created.id },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);

      const { data: deleted } = await supabase
        .from('universities')
        .select('id')
        .eq('id', created.id)
        .single();
      expect(deleted).toBeNull();
    });

    it('returns 404 for non-existent organization', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${VALID_UUID}`,
        { id: VALID_UUID },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });

    it('returns 400 for invalid UUID format', async () => {
      mockUser(TEST_USERS.SYS_ADMIN);

      const { request, params } = createNextRequestWithParams(
        'http://localhost/api/v1/admin/universities/invalid-id',
        { id: 'invalid-id' },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${VALID_UUID}`,
        { id: VALID_UUID },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 403 when non-sys-admin tries to delete', async () => {
      mockUser(TEST_USERS.TEACHER);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/admin/universities/${VALID_UUID}`,
        { id: VALID_UUID },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
