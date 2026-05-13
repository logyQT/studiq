import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '@/app/(backend)/api/v1/quizzes/route';
import { TEST_USERS, mockUser, cleanupQuizAttempts, cleanupQuestions } from './helpers';
import { createClient } from '@/lib/supabase/server';
import { createNextRequest } from './test-utils';

describe('Quizzes Integration', () => {
  let subjectId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupQuizAttempts(user.id);
      await cleanupQuestions(user.id);
    }

    const supabase = await createClient();
    const { data: subject } = await supabase
      .from('subjects')
      .insert({ name: 'Quiz Test Subject', created_by: TEST_USERS.TEACHER.id })
      .select()
      .single();
    subjectId = subject.id;

    for (let i = 0; i < 5; i++) {
      await supabase.from('questions').insert({
        subject_id: subjectId,
        type: 'mcq',
        content: `Quiz Question ${i}`,
        difficulty: 'easy',
        created_by: TEST_USERS.TEACHER.id,
      });
    }
  });

  describe('POST /api/v1/quizzes', () => {
    it('generates a quiz and returns 201', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectId,
          questionTypes: ['mcq'],
          difficulty: 'easy',
          questionCount: 3,
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.questions).toBeDefined();
      expect(body.data.questions.length).toBeLessThanOrEqual(3);
    });

    it('generates a quiz without subjectId', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['mcq'],
          questionCount: 2,
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['mcq'],
          questionCount: 3,
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });

    it('returns 422 when questionTypes is empty', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: [],
          questionCount: 3,
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 404 when no matching questions exist', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['open'],
          questionCount: 3,
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.success).toBe(false);
    });

    it('generates quiz as free user', async () => {
      mockUser(TEST_USERS.FREE);

      const req = createNextRequest('http://localhost/api/v1/quizzes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['mcq'],
          questionCount: 2,
        }),
      });

      const response = await POST(req);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });
  });
});
