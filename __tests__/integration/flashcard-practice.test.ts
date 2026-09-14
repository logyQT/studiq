import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as logPractice } from '@/app/(backend)/api/v1/flashcards/[id]/practice/route';
import { GET as getStatsForCard } from '@/app/(backend)/api/v1/flashcards/[id]/practice/stats/route';
import { GET as getDueBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/due/breakdown/route';
import { GET as getDueCount } from '@/app/(backend)/api/v1/flashcards/practice/due/count/route';
import { GET as getDueCards } from '@/app/(backend)/api/v1/flashcards/practice/new/route';
import { GET as getStatsAll } from '@/app/(backend)/api/v1/flashcards/practice/stats/route';
import {
  before,
  type BeforeResult,
} from '#test/helpers/test-user';
import {
  cleanupFlashcardPractice,
  cleanupFlashcardReviewState,
  cleanupFlashcards,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';

describe('Flashcard Practice Integration', () => {
  let teacher!: BeforeResult;
  let student!: BeforeResult;
  let flashcardId: string;

  beforeAll(async () => {
    // Fresh educator with a deck + flashcard (created via the real API).
    teacher = await before({ role: 'educator', decks: 1, flashcards: 1 });
    flashcardId = teacher.created.flashcards[0];
    // Fresh student who practices the teacher's card.
    student = await before({ role: 'student' });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupFlashcardPractice(student.user.id);
    await cleanupFlashcardReviewState(student.user.id);
    await cleanupFlashcardPractice(teacher.user.id);
    await cleanupFlashcardReviewState(teacher.user.id);
  });

  afterAll(async () => {
    await cleanupFlashcardPractice(student.user.id);
    await cleanupFlashcardReviewState(student.user.id);
    await cleanupFlashcards(teacher.user.id);
  });

  describe('POST /api/v1/flashcards/{id}/practice', () => {
    it('logs practice and returns 201 with practice + reviewState', async () => {
      mockUser(student.user);

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
      mockUser(student.user);

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
      mockUser(student.user);

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

  describe('GET /api/v1/flashcards/practice/new', () => {
    it('returns new flashcards for user', async () => {
      mockUser(student.user);

      const request = createNextRequest(`http://localhost/api/v1/flashcards/practice/new?limit=10`);

      const response = await getDueCards(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const request = createNextRequest(`http://localhost/api/v1/flashcards/practice/new`);

      const response = await getDueCards(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/v1/flashcards/practice/due/breakdown', () => {
    it('returns due breakdown', async () => {
      mockUser(student.user);

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
      mockUser(student.user);

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
      mockUser(student.user);

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
      mockUser(teacher.user);

      const req = createNextRequest('http://localhost/api/v1/flashcards/practice/stats');
      const response = await getStatsAll(req);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.totalPracticed).toBeDefined();
      expect(body.data.totalDue).toBeDefined();
      expect(body.data.totalCardsReviewed).toBeDefined();
    });

    it('returns 401 when not authenticated', async () => {
      mockUser(null);

      const req = createNextRequest('http://localhost/api/v1/flashcards/practice/stats');
      const response = await getStatsAll(req);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.success).toBe(false);
    });
  });
});