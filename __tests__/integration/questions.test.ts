import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST, GET as GET_LIST } from '@/app/(backend)/api/v1/questions/route';
import { GET, PUT, DELETE } from '@/app/(backend)/api/v1/questions/[id]/route';
import { TEST_USERS, mockUser, cleanupQuestions, cleanupSubjects, createRealClient } from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Questions Integration', () => {
  let subjectId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupQuestions(user.id);
      await cleanupSubjects(user.id, 'question-');
    }

    const supabase = createRealClient();
    const { data: subject, error: subjectError } = await supabase
      .from('subjects')
      .insert({ name: 'question-Question Test Subject', created_by: TEST_USERS.TEACHER.id })
      .select()
      .single();
    if (subjectError || !subject) throw new Error(`Failed to create subject: ${subjectError?.message}`);
    subjectId = subject.id;
  });

  describe('POST /api/v1/questions', () => {
    it('creates a question and returns 201', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId,
          type: 'mcq',
          content: 'What is 2+2?',
          difficulty: 'easy',
          answers: [
            { content: '4', isCorrect: true, orderIndex: 0 },
            { content: '5', isCorrect: false, orderIndex: 1 },
          ],
        }),
      });

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
      });

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
      });

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
  });

  describe('GET /api/v1/questions', () => {
    it('returns questions list', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/questions');
      const response = await GET_LIST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('filters by subjectId', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createRealClient();
      const { error: insertError } = await supabase.from('questions').insert({
        subject_id: subjectId,
        type: 'mcq',
        content: 'Filtered Question',
        difficulty: 'medium',
        created_by: TEST_USERS.TEACHER.id,
      });
      if (insertError) throw new Error(`Failed to insert question: ${insertError.message}`);

      const req = createNextRequest(`http://localhost/api/v1/questions?subjectId=${subjectId}`);
      const response = await GET_LIST(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.length).toBe(1);
      expect(body.data[0].content).toBe('Filtered Question');
    });

    it('filters by type', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createRealClient();
      await supabase.from('questions').insert({
        type: 'true_false',
        content: 'True or False?',
        difficulty: 'easy',
        created_by: TEST_USERS.TEACHER.id,
      });

      const req = createNextRequest('http://localhost/api/v1/questions?type=true_false');
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

      const supabase = createRealClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'Get Me',
          difficulty: 'easy',
          created_by: TEST_USERS.TEACHER.id,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${question.id}`,
        { id: question.id },
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

      const supabase = createRealClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'Original',
          difficulty: 'easy',
          created_by: TEST_USERS.TEACHER.id,
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
      );
      const response = await PUT(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.content).toBe('Updated');
    });

    it('returns 403 when updating another user question', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createRealClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'Teacher Question',
          difficulty: 'easy',
          created_by: TEST_USERS.TEACHER.id,
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

      const supabase = createRealClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'To Delete',
          difficulty: 'easy',
          created_by: TEST_USERS.TEACHER.id,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${question.id}`,
        { id: question.id },
        { method: 'DELETE' },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 when deleting another user question', async () => {
      mockUser(TEST_USERS.UNIVERSITY_ADMIN);

      const supabase = createRealClient();
      const { data: question } = await supabase
        .from('questions')
        .insert({
          type: 'mcq',
          content: 'Teacher Question',
          difficulty: 'easy',
          created_by: TEST_USERS.TEACHER.id,
        })
        .select()
        .single();

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/questions/${question.id}`,
        { id: question.id },
        { method: 'DELETE' },
      );
      const response = await DELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.success).toBe(false);
    });
  });
});
