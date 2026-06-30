import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PUT } from '@/app/(backend)/api/v1/subjects/[id]/route';
import { GET as GET_LIST, POST } from '@/app/(backend)/api/v1/subjects/route';
import {
  cleanupSubjects,
  createRealClient,
  mockUser,
  seedSubject,
  TEST_ORGANIZATION_ID,
  TEST_USERS,
} from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Subjects Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupSubjects(user.id, 'subject-');
    }

    const supabase = createRealClient();
    await supabase
      .from('subjects')
      .delete()
      .in('id', [
        '00000000-0000-4000-8003-000000000001',
        '00000000-0000-4000-8003-000000000002',
        '00000000-0000-4000-8003-000000000003',
      ]);
  });

  describe('POST /api/v1/subjects', () => {
    it('creates a subject and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'subject-Math 101' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('subject-Math 101');
      expect(body.data.id).toBeDefined();
    });

    it('returns 422 when name is missing', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'subject-Math 101' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/subjects', () => {
    it('returns empty array when no subjects exist', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/subjects');
      const response = await GET_LIST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('filters by organizationId when provided', async () => {
      mockUser(TEST_USERS.TEACHER);

      await seedSubject({
        name: 'subject-Filtered Subject',
        organization_id: TEST_ORGANIZATION_ID,
        created_by: TEST_USERS.TEACHER.id,
      });

      const req = createNextRequest(
        `http://localhost/api/v1/subjects?organizationId=${TEST_ORGANIZATION_ID}`,
      );
      const response = await GET_LIST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe('subject-Filtered Subject');
    });
  });

  describe('GET /api/v1/subjects/:id', () => {
    it('returns subject when found', async () => {
      mockUser(TEST_USERS.TEACHER);

      const subject = await seedSubject({
        name: 'subject-Test Subject',
        created_by: TEST_USERS.TEACHER.id,
      });

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/subjects/${subject.id}`,
        { id: subject.id },
      );
      const response = await GET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      const data = Array.isArray(body.data) ? body.data[0] : body.data;
      expect(data.name).toBe('subject-Test Subject');
    });

    it('returns 404 when subject does not exist', async () => {
      mockUser(TEST_USERS.TEACHER);

      const fakeId = '00000000-0000-4000-8000-000000000099';
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/subjects/${fakeId}`,
        { id: fakeId },
      );
      const response = await GET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/subjects/:id', () => {
    it('updates own subject and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const subject = await seedSubject({
        name: 'subject-Original Name',
        created_by: TEST_USERS.TEACHER.id,
      });

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/subjects/${subject.id}`,
        { id: subject.id },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Name' }),
        },
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.name).toBe('Updated Name');
    });

    it('returns 403 when updating another user subject', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const subject = await seedSubject({
        name: 'subject-Teacher Subject',
        created_by: TEST_USERS.TEACHER.id,
      });

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/subjects/${subject.id}`,
        { id: subject.id },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Hacked' }),
        },
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/subjects/:id', () => {
    it('deletes own subject and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const subject = await seedSubject({
        name: 'subject-To Delete',
        created_by: TEST_USERS.TEACHER.id,
      });

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/subjects/${subject.id}`,
        { id: subject.id },
        { method: 'DELETE' },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user subject', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const subject = await seedSubject({
        name: 'subject-Teacher Subject',
        created_by: TEST_USERS.TEACHER.id,
      });

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/subjects/${subject.id}`,
        { id: subject.id },
        { method: 'DELETE' },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
