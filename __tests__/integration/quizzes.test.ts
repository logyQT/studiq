import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/(backend)/api/v1/quiz/new/route';
import {
  before,
  type BeforeResult,
} from '#test/helpers/test-user';
import {
  cleanupQuestions,
  cleanupQuizAttempts,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

describe('Quizzes Integration', () => {
  let student!: BeforeResult;

  beforeAll(async () => {
    // Fresh student + 5 personal mcq questions seeded through the real
    // question API (bank created implicitly via the question-banks API).
    student = await before({ role: 'student', questions: 5 });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupQuizAttempts(student.user.id);
  });

  afterAll(async () => {
    await cleanupQuizAttempts(student.user.id);
    await cleanupQuestions(student.user.id, 'seed-question-');
  });

  describe('POST /api/v1/quizzes', () => {
    it('generates a quiz and returns 201', async () => {
      mockUser(student.user);

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
      mockUser(student.user);

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
      mockUser(student.user);

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
      mockUser(student.user);

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