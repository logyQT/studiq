import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupFlashcardDecks,
  cleanupFlashcardPractice,
  cleanupFlashcardReviewState,
  cleanupFlashcards,
  createServiceClient,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest, createNextRequestWithParams } from '#test/integration/test-utils';
import { POST as logPractice } from '@/app/(backend)/api/v1/flashcards/[id]/practice/route';
import { GET as getStatsForCard } from '@/app/(backend)/api/v1/flashcards/[id]/practice/stats/route';
import { POST as batchPractice } from '@/app/(backend)/api/v1/flashcards/batch/[action]/route';
import { GET as getCardsStats } from '@/app/(backend)/api/v1/flashcards/practice/cards-stats/route';
import { GET as getDueBreakdown } from '@/app/(backend)/api/v1/flashcards/practice/due/breakdown/route';
import { GET as getDueCount } from '@/app/(backend)/api/v1/flashcards/practice/due/count/route';
import { GET as getDueCards } from '@/app/(backend)/api/v1/flashcards/practice/new/route';
import { GET as getReviewCards } from '@/app/(backend)/api/v1/flashcards/practice/review/route';
import { POST as completeSession } from '@/app/(backend)/api/v1/flashcards/practice/sessions/complete/route';
import { GET as getSettings } from '@/app/(backend)/api/v1/flashcards/practice/settings/route';
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

    describe('GET /api/v1/flashcards/practice/cards-stats interval unit (#341)', () => {
      let units!: BeforeResult;

      beforeAll(async () => {
        // Own deck + 2 cards, so the `created_by` scope is exactly this user.
        units = await before({ role: 'student', decks: 1, flashcards: 2 });
      });

      afterAll(async () => {
        await cleanupFlashcardPractice(units.user.id);
        await cleanupFlashcardReviewState(units.user.id);
        await cleanupFlashcards(units.user.id);
        await cleanupFlashcardDecks(units.user.id);
      });

      async function practice(flashcardId: string, confidenceLevel: number) {
        mockUser(units.user);
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
          { id: flashcardId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wasCorrect: confidenceLevel >= 3, confidenceLevel }),
          },
        );
        const response = await logPractice(request, { params });
        const body = await response.json();
        expect(response.status).toBe(201);
        return body.data.reviewState as {
          learning_state: string;
          interval_days: number;
          interval_unit: string;
        };
      }

      it('persists the unit alongside the magnitude so 1 min and 1 day stay distinct', async () => {
        const [cardA, cardB] = units.created.flashcards;

        // A: „Łatwe” -> review card, one day.
        const stateA = await practice(cardA, 4);
        expect(stateA).toMatchObject({
          learning_state: 'review',
          interval_days: 1,
          interval_unit: 'days',
        });

        // B: „Nie pamiętam” -> learning step, one minute.
        const stateB = await practice(cardB, 1);
        expect(stateB).toMatchObject({
          learning_state: 'learning',
          interval_days: 1,
          interval_unit: 'minutes',
        });

        mockUser(units.user);
        const response = await getCardsStats(
          createNextRequest('http://localhost/api/v1/flashcards/practice/cards-stats?limit=100'),
        );
        const body = await response.json();
        expect(response.status).toBe(200);

        const items = body.data.items as Array<Record<string, unknown>>;
        const itemA = items.find((i) => i.id === cardA);
        const itemB = items.find((i) => i.id === cardB);

        expect(itemA).toMatchObject({
          state: 'review',
          intervalValue: 1,
          intervalUnit: 'days',
        });
        expect(itemB).toMatchObject({
          state: 'learning',
          intervalValue: 1,
          intervalUnit: 'minutes',
        });
        expect(items.every((i) => !('intervalDays' in i))).toBe(true);
      });
    });

    describe('cram mode (#617)', () => {
      let cram!: BeforeResult;

      beforeAll(async () => {
        cram = await before({ role: 'student', decks: 1, flashcards: 1 });
      });

      afterAll(async () => {
        const service = createServiceClient();
        await service.from('flashcard_study_sessions').delete().eq('user_id', cram.user.id);
        await cleanupFlashcardPractice(cram.user.id);
        await cleanupFlashcardReviewState(cram.user.id);
        await cleanupFlashcards(cram.user.id);
        await cleanupFlashcardDecks(cram.user.id);
      });

      async function postBatch(body: unknown) {
        mockUser(cram.user);
        const { request, params } = createNextRequestWithParams(
          'http://localhost/api/v1/flashcards/batch/practice',
          { action: 'practice' },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        const response = await batchPractice(request, { params });
        return { status: response.status, body: await response.json() };
      }

      async function readSettings(): Promise<{ remainingNewCards: number }> {
        mockUser(cram.user);
        const response = await getSettings(
          createNextRequest('http://localhost/api/v1/flashcards/practice/settings'),
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        return body.data;
      }

      async function readCardStats(flashcardId: string) {
        mockUser(cram.user);
        const response = await getCardsStats(
          createNextRequest('http://localhost/api/v1/flashcards/practice/cards-stats?limit=100'),
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        const items = body.data.items as Array<Record<string, unknown>>;
        return items.find((i) => i.id === flashcardId);
      }

      async function countRows(table: string, flashcardId?: string) {
        const service = createServiceClient();
        let query = service
          .from(table)
          .select('user_id', { count: 'exact', head: true })
          .eq('user_id', cram.user.id);
        if (flashcardId) query = query.eq('flashcard_id', flashcardId);
        const { count, error } = await query;
        expect(error).toBeNull();
        return count ?? 0;
      }

      async function readReviewsCount() {
        const service = createServiceClient();
        const { data } = await service
          .from('user_daily_activity')
          .select('reviews_count')
          .eq('user_id', cram.user.id)
          .maybeSingle();
        return (data?.reviews_count as number | undefined) ?? 0;
      }

      it('acceptance 1–3: a cram answer writes no practice row, no review state and burns no budget', async () => {
        const flashcardId = cram.created.flashcards[0];

        // Baseline.
        const baselineSettings = await readSettings();
        expect(await readCardStats(flashcardId)).toMatchObject({
          state: 'new',
          nextReviewAt: null,
          easinessFactor: null,
        });
        const baselinePractice = await countRows('flashcard_practice');
        const baselineReviews = await readReviewsCount();

        const { status, body } = await postBatch({
          mode: 'cram',
          items: [
            {
              flashcardId,
              wasCorrect: true,
              confidenceLevel: 3,
              sessionId: '00000000-0000-4000-8000-000000000617',
            },
          ],
        });

        expect(status).toBe(200);
        expect(body.data).toEqual({ success: true, results: [] });

        // Nothing was written, and the card is still brand new.
        expect(await countRows('flashcard_practice')).toBe(baselinePractice);
        expect(await countRows('flashcard_review_state', flashcardId)).toBe(0);
        expect(await readReviewsCount()).toBe(baselineReviews);
        expect((await readSettings()).remainingNewCards).toBe(baselineSettings.remainingNewCards);
        expect(await readCardStats(flashcardId)).toMatchObject({
          state: 'new',
          nextReviewAt: null,
          easinessFactor: null,
        });
      });

      it('acceptance 4: a finished cram session still writes exactly one study-session row', async () => {
        const sessionId = '00000000-0000-4000-8000-000000000618';
        const startedAt = new Date(Date.now() - 60_000).toISOString();

        mockUser(cram.user);
        const response = await completeSession(
          createNextRequest('http://localhost/api/v1/flashcards/practice/sessions/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              startedAt,
              completedAt: new Date().toISOString(),
              durationMs: 60_000,
              cardsStudied: 1,
              cardsCorrect: 1,
              deckIds: cram.created.decks,
              mode: 'cram',
            }),
          }),
        );
        expect(response.status).toBe(200);

        const service = createServiceClient();
        const { data } = await service
          .from('flashcard_study_sessions')
          .select('id, mode, cards_studied')
          .eq('user_id', cram.user.id)
          .eq('id', sessionId);

        expect(data).toHaveLength(1);
        expect(data?.[0]).toMatchObject({ mode: 'cram', cards_studied: 1 });
      });

      it('rejects an unknown mode with 422', async () => {
        const { status, body } = await postBatch({
          mode: 'bogus',
          items: [{ flashcardId: cram.created.flashcards[0], wasCorrect: true }],
        });

        expect(status).toBe(422);
        expect(body.success).toBe(false);
      });

      it('review mode is unchanged: the same batch without mode writes practice + review state', async () => {
        const flashcardId = cram.created.flashcards[0];
        const baselinePractice = await countRows('flashcard_practice');

        const { status, body } = await postBatch({
          items: [{ flashcardId, wasCorrect: true, confidenceLevel: 3 }],
        });

        expect(status).toBe(200);
        expect(body.data.results).toHaveLength(1);
        expect(await countRows('flashcard_practice')).toBe(baselinePractice + 1);
        expect(await countRows('flashcard_review_state', flashcardId)).toBe(1);
      });
    });

    describe('cram RPC shape (#617)', () => {
      let rpcUser!: BeforeResult;

      beforeAll(async () => {
        rpcUser = await before({ role: 'student', decks: 1, flashcards: 1 });
      });

      afterAll(async () => {
        await cleanupFlashcardPractice(rpcUser.user.id);
        await cleanupFlashcardReviewState(rpcUser.user.id);
        await cleanupFlashcards(rpcUser.user.id);
        await cleanupFlashcardDecks(rpcUser.user.id);
      });

      it('get_due_flashcards reports intervalValue/intervalUnit instead of intervalDays', async () => {
        const flashcardId = rpcUser.created.flashcards[0];

        // Create the review state through the real route, then make it due.
        mockUser(rpcUser.user);
        const { request, params } = createNextRequestWithParams(
          `http://localhost/api/v1/flashcards/${flashcardId}/practice`,
          { id: flashcardId },
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wasCorrect: true, confidenceLevel: 3 }),
          },
        );
        expect((await logPractice(request, { params })).status).toBe(201);

        const service = createServiceClient();
        const { error } = await service
          .from('flashcard_review_state')
          .update({
            next_review_at: new Date(Date.now() - 60_000).toISOString(),
            interval_days: 10,
            interval_unit: 'minutes',
          })
          .eq('user_id', rpcUser.user.id)
          .eq('flashcard_id', flashcardId);
        expect(error).toBeNull();

        mockUser(rpcUser.user);
        const response = await getReviewCards(
          createNextRequest('http://localhost/api/v1/flashcards/practice/review?limit=100'),
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        const cards = body.data as Array<{
          id: string;
          reviewState: Record<string, unknown> | null;
        }>;
        const card = cards.find((c) => c.id === flashcardId);

        expect(card?.reviewState).toMatchObject({
          intervalValue: 10,
          intervalUnit: 'minutes',
        });
        expect(card?.reviewState).not.toHaveProperty('intervalDays');
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
