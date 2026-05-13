import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET as teacherGet } from '@/app/(backend)/api/v1/stats/teacher/route';
import { GET as studentGet } from '@/app/(backend)/api/v1/stats/student/route';
import {
  TEST_USERS,
  mockUser,
  cleanupSubjects,
  cleanupQuestions,
  cleanupFlashcards,
  cleanupQuizAttempts,
} from './helpers';
import { createClient } from '@/lib/supabase/server';
import { createNextRequest } from './test-utils';

describe('Stats Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupSubjects(user.id);
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

    it('returns teacher stats with subject details', async () => {
      mockUser(TEST_USERS.TEACHER);

      const supabase = await createClient();
      const { data: subject } = await supabase
        .from('subjects')
        .insert({ name: 'Stats Subject', created_by: TEST_USERS.TEACHER.id })
        .select()
        .single();

      for (let i = 0; i < 3; i++) {
        await supabase.from('questions').insert({
          subject_id: subject.id,
          type: 'mcq',
          content: `Stats Question ${i}`,
          difficulty: 'easy',
          created_by: TEST_USERS.TEACHER.id,
        });
      }

      const req = createNextRequest(
        `http://localhost/api/v1/stats/teacher?subjectId=${subject.id}`,
      );
      const response = await teacherGet(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.subject).toBeDefined();
      expect(body.data.subject.totalQuestions).toBe(3);
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

      const response = await studentGet();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalQuizzes).toBeDefined();
      expect(body.data.avgScore).toBeDefined();
      expect(body.data.flashcardsPracticed).toBeDefined();
    });

    it('returns zero stats when no data exists', async () => {
      mockUser(TEST_USERS.PREMIUM);

      const response = await studentGet();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.totalQuizzes).toBe(0);
      expect(body.data.avgScore).toBe(0);
      expect(body.data.flashcardsPracticed).toBe(0);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const response = await studentGet();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });
});
