import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as studentGet } from '@/app/(backend)/api/v1/stats/student/route';
import { GET as teacherGet } from '@/app/(backend)/api/v1/stats/teacher/route';
import {
  cleanupFlashcards,
  cleanupQuestions,
  cleanupQuizAttempts,
  cleanupSubjects,
  createServiceClient,
  mockUser,
  TEST_USERS,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

describe('Stats Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupSubjects(user.id, 'stats-');
      await cleanupQuestions(user.id);
      await cleanupFlashcards(user.id);
      await cleanupQuizAttempts(user.id);
    }
  });

  describe('GET /api/v1/stats/teacher', () => {
    it('returns teacher stats', async () => {
      mockUser(TEST_USERS.TEACHER);

      const req = createNextRequest('http://localhost/api/v1/stats/teacher');
      const response = await teacherGet(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalQuestions).toBeDefined();
      expect(body.data.totalFlashcards).toBeDefined();
    });

    it('returns teacher stats with question details', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = createServiceClient();
      for (let i = 0; i < 3; i++) {
        const { error } = await supabase.from('questions').insert({
          type: 'mcq',
          content: `stats-Stats Question ${i}`,
          created_by: TEST_USERS.TEACHER.id,
        });
        if (error) throw new Error(`Failed to create question ${i}: ${error.message}`);
      }

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
      mockUser(TEST_USERS.STUDENT);

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
      mockUser(TEST_USERS.STUDENT);

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
