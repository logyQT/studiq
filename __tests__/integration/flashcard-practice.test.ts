import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as logPractice } from '@/app/(backend)/api/v1/flashcards/[id]/practice/route';
import { GET as getStatsForCard } from '@/app/(backend)/api/v1/flashcards/[id]/practice/stats/route';
import { GET as getDueBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/due/breakdown/route';
import { GET as getDueCount } from '@/app/(backend)/api/v1/flashcards/practice/due/count/route';
import { GET as getDueCards } from '@/app/(backend)/api/v1/flashcards/practice/due/route';
import { GET as getStatsAll } from '@/app/(backend)/api/v1/flashcards/practice/stats/route';
import {
  cleanupFlashcardPractice,
  cleanupFlashcardReviewState,
  cleanupFlashcards,
  createServiceClient,
  mockUser,
  TEST_USERS,
} from './helpers';
import { createNextRequest, createNextRequestWithParams } from './test-utils';

describe('Flashcard Practice Integration', () => {
  let flashcardId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    for (const user of Object.values(TEST_USERS)) {
      await cleanupFlashcardPractice(user.id);
      await cleanupFlashcardReviewState(user.id);
      await cleanupFlashcards(user.id, 'practice-');
    }

    const supabase = createServiceClient();
    const { data: fc } = await supabase
      .from('flashcards')
      .insert({
        front: 'practice-Practice Card',
        back: 'Answer',
        created_by: TEST_USERS.TEACHER.id,
      })
      .select()
      .single();
    flashcardId = fc.id;
  });

  describe('POST /api/v1/flashcards/{id}/practice', () => {
    it('logs practice and returns 201 with practice + reviewState', async () => {
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
      expect(body.data.practice).toBeDefined();
      expect(body.data.reviewState).toBeDefined();
      expect(body.data.reviewState.easiness_factor).toBeGreaterThan(0);
      expect(body.data.reviewState.interval_days).toBeGreaterThanOrEqual(1);
    });

    it('logs practice with optional fields and returns 201', async () => {
      mockUser(TEST_USERS.STUDENT);

      const sessionId = '00000000-0000-4000-8000-000000000001';

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wasCorrect: true,
            responseTimeMs: 1500,
            confidenceLevel: 4,
            sessionId,
          }),
        },
      );

      const response = await logPractice(request, { params });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.practice.response_time_ms).toBe(1500);
      expect(body.data.practice.confidence_level).toBe(4);
      expect(body.data.practice.session_id).toBe(sessionId);
      expect(body.data.reviewState).toBeDefined();
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

    it('increments interval on consecutive correct answers (SM-2)', async () => {
      mockUser(TEST_USERS.STUDENT);

      // First correct review
      const { request: req1, params: params1 } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wasCorrect: true, confidenceLevel: 4 }),
        },
      );
      const res1 = await logPractice(req1, { params: params1 });
      const body1 = await res1.json();
      expect(body1.data.reviewState.interval_days).toBe(1);
      expect(body1.data.reviewState.repetitions).toBe(1);

      // Second correct review -> interval=6
      const { request: req2, params: params2 } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wasCorrect: true, confidenceLevel: 4 }),
        },
      );
      const res2 = await logPractice(req2, { params: params2 });
      const body2 = await res2.json();
      expect(body2.data.reviewState.interval_days).toBe(6);
      expect(body2.data.reviewState.repetitions).toBe(2);

      // Incorrect review -> resets
      const { request: req3, params: params3 } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
        { id: flashcardId },
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wasCorrect: false }),
        },
      );
      const res3 = await logPractice(req3, { params: params3 });
      const body3 = await res3.json();
      expect(body3.data.reviewState.interval_days).toBe(1);
      expect(body3.data.reviewState.repetitions).toBe(0);
    });
  });

  describe('GET /api/v1/flashcards/practice/due', () => {
    it('returns due flashcards for user', async () => {
      mockUser(TEST_USERS.STUDENT);

      const request = createNextRequest(`http://localhost/api/v1/flashcards/practice/due?limit=10`);

      const response = await getDueCards(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('filters by topicIds', async () => {
      mockUser(TEST_USERS.STUDENT);

      const request = createNextRequest(
        `http://localhost/api/v1/flashcards/practice/due?topicIds=00000000-0000-4000-8000-000000000001`,
      );

      const response = await getDueCards(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const request = createNextRequest(`http://localhost/api/v1/flashcards/practice/due`);

      const response = await getDueCards(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/practice/due/breakdown', () => {
    it('returns due breakdown', async () => {
      mockUser(TEST_USERS.STUDENT);

      const request = createNextRequest(
        `http://localhost/api/v1/flashcards/practice/due/breakdown`,
      );

      const response = await getDueBreakdown(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(typeof body.data.total).toBe('number');
      expect(typeof body.data.byTopic).toBe('object');
      expect(typeof body.data.byDeck).toBe('object');
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const request = createNextRequest(
        `http://localhost/api/v1/flashcards/practice/due/breakdown`,
      );

      const response = await getDueBreakdown(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/practice/due/count', () => {
    it('returns due count', async () => {
      mockUser(TEST_USERS.STUDENT);

      const request = createNextRequest(`http://localhost/api/v1/flashcards/practice/due/count`);

      const response = await getDueCount(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(typeof body.data.count).toBe('number');
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const request = createNextRequest(`http://localhost/api/v1/flashcards/practice/due/count`);

      const response = await getDueCount(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/{id}/practice/stats', () => {
    it('returns stats for flashcard', async () => {
      mockUser(TEST_USERS.STUDENT);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice/stats`,
        { id: flashcardId },
      );

      const response = await getStatsForCard(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalAttempts).toBeDefined();
      expect(body.data.correctRate).toBeDefined();
      expect(body.data.averageResponseTimeMs).toBeDefined();
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const { request, params } = createNextRequestWithParams(
        `http://localhost/api/v1/flashcards/${flashcardId}/practice/stats`,
        { id: flashcardId },
      );

      const response = await getStatsForCard(request, { params });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/practice/stats', () => {
    it('returns aggregate stats', async () => {
      mockUser(TEST_USERS.TEACHER);

      const response = await getStatsAll();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalPracticed).toBeDefined();
      expect(body.data.totalDue).toBeDefined();
      expect(body.data.totalCardsReviewed).toBeDefined();
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
