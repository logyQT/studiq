import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupFlashcardDecks,
  cleanupFlashcardPractice,
  cleanupFlashcardReviewState,
  cleanupFlashcards,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { POST as logPractice } from '@/app/(backend)/api/v1/flashcards/[id]/practice/route';
import { GET as getStatsForCard } from '@/app/(backend)/api/v1/flashcards/[id]/practice/stats/route';
import { GET as getCardsStats } from '@/app/(backend)/api/v1/flashcards/practice/cards-stats/route';
import { GET as getDueBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/due/breakdown/route';
import { GET as getDueCount } from '@/app/(backend)/api/v1/flashcards/practice/due/count/route';
import { GET as getDueCards } from '@/app/(backend)/api/v1/flashcards/practice/new/route';
import { GET as getStateBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/states/route';
import { GET as getStatsAll } from '@/app/(backend)/api/v1/flashcards/practice/stats/route';

forEachCopy((copyId) => {
  describe(`Flashcard Practice Integration [${copyId}]`, () => {
    registerMock(copyId, null);

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
      applyRegisteredMock(copyId);
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

      it('grades a new card Good (confidenceLevel 3) into learning step 1 / 10 min / EF 2.36', async () => {
        mockUser(student.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
          { id: flashcardId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wasCorrect: true, confidenceLevel: 3 }),
          },
        );

        const response = await logPractice(request, { params });
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.data.reviewState.learning_state).toBe('learning');
        expect(body.data.reviewState.learning_step).toBe(1);
        expect(body.data.reviewState.interval_days).toBe(10);
        expect(body.data.reviewState.easiness_factor).toBe(2.36);
      });

      it('grades a new card Again (confidenceLevel 1) into learning step 0 / 1 min / EF 1.7', async () => {
        mockUser(student.user);

        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
          { id: flashcardId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wasCorrect: false, confidenceLevel: 1 }),
          },
        );

        const response = await logPractice(request, { params });
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.data.reviewState.learning_state).toBe('learning');
        expect(body.data.reviewState.learning_step).toBe(0);
        expect(body.data.reviewState.interval_days).toBe(1);
        expect(body.data.reviewState.easiness_factor).toBe(1.7);
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

        const request = createNextRequest(
          `http://localhost/api/v1/flashcards/practice/new?limit=10`,
        );

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

    describe('GET /api/v1/flashcards/practice/states (#395)', () => {
      let kpi!: BeforeResult;

      beforeAll(async () => {
        // Own deck + 2 cards, so the `created_by` scope is exactly this user.
        kpi = await before({ role: 'student', decks: 1, flashcards: 2 });
      });

      afterAll(async () => {
        await cleanupFlashcardPractice(kpi.user.id);
        await cleanupFlashcardReviewState(kpi.user.id);
        await cleanupFlashcards(kpi.user.id);
        await cleanupFlashcardDecks(kpi.user.id);
      });

      async function fetchStates() {
        mockUser(kpi.user);
        const response = await getStateBreakdown(
          createNextRequest('http://localhost/api/v1/flashcards/practice/states'),
        );
        const body = await response.json();
        expect(response.status).toBe(200);
        return body.data;
      }

      it('reports collection-wide KPIs that a state filter cannot move', async () => {
        const [cardA, cardB] = kpi.created.flashcards;

        const practice = async (flashcardId: string, wasCorrect: boolean) => {
          mockUser(kpi.user);
          const { request, params } = createNextRequestWithParams(
            `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
            { id: flashcardId },
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ wasCorrect }),
            },
          );
          const response = await logPractice(request, { params });
          expect(response.status).toBe(201);
          const body = await response.json();
          return body.data.reviewState as { easiness_factor: number };
        };

        // Card A: correct + wrong -> 50%. Card B: correct -> 100%.
        await practice(cardA, true);
        const stateA = await practice(cardA, false);
        const stateB = await practice(cardB, true);

        const states = await fetchStates();

        expect(states).toMatchObject({
          totalCards: 2,
          practicedCards: 2,
          averageAccuracy: 75,
        });
        expect(states.averageEasinessFactor).toBe(
          Math.round(((stateA.easiness_factor + stateB.easiness_factor) / 2) * 100) / 100,
        );

        // STU-42: the state filter scopes the table only, never the KPI row.
        mockUser(kpi.user);
        const filteredResponse = await getCardsStats(
          createNextRequest(
            'http://localhost/api/v1/flashcards/practice/cards-stats?state=new&limit=100',
          ),
        );
        const filtered = await filteredResponse.json();

        expect(filteredResponse.status).toBe(200);
        expect(filtered.data.items).toHaveLength(0);
        expect(await fetchStates()).toEqual(states);
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
});
