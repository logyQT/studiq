import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { FlashcardPracticeService } from '@/server/services/flashcard-practice.service';
import { success, failure } from '@/lib/service-result';
import type { RequestContext } from '@/lib/request-context';
import { AccountType } from '@/types';

vi.mock('@/lib/authz', () => ({
  buildQueryFilter: vi.fn().mockReturnValue({}),
  Permission: { FLASHCARD_READ: 'flashcard.read' as const },
}));

const ctx: RequestContext = {
  userId: 'test-user-id',
  accountType: AccountType.STUDENT,
  traceId: 't',
  url: 'http://localhost',
  method: 'POST',
  activeOrgId: null,
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

const defaultSettings = {
  learning_steps: [1, 10],
  leech_threshold: 8,
  new_cards_per_day: 20,
  new_cards_introduced: 0,
  daily_reset_date: new Date().toISOString().split('T')[0],
};

const defaultSettingsRow = { data: defaultSettings, error: null };

/** Creates a mock Supabase chain where all intermediate methods return the chain,
 *  terminal methods (single, maybeSingle) resolve with `terminal`,
 *  and the chain itself is thenable for `await query` patterns. */
function chain(terminal: any = { data: null, error: null }) {
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.single = vi.fn().mockResolvedValue(terminal);
  c.maybeSingle = vi.fn().mockResolvedValue(terminal);
  c.insert = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.then = (onfulfilled: any) => Promise.resolve(terminal).then(onfulfilled);
  return c;
}

function settingsChain(settings: any = defaultSettings) {
  const c = chain({ data: settings, error: null });
  c.update = vi.fn(() => c);
  return c;
}

describe('FlashcardPracticeService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const service = new FlashcardPracticeService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('log', () => {
    function setupMocks(practiceResult: any, existingState: any, upsertResult: any) {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: existingState, error: null });
      const getStateEq2Mock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const getStateEq1Mock = vi.fn().mockReturnValue({ eq: getStateEq2Mock });
      const getStateSelectMock = vi.fn().mockReturnValue({ eq: getStateEq1Mock });

      const upsertSingleMock = vi.fn().mockResolvedValue(upsertResult);
      const upsertSelectMock = vi.fn().mockReturnValue({ single: upsertSingleMock });
      const upsertMock = vi.fn().mockReturnValue({ select: upsertSelectMock });

      const practiceSingleMock = vi.fn().mockResolvedValue(practiceResult);
      const practiceSelectMock = vi.fn().mockReturnValue({ single: practiceSingleMock });
      const insertMock = vi.fn().mockReturnValue({ select: practiceSelectMock });

      mock.from.mockImplementation((table: string) => {
        if (table === 'flashcard_practice') return { insert: insertMock };
        if (table === 'flashcard_review_state')
          return { select: getStateSelectMock, upsert: upsertMock };
        if (table === 'user_study_settings')
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(defaultSettingsRow) }),
            }),
            update: vi
              .fn()
              .mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          };
        return chain();
      });
    }

    it('inserts practice record and returns it with review state', async () => {
      const mockPractice = {
        id: 'p-1',
        user_id: ctx.userId,
        flashcard_id: 'fc-1',
        was_correct: true,
      };
      const mockReviewState = {
        user_id: ctx.userId,
        flashcard_id: 'fc-1',
        easiness_factor: 2.6,
        interval_days: 1,
        repetitions: 1,
        next_review_at: new Date().toISOString(),
        last_reviewed_at: new Date().toISOString(),
        last_quality: 4,
      };

      setupMocks({ data: mockPractice, error: null }, null, { data: mockReviewState, error: null });

      const result = await service.log('fc-1', true, ctx);

      expect(result.success).toBe(true);
      expect(result.data.practice).toEqual(mockPractice);
      expect(result.data.reviewState).toEqual(mockReviewState);
    });

    it('inserts practice record with optional fields', async () => {
      const mockPractice = {
        id: 'p-1',
        user_id: ctx.userId,
        flashcard_id: 'fc-1',
        was_correct: true,
        response_time_ms: 1500,
        confidence_level: 4,
        session_id: 'session-1',
      };
      const mockReviewState = {
        user_id: ctx.userId,
        flashcard_id: 'fc-1',
        easiness_factor: 2.5,
        interval_days: 1,
        repetitions: 1,
      };

      setupMocks({ data: mockPractice, error: null }, null, { data: mockReviewState, error: null });

      const result = await service.log('fc-1', true, ctx, 1500, 4, 'session-1');

      expect(result.success).toBe(true);
      expect(result.data.practice).toEqual(mockPractice);
      expect(result.data.reviewState).toEqual(mockReviewState);
    });

    it('returns error on insert failure', async () => {
      const practiceSingleMock = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'DB error', code: 'PGRST116' } });
      const practiceSelectMock = vi.fn().mockReturnValue({ single: practiceSingleMock });
      const insertMock = vi.fn().mockReturnValue({ select: practiceSelectMock });

      mock.from.mockReturnValue({ insert: insertMock });

      const result = await service.log('fc-1', true, ctx);

      expect(result.success).toBe(false);
    });

    it('uses existing review state when available', async () => {
      const mockPractice = {
        id: 'p-1',
        user_id: ctx.userId,
        flashcard_id: 'fc-1',
        was_correct: true,
      };
      const existingState = {
        user_id: ctx.userId,
        flashcard_id: 'fc-1',
        easiness_factor: 2.5,
        interval_days: 6,
        repetitions: 1,
        next_review_at: new Date().toISOString(),
      };
      const updatedState = {
        ...existingState,
        easiness_factor: 2.5,
        interval_days: 15,
        repetitions: 2,
      };

      setupMocks({ data: mockPractice, error: null }, existingState, {
        data: updatedState,
        error: null,
      });

      const result = await service.log('fc-1', true, ctx, undefined, 4);

      expect(result.success).toBe(true);
      expect(result.data.practice).toEqual(mockPractice);
      expect(result.data.reviewState.repetitions).toBe(2);
      expect(result.data.reviewState.interval_days).toBeGreaterThan(6);
    });
  });

  describe('batch', () => {
    function setupBatchMocks(
      insertResults: Array<{ error: any }>,
      upsertResults: Array<{ data: any; error: any }>,
    ) {
      let insertCall = 0;
      const practiceInsert = vi.fn().mockImplementation(() => {
        const res = insertResults[insertCall];
        insertCall++;
        return res;
      });

      let upsertCall = 0;
      const upsertSingleMock = vi.fn().mockImplementation(() => {
        const res = upsertResults[upsertCall];
        upsertCall++;
        return Promise.resolve(res);
      });
      const upsertSelectMock = vi.fn().mockReturnValue({ single: upsertSingleMock });
      const upsertMock = vi.fn().mockReturnValue({ select: upsertSelectMock });

      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
      const eq2Mock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const eq1Mock = vi.fn().mockReturnValue({ eq: eq2Mock });
      const reviewSelectMock = vi.fn().mockReturnValue({ eq: eq1Mock });

      mock.from.mockImplementation((table: string) => {
        if (table === 'flashcard_practice') return { insert: practiceInsert };
        if (table === 'flashcard_review_state')
          return { select: reviewSelectMock, upsert: upsertMock };
        if (table === 'user_study_settings') {
          const c = settingsChain();
          return { select: vi.fn(() => c), update: vi.fn(() => c) };
        }
        return chain();
      });
    }

    it('returns results array with isLeech per card', async () => {
      setupBatchMocks(
        [{ error: null }, { error: null }],
        [
          { data: { is_leech: false, user_id: ctx.userId, flashcard_id: 'fc-1' }, error: null },
          { data: { is_leech: true, user_id: ctx.userId, flashcard_id: 'fc-2' }, error: null },
        ],
      );

      const result = await service.batch(
        {
          items: [
            { flashcardId: 'fc-1', wasCorrect: true, confidenceLevel: 3 },
            { flashcardId: 'fc-2', wasCorrect: true, confidenceLevel: 3 },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data.success).toBe(true);
      expect(result.data.results).toHaveLength(2);
      expect(result.data.results[0]).toEqual({ flashcardId: 'fc-1', isLeech: false });
      expect(result.data.results[1]).toEqual({ flashcardId: 'fc-2', isLeech: true });
    });

    it('returns error on failed insert', async () => {
      setupBatchMocks(
        [{ error: { message: 'DB error' } }, { error: null }],
        [{ data: { is_leech: false, user_id: ctx.userId, flashcard_id: 'fc-2' }, error: null }],
      );

      const result = await service.batch(
        {
          items: [
            { flashcardId: 'fc-1', wasCorrect: true },
            { flashcardId: 'fc-2', wasCorrect: true },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(false);
    });

    it('returns error on upsert failure', async () => {
      setupBatchMocks(
        [{ error: null }, { error: null }],
        [
          { data: null, error: { message: 'DB error' } },
          { data: { is_leech: false, user_id: ctx.userId, flashcard_id: 'fc-2' }, error: null },
        ],
      );

      const result = await service.batch(
        {
          items: [
            { flashcardId: 'fc-1', wasCorrect: true },
            { flashcardId: 'fc-2', wasCorrect: true },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(false);
    });
  });

  describe('getDueCards', () => {
    it('limits new cards by daily cap', async () => {
      const settings = { ...defaultSettings, new_cards_per_day: 5, new_cards_introduced: 3 };
      const c = settingsChain(settings);
      const rpcMock = vi.fn().mockResolvedValue({
        data: [
          { id: 'fc-1', front: 'q1', back: 'a1', createdAt: null, reviewState: null },
          { id: 'fc-2', front: 'q2', back: 'a2', createdAt: null, reviewState: null },
          {
            id: 'fc-3',
            front: 'q3',
            back: 'a3',
            createdAt: null,
            reviewState: { easiness_factor: 2.5 },
          },
        ],
        error: null,
      });

      mock.from.mockReturnValue({ select: vi.fn(() => c), update: vi.fn(() => c) });
      mock.rpc.mockImplementation(rpcMock);

      const result = await service.getDueCards(ctx, {});

      expect(mock.rpc).toHaveBeenCalledWith(
        'get_due_flashcards',
        expect.objectContaining({ p_new_card_limit: 2 }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
    });

    it('serves zero new cards when cap is exhausted', async () => {
      const settings = { ...defaultSettings, new_cards_per_day: 10, new_cards_introduced: 10 };
      const c = settingsChain(settings);
      const rpcMock = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'fc-3',
            front: 'q3',
            back: 'a3',
            createdAt: null,
            reviewState: { easiness_factor: 2.5 },
          },
        ],
        error: null,
      });

      mock.from.mockReturnValue({ select: vi.fn(() => c), update: vi.fn(() => c) });
      mock.rpc.mockImplementation(rpcMock);

      const result = await service.getDueCards(ctx, {});

      expect(mock.rpc).toHaveBeenCalledWith(
        'get_due_flashcards',
        expect.objectContaining({ p_new_card_limit: 0 }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('does not increment new_cards_introduced when fetching cards', async () => {
      const settings = { ...defaultSettings, new_cards_per_day: 20, new_cards_introduced: 5 };
      const c = settingsChain(settings);
      const tableUpdate = vi.fn(() => c);
      const rpcMock = vi.fn().mockResolvedValue({
        data: [
          { id: 'fc-1', front: 'q1', back: 'a1', createdAt: null, reviewState: null },
          { id: 'fc-2', front: 'q2', back: 'a2', createdAt: null, reviewState: null },
          {
            id: 'fc-3',
            front: 'q3',
            back: 'a3',
            createdAt: null,
            reviewState: { easiness_factor: 2.5 },
          },
        ],
        error: null,
      });

      mock.from.mockReturnValue({ select: vi.fn(() => c), update: tableUpdate });
      mock.rpc.mockImplementation(rpcMock);

      const result = await service.getDueCards(ctx, {});

      expect(result.success).toBe(true);
      expect(tableUpdate).not.toHaveBeenCalled();
    });

    it('resets daily counter when reset date is stale', async () => {
      const settings = {
        ...defaultSettings,
        new_cards_introduced: 15,
        daily_reset_date: '2026-06-15',
      };
      const c = settingsChain(settings);
      const tableUpdate = vi.fn(() => c);
      const rpcMock = vi.fn().mockResolvedValue({ data: [], error: null });

      mock.from.mockReturnValue({ select: vi.fn(() => c), update: tableUpdate });
      mock.rpc.mockImplementation(rpcMock);

      const result = await service.getDueCards(ctx, {});

      expect(result.success).toBe(true);
      expect(tableUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ new_cards_introduced: 0 }),
      );
    });
  });

  describe('getDueCount', () => {
    it('returns count from RPC', async () => {
      const settings = { ...defaultSettings };
      const settingsC = settingsChain(settings);
      const rpcMock = vi.fn().mockResolvedValue({
        data: { total: 5 },
        error: null,
      });

      mock.from.mockReturnValue({ select: vi.fn(() => settingsC), update: vi.fn(() => settingsC) });
      mock.rpc.mockImplementation(rpcMock);

      const result = await service.getDueCount(ctx, {});

      expect(result.success).toBe(true);
      expect(result.data.count).toBe(5);
    });

    it('returns 0 when RPC returns no data', async () => {
      const c = chain({ data: [], error: null });
      mock.from.mockReturnValue({ select: vi.fn(() => c) });
      mock.rpc.mockResolvedValue({ data: { total: 0 }, error: null });

      const result = await service.getDueCount(ctx, {});

      expect(result.success).toBe(true);
      expect(result.data.count).toBe(0);
    });
  });

  describe('getDueBreakdown', () => {
    it('returns breakdown from RPC', async () => {
      const rpcMock = vi.fn().mockResolvedValue({
        data: {
          total: 2,
          nextReviewAt: null,
          byTopic: [{ topic_id: 'topic-1', count: 1 }, { topic_id: 'topic-2', count: 1 }],
          byDeck: [{ deck_id: 'deck-1', count: 1 }, { deck_id: 'deck-2', count: 1 }],
        },
        error: null,
      });

      mock.rpc.mockImplementation(rpcMock);

      const result = await service.getDueBreakdown(ctx);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(2);
      expect(result.data.byTopic).toEqual({ 'topic-1': 1, 'topic-2': 1 });
      expect(result.data.byDeck).toEqual({ 'deck-1': 1, 'deck-2': 1 });
    });
  });
});
