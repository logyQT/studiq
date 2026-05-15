import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as logPractice, GET as getHistoryForCard } from '@/app/(backend)/api/v1/flashcards/[id]/practice/route';
import { GET as getAllHistory } from '@/app/(backend)/api/v1/flashcards/practice/route';
import { GET as getStatsForCard } from '@/app/(backend)/api/v1/flashcards/[id]/practice/stats/route';
import { GET as getStatsAll } from '@/app/(backend)/api/v1/flashcards/practice/stats/route';
import { TEST_USERS, mockUser, cleanupFlashcardPractice, cleanupFlashcards, createServiceClient } from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Flashcard Practice Integration', () => {
  let flashcardId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcardPractice(user.id);
      await cleanupFlashcards(user.id, 'practice-');
    }

    const supabase = createServiceClient();
    const { data: fc } = await supabase
      .from('flashcards')
      .insert({ front: 'practice-Practice Card', back: 'Answer', created_by: TEST_USERS.TEACHER.id })
      .select()
      .single();
    flashcardId = fc.id;
  });

  describe('POST /api/v1/flashcards/{id}/practice', () => {
    it('logs practice and returns 201', async () => {
      mockUser(TEST_USERS.STUDENT);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wasCorrect: true }),
        },
      );

      const response = await logPractice(request, { params });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
    });

    it('logs practice with optional fields and returns 201', async () => {
      mockUser(TEST_USERS.STUDENT);

      const sessionId = '00000000-0000-0000-0000-000000000001';

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wasCorrect: true, responseTimeMs: 1500, confidenceLevel: 4, sessionId }),
        },
      );

      const response = await logPractice(request, { params });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.response_time_ms).toBe(1500);
      expect(body.data.confidence_level).toBe(4);
      expect(body.data.session_id).toBe(sessionId);
    });

    it('returns 422 when wasCorrect is missing', async () => {
      mockUser(TEST_USERS.STUDENT);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ responseTimeMs: 1000 }),
        },
      );

      const response = await logPractice(request, { params });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.success).toBe(false);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wasCorrect: true }),
        },
      );

      const response = await logPractice(request, { params });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/{id}/practice', () => {
    it('returns practice history for user on specific flashcard', async () => {
      mockUser(TEST_USERS.STUDENT);

      const supabase = createServiceClient();
      await supabase
        .from('flashcard_practice')
        .insert({ user_id: TEST_USERS.STUDENT.id, flashcard_id: flashcardId, was_correct: true });

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
      );

      const response = await getHistoryForCard(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(1);
    });

    it('returns empty array when no practice exists for card', async () => {
      mockUser(TEST_USERS.STUDENT);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
      );

      const response = await getHistoryForCard(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
      );

      const response = await getHistoryForCard(request, { params });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/practice', () => {
    it('returns all practice history for user', async () => {
      mockUser(TEST_USERS.STUDENT);

      const response = await getAllHistory();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns empty array when no practice exists', async () => {
      mockUser(TEST_USERS.PREMIUM);

      const response = await getAllHistory();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const response = await getAllHistory();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/{id}/practice/stats', () => {
    it('returns 501 not implemented', async () => {
      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice/stats`,
        { id: flashcardId },
      );

      const response = await getStatsForCard(request, { params });
      const body = await response.json();

      expect(response.status).toBe(501);
      expect(body.success).toBe(false);
      expect(body.error).toBe('NOT_IMPLEMENTED');
    });
  });

  describe('GET /api/v1/flashcards/practice/stats', () => {
    it('returns 501 not implemented', async () => {
      mockUser(TEST_USERS.TEACHER);

      const response = await getStatsAll();
      const body = await response.json();

      expect(response.status).toBe(501);
      expect(body.success).toBe(false);
      expect(body.error).toBe('NOT_IMPLEMENTED');
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const response = await getStatsAll();
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });
});
