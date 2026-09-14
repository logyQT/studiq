import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as studentGet } from '@/app/(backend)/api/v1/stats/student/route';
import { GET as teacherGet } from '@/app/(backend)/api/v1/stats/teacher/route';
import {
  before,
  type BeforeResult,
} from '#test/helpers/test-user';
import {
  cleanupFlashcards,
  cleanupQuestions,
  cleanupQuizAttempts,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

describe('Stats Integration', () => {
  let teacher!: BeforeResult;
  let student!: BeforeResult;

  beforeAll(async () => {
    // Fresh educator with exactly 3 API-created questions + fresh student.
    teacher = await before({ role: 'educator', questions: 3 });
    student = await before({ role: 'student' });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    for (const user of [teacher.user, student.user]) {
      await cleanupQuestions(user.id, 'seed-question-');
      await cleanupFlashcards(user.id);
      await cleanupQuizAttempts(user.id);
    }
  });

  describe('GET /api/v1/stats/teacher', () => {
    it('returns teacher stats', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/stats/teacher');
      const response = await teacherGet(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalQuestions).toBeDefined();
      expect(body.data.totalFlashcards).toBeDefined();
    });

    it('returns teacher stats with question details', async () => {
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/stats/teacher');
      const response = await teacherGet(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.totalQuestions).toBe(3);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/stats/teacher');
      const response = await teacherGet(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/stats/student', () => {
    it('returns student stats', async () => {
      mockUser(student.user);

      const req = createNextRequest('http://localhost/api/v1/stats/student');
      const response = await studentGet(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalQuizzes).toBeDefined();
      expect(body.data.avgScore).toBeDefined();
      expect(body.data.flashcardsPracticed).toBeDefined();
    });

    it('returns zero stats when no data exists', async () => {
      mockUser(student.user);

      const req = createNextRequest('http://localhost/api/v1/stats/student');
      const response = await studentGet(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.totalQuizzes).toBe(0);
      expect(body.data.avgScore).toBe(0);
      expect(body.data.flashcardsPracticed).toBe(0);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/stats/student');
      const response = await studentGet(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });
});