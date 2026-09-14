import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import {
  DELETE,
  GET as GET_BY_ID,
  PUT,
} from '@/app/(backend)/api/v1/admin/organizations/[id]/route';
import { GET, POST } from '@/app/(backend)/api/v1/admin/organizations/route';
import {
  applyRegisteredMock,
  cleanupOrganizationByName,
  createServiceClient,
  mockUser,
  TEST_USERS,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

forEachCopy((copyId) => {
  describe(`Organization Integration [${copyId}]`, () => {
    registerMock(copyId, null);

    const TEST_PREFIX = `org-test-${copyId}-`;

    afterAll(async () => {
      await cleanupOrganizationByName(`org-test-${copyId}`);
    });

    describe('POST /api/v1/admin/universities', () => {
      beforeEach(() => {
        vi.clearAllMocks();
        applyRegisteredMock(copyId);
      });

      it('creates an organization as sys_admin and returns 201', async () => {
        mockUser(TEST_USERS.SYS_ADMIN);

        const req = createNextRequest('http://localhost/api/v1/admin/universities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${TEST_PREFIX}create-${Date.now()}` }),
        });

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.data.name).toContain(TEST_PREFIX);
      });

      it('returns 401 when not authenticated', async () => {
        mockUser(null);

        const req = createNextRequest('http://localhost/api/v1/admin/universities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${TEST_PREFIX}unauth` }),
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
          body: JSON.stringify({ name: `${TEST_PREFIX}forbidden` }),
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
          body: JSON.stringify({ name: 'AB' }),
        });

        const response = await POST(req);
        const body = await response.json();

        expect(response.status).toBe(422);
        expect(body.success).toBe(false);
      });
    });

    describe('GET /api/v1/admin/universities', () => {
      beforeEach(() => {
        vi.clearAllMocks();
        applyRegisteredMock(copyId);
      });

      it('lists all organizations as sys_admin and returns 200', async () => {
        mockUser(TEST_USERS.SYS_ADMIN);

        const supabase = createServiceClient();
        await supabase.from('organizations').insert({ name: `${TEST_PREFIX}list-test` });

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
      beforeEach(() => {
        vi.clearAllMocks();
        applyRegisteredMock(copyId);
      });

      it('gets a single organization by id and returns 200', async () => {
        mockUser(TEST_USERS.SYS_ADMIN);

        const supabase = createServiceClient();
        const { data: created } = await supabase
          .from('organizations')
          .insert({ name: `${TEST_PREFIX}get-test` })
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
        expect(body.data.name).toBe(`${TEST_PREFIX}get-test`);
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
      beforeEach(() => {
        vi.clearAllMocks();
        applyRegisteredMock(copyId);
      });

      it('updates organization name and returns 200', async () => {
        mockUser(TEST_USERS.SYS_ADMIN);

        const supabase = createServiceClient();
        const { data: created } = await supabase
          .from('organizations')
          .insert({ name: `${TEST_PREFIX}put-original` })
          .select()
          .single();

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/admin/universities/${created.id}`,
          { id: created.id },
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `${TEST_PREFIX}put-updated` }),
          },
        );
        const response = await PUT(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.name).toBe(`${TEST_PREFIX}put-updated`);
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
      beforeEach(() => {
        vi.clearAllMocks();
        applyRegisteredMock(copyId);
      });

      it('deletes an organization and returns 200', async () => {
        mockUser(TEST_USERS.SYS_ADMIN);

        const supabase = createServiceClient();
        const { data: created } = await supabase
          .from('organizations')
          .insert({ name: `${TEST_PREFIX}delete-test` })
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
});
