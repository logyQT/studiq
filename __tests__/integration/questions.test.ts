import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PUT } from '@/app/(backend)/api/v1/questions/[id]/route';
import { GET as GET_LIST, POST } from '@/app/(backend)/api/v1/questions/route';
import {
  cleanupOrganizationByName,
  cleanupQuestions,
  createServiceClient,
  mockUser,
  seedOrgMembership,
  seedOrganization,
  TEST_USERS,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

const ORG_PREFIX = 'q-test-';

describe('Questions Integration', () => {
  let orgId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupQuestions(user.id);
    }

    const seeded = await seedOrganization(`${ORG_PREFIX}${Date.now()}`);
    orgId = seeded.org.id;

    await seedOrgMembership({
      organizationId: orgId,
      userId: TEST_USERS.TEACHER.id,
      orgRoleId: seeded.teacherRoleId,
    });
  });

  afterAll(async () => {
    await cleanupOrganizationByName(ORG_PREFIX);
  });

  const orgCookies = () => ({ active_org_id: orgId });

  describe('POST /api/v1/questions', () => {
    it('creates a question and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mcq',
          content: 'What is 2+2?',
          answers: [
            { content: '4', isCorrect: true, orderIndex: 0 },
            { content: '5', isCorrect: false, orderIndex: 1 },
          ],
        }),
      }, orgCookies());

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.content).toBe('What is 2+2?');
      expect(body.data.question_answers).toBeDefined();
    });

    it('returns 422 when content is empty', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mcq',
          content: '',
          answers: [{ content: 'Answer', isCorrect: true }],
        }),
      }, orgCookies());

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 422 when answers array is empty', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mcq',
          content: 'Question',
          answers: [],
        }),
      }, orgCookies());

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mcq',
          content: 'Question',
          answers: [{ content: 'Answer', isCorrect: true }],
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 403 when using another users bankId', async () => {
      const supabase = createServiceClient();
      const { data: bank } = await supabase
        .from('question_banks')
        .insert({
          name: 'Test Bank',
          created_by: TEST_USERS.TEACHER.id,
          organization_id: orgId,
          visibility: 'personal',
        })
        .select()
        .single();

      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mcq',
          content: 'Question',
          bankId: bank.id,
          answers: [{ content: 'Answer', isCorrect: true }],
        }),
      }, orgCookies());

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });

    it('returns 404 when bankId does not exist', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'mcq',
          content: 'Question',
          bankId: '00000000-0000-4000-8000-000000000099',
          answers: [{ content: 'Answer', isCorrect: true }],
        }),
      }, orgCookies());

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/questions', () => {
    it('returns questions list', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/questions', undefined, orgCookies());
      const response = await GET_LIST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('filters by type', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      await supabase.from('questions').insert({
        type: 'true_false',
        content: 'True or False?',
        created_by: TEST_USERS.TEACHER.id,
        organization_id: orgId,
      });

      const req = createNextRequest('http://localhost/api/v1/questions?type=true_false', undefined, orgCookies());
      const response = await GET_LIST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].type).toBe('true_false');
    });
  });

  describe('GET /api/v1/questions/:id', () => {
    it('returns question when found', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'Get Me',
          created_by: TEST_USERS.TEACHER.id,
          organization_id: orgId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${question.id}`,
        { id: question.id },
        undefined,
        orgCookies(),
      );
      const response = await GET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.content).toBe('Get Me');
    });

    it('returns 404 when question does not exist', async () => {
      mockUser(TEST_USERS.TEACHER);

      const fakeId = '00000000-0000-4000-8000-000000000099';
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${fakeId}`,
        { id: fakeId },
        undefined,
        orgCookies(),
      );
      const response = await GET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });
  });

  describe('PUT /api/v1/questions/:id', () => {
    it('updates own question and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'Original',
          created_by: TEST_USERS.TEACHER.id,
          organization_id: orgId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${question.id}`,
        { id: question.id },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Updated' }),
        },
        orgCookies(),
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.content).toBe('Updated');
    });

    it('returns 403 when updating another user question', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'Teacher Question',
          created_by: TEST_USERS.TEACHER.id,
          organization_id: orgId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${question.id}`,
        { id: question.id },
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hacked' }),
        },
        orgCookies(),
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/questions/:id', () => {
    it('deletes own question and returns 200', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'To Delete',
          created_by: TEST_USERS.TEACHER.id,
          organization_id: orgId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${question.id}`,
        { id: question.id },
        { method: 'DELETE' },
        orgCookies(),
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user question', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createServiceClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'Teacher Question',
          created_by: TEST_USERS.TEACHER.id,
          organization_id: orgId,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${question.id}`,
        { id: question.id },
        { method: 'DELETE' },
        orgCookies(),
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
