import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET as GET_LIST } from '@/app/(backend)/api/v1/subjects/route';
import { PUT, DELETE, GET } from '@/app/(backend)/api/v1/subjects/[id]/route';
import { TEST_USERS, mockUser, cleanupSubjects, TEST_UNIVERSITY_ID, seedSubject } from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Subjects Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupSubjects(user.id);
    }
  });

  describe('POST /api/v1/subjects', () => {
    it('creates a subject and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Math 101' }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Math 101');
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
        body: JSON.stringify({ name: 'Math 101' }),
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

    it('filters by universityId when provided', async () => {
      mockUser(TEST_USERS.TEACHER);

      await seedSubject({
        name: 'Filtered Subject',
        university_id: TEST_UNIVERSITY_ID,
        created_by: TEST_USERS.TEACHER.id,
      });

      const req = createNextRequest(
        `http://localhost/api/v1/subjects?universityId=${TEST_UNIVERSITY_ID}`,
      );
      const response = await GET_LIST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe('Filtered Subject');
    });
  });

  describe('GET /api/v1/subjects/:id', () => {
    it('returns subject when found', async () => {
      mockUser(TEST_USERS.TEACHER);

      const subject = await seedSubject({
        name: 'Test Subject',
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
      expect(data.name).toBe('Test Subject');
    });

    it('returns 404 when subject does not exist', async () => {
      mockUser(TEST_USERS.TEACHER);

      const fakeId = '00000000-0000-0000-0000-000000000099';
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
        name: 'Original Name',
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
        name: 'Teacher Subject',
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

      const subject = await seedSubject({ name: 'To Delete', created_by: TEST_USERS.TEACHER.id });

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
        name: 'Teacher Subject',
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
