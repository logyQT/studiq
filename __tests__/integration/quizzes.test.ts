import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/(backend)/api/v1/quiz/new/route';
import {
  cleanupQuestions,
  cleanupQuizAttempts,
  cleanupSubjects,
  mockUser,
  seedQuestion,
  TEST_USERS,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

describe('Quizzes Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupQuizAttempts(user.id);
      await cleanupQuestions(user.id, 'quiz-');
      await cleanupSubjects(user.id, 'quiz-');
    }

    for (let i = 0; i < 5; i++) {
      await seedQuestion({
        type: 'mcq',
        content: `quiz-Quiz Question ${i}`,
        created_by: TEST_USERS.STUDENT.id,
      });
    }
  });

  describe('POST /api/v1/quizzes', () => {
    it('generates a quiz and returns 201', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionTypes: ['mcq'],
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

    it('generates a quiz without optional fields', async () => {
      mockUser(TEST_USERS.STUDENT);

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
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

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
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

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
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

      const req = createNextRequest('http://localhost/api/v1/quiz/new', {
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
  });
});
