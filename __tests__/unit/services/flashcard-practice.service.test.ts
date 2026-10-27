import { AccountType, type RequestContext } from '@studiq/authz';
import { FlashcardPracticeService } from '@studiq/server/services/flashcard-practice.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', () => ({
  buildQueryFilter: vi.fn().mockReturnValue({}),
  accessibleFilter: vi.fn().mockResolvedValue({}),
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
  c.limit = vi.fn(() => c);
  c.gt = vi.fn(() => c);
  c.filter = vi.fn(() => c);
  c.not = vi.fn(() => c);
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
      return upsertMock;
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

    it('maps confidenceLevel 3 (Good) on a new card to step 1, 10 min and EF 2.36', async () => {
      const mockPractice = {
        id: 'p-1',
        user_id: ctx.userId,
        flashcard_id: 'fc-1',
        was_correct: true,
      };

      const upsertMock = setupMocks({ data: mockPractice, error: null }, null, {
        data: { ...mockPractice, learning_state: 'learning', learning_step: 1 },
        error: null,
      });

      const result = await service.log('fc-1', true, ctx, undefined, 3);

      expect(result.success).toBe(true);
      const payload = upsertMock.mock.calls[0][0];
      expect(payload.learning_state).toBe('learning');
      expect(payload.learning_step).toBe(1);
      expect(payload.interval_days).toBe(10);
      expect(payload.interval_unit).toBe('minutes');
      expect(payload.easiness_factor).toBe(2.36);
    });

    it('maps confidenceLevel 1 (Again) on a new card to step 0, 1 min and EF 1.7', async () => {
      const mockPractice = {
        id: 'p-1',
        user_id: ctx.userId,
        flashcard_id: 'fc-1',
        was_correct: false,
      };

      const upsertMock = setupMocks({ data: mockPractice, error: null }, null, {
        data: { ...mockPractice, learning_state: 'learning', learning_step: 0 },
        error: null,
      });

      const result = await service.log('fc-1', false, ctx, undefined, 1);

      expect(result.success).toBe(true);
      const payload = upsertMock.mock.calls[0][0];
      expect(payload.learning_state).toBe('learning');
      expect(payload.learning_step).toBe(0);
      expect(payload.interval_days).toBe(1);
      expect(payload.interval_unit).toBe('minutes');
      expect(payload.easiness_factor).toBe(1.7);
    });

    it('maps a review card rated Easy to a day-based interval unit', async () => {
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
        interval_unit: 'days',
        repetitions: 1,
        learning_state: 'review',
        learning_step: 0,
        lapse_count: 0,
        is_leech: false,
      };

      const upsertSingleMock = vi.fn().mockResolvedValue({
        data: { ...existingState, learning_state: 'review' },
        error: null,
      });
      const upsertMock = vi
        .fn()
        .mockReturnValue({ select: vi.fn().mockReturnValue({ single: upsertSingleMock }) });

      // Load-balancing reads `next_review_at`; the review-state lookup uses `select('*')`.
      const loadBalanceChain: any = {};
      loadBalanceChain.eq = vi.fn(() => loadBalanceChain);
      loadBalanceChain.gte = vi.fn(() => loadBalanceChain);
      loadBalanceChain.lt = vi.fn().mockResolvedValue({ data: [], error: null });
      const lookupChain = chain({ data: existingState, error: null });

      mock.from.mockImplementation((table: string) => {
        if (table === 'flashcard_practice')
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockPractice, error: null }),
              }),
            }),
          };
        if (table === 'user_study_settings')
          return {
            select: vi.fn().mockReturnValue({
              eq: vi
                .fn()
                .mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(defaultSettingsRow) }),
            }),
          };
        if (table === 'flashcard_review_state')
          return {
            select: vi.fn((columns: string) =>
              columns === 'next_review_at' ? loadBalanceChain : lookupChain,
            ),
            upsert: upsertMock,
          };
        return chain();
      });

      const result = await service.log('fc-1', true, ctx, undefined, 4);

      expect(result.success).toBe(true);
      const payload = upsertMock.mock.calls[0][0];
      expect(payload.learning_state).toBe('review');
      expect(payload.interval_unit).toBe('days');
      expect(payload.interval_days).toBeGreaterThanOrEqual(6);
    });

    it('writes nothing in cram mode (#617)', async () => {
      const result = await service.log(
        'fc-1',
        true,
        ctx,
        undefined,
        3,
        '00000000-0000-4000-8000-000000000001',
        'cram',
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ practice: null, reviewState: null });
      expect(mock.from).not.toHaveBeenCalled();
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
          mode: 'review',
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
          mode: 'review',
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
          mode: 'review',
          items: [
            { flashcardId: 'fc-1', wasCorrect: true },
            { flashcardId: 'fc-2', wasCorrect: true },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(false);
    });

    it('writes nothing in cram mode (#617)', async () => {
      const result = await service.batch(
        {
          mode: 'cram',
          items: [
            { flashcardId: 'fc-1', wasCorrect: true, confidenceLevel: 3 },
            { flashcardId: 'fc-2', wasCorrect: false, confidenceLevel: 1 },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ success: true, results: [] });
      // Zero DB statements: no practice row, no review-state write, no settings bump.
      expect(mock.from).not.toHaveBeenCalled();
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

  describe('getSettings', () => {
    it('counts new cards through the group-scope RPC filter (own + group-shared)', async () => {
      const { buildQueryFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(buildQueryFilter).mockReturnValueOnce({
        _useRpc: true,
        organization_id: 'org-1',
      } as any);

      const c = settingsChain();
      mock.from.mockReturnValue({ select: vi.fn(() => c), update: vi.fn(() => c) });
      mock.rpc.mockResolvedValue({ data: 3, error: null });

      const groupCtx: RequestContext = { ...ctx, activeOrgId: 'org-1' };
      const result = await service.getSettings(groupCtx);

      expect(mock.rpc).toHaveBeenCalledWith('count_new_cards', {
        p_user_id: ctx.userId,
        p_filter_type: 'university',
        p_organization_id: 'org-1',
      });
      expect(result.success).toBe(true);
      expect((result.data as any).totalNewCards).toBe(3);
    });
  });

  describe('getDueBreakdown', () => {
    it('returns breakdown from RPC', async () => {
      const rpcMock = vi.fn().mockResolvedValue({
        data: {
          total: 2,
          nextReviewAt: null,
          byTopic: [
            { topic_id: 'topic-1', count: 1 },
            { topic_id: 'topic-2', count: 1 },
          ],
          byDeck: [
            { deck_id: 'deck-1', count: 1 },
            { deck_id: 'deck-2', count: 1 },
          ],
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

  describe('getStateBreakdown (#395)', () => {
    it('forwards the resolved filter and passes the RPC payload through', async () => {
      const { buildQueryFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(buildQueryFilter).mockReturnValueOnce({
        created_by: 'test-user-id',
        organization_id: 'org-1',
      } as any);

      const breakdown = {
        totalCards: 8,
        neverPracticed: 0,
        learning: 7,
        review: 1,
        relearning: 0,
        leeched: 0,
        practicedCards: 8,
        averageAccuracy: 75,
        averageEasinessFactor: 2.5,
      };
      mock.rpc.mockResolvedValue({ data: breakdown, error: null });

      const orgCtx: RequestContext = { ...ctx, activeOrgId: 'org-1' };
      const result = await service.getStateBreakdown(orgCtx);

      expect(mock.rpc).toHaveBeenCalledWith('get_practice_state_breakdown', {
        p_user_id: ctx.userId,
        p_created_by: 'test-user-id',
        p_organization_id: 'org-1',
      });
      expect(result.success).toBe(true);
      expect(result.data as any).toEqual(breakdown);
    });

    it('returns the full zero envelope when the RPC fails', async () => {
      mock.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });

      const result = await service.getStateBreakdown(ctx);

      expect(result.success).toBe(true);
      expect(result.data as any).toEqual({
        totalCards: 0,
        neverPracticed: 0,
        learning: 0,
        review: 0,
        relearning: 0,
        leeched: 0,
        practicedCards: 0,
        averageAccuracy: 0,
        averageEasinessFactor: 0,
      });
    });

    it('returns the zero envelope without querying when the filter is impossible', async () => {
      const { buildQueryFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(buildQueryFilter).mockReturnValueOnce({ _impossible: true } as any);

      const result = await service.getStateBreakdown(ctx);

      expect(mock.rpc).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data as any).toMatchObject({
        totalCards: 0,
        practicedCards: 0,
        averageAccuracy: 0,
        averageEasinessFactor: 0,
      });
    });
  });

  describe('getAllCardStats (#343)', () => {
    async function mockAccessibleFilter(filter: Record<string, unknown>) {
      const { accessibleFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(accessibleFilter).mockResolvedValueOnce(filter as any);
    }

    it('applies the resolved group filter so other groups/users are excluded', async () => {
      await mockAccessibleFilter({
        organization_id: 'org-1',
        or: 'created_by.eq.test-user-id,id.in.(fc-1)',
      });

      const suspended = chain({ data: [], error: null });
      const cardQuery = chain({
        data: [{ id: 'fc-1', front: 'F', back: 'B', created_at: '2026-01-01T00:00:00Z' }],
        error: null,
      });
      const states = chain({ data: [], error: null });
      const practice = chain({ data: [], error: null });
      mock.from
        .mockReturnValueOnce(suspended)
        .mockReturnValueOnce(cardQuery)
        .mockReturnValueOnce(states)
        .mockReturnValueOnce(practice);

      const result = await service.getAllCardStats(ctx, { limit: 100 });

      expect(result.success).toBe(true);
      expect(cardQuery.or).toHaveBeenCalledWith('created_by.eq.test-user-id,id.in.(fc-1)');
      expect(cardQuery.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect((result.data as any).items.map((i: any) => i.id)).toEqual(['fc-1']);
    });

    it('returns an empty page when the filter is impossible', async () => {
      await mockAccessibleFilter({ _impossible: true });

      const suspended = chain({ data: [], error: null });
      const cardQuery = chain({ data: [], error: null });
      mock.from.mockReturnValueOnce(suspended).mockReturnValueOnce(cardQuery);

      const result = await service.getAllCardStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ items: [], nextCursor: null, hasMore: false });
      expect(cardQuery.limit).not.toHaveBeenCalled();
    });

    it('filters by created_by for own scope and never adds an or filter', async () => {
      await mockAccessibleFilter({ created_by: 'test-user-id' });

      const suspended = chain({ data: [], error: null });
      const cardQuery = chain({
        data: [{ id: 'fc-1', front: 'F', back: 'B', created_at: '2026-01-01T00:00:00Z' }],
        error: null,
      });
      const states = chain({ data: [], error: null });
      const practice = chain({ data: [], error: null });
      mock.from
        .mockReturnValueOnce(suspended)
        .mockReturnValueOnce(cardQuery)
        .mockReturnValueOnce(states)
        .mockReturnValueOnce(practice);

      const result = await service.getAllCardStats(ctx);

      expect(result.success).toBe(true);
      expect(cardQuery.eq).toHaveBeenCalledWith('created_by', 'test-user-id');
      expect(cardQuery.or).not.toHaveBeenCalled();
    });

    it('reports the interval magnitude with its unit so 1 min and 1 day differ (#341)', async () => {
      await mockAccessibleFilter({ created_by: 'test-user-id' });

      const cards = [
        { id: 'fc-review', front: 'F', back: 'B', created_at: '2026-01-01T00:00:00Z' },
        { id: 'fc-learning', front: 'F', back: 'B', created_at: '2026-01-01T00:00:00Z' },
        { id: 'fc-leech', front: 'F', back: 'B', created_at: '2026-01-01T00:00:00Z' },
        { id: 'fc-new', front: 'F', back: 'B', created_at: '2026-01-01T00:00:00Z' },
      ];
      const suspended = chain({ data: [], error: null });
      const cardQuery = chain({ data: cards, error: null });
      const states = chain({
        data: [
          {
            flashcard_id: 'fc-review',
            learning_state: 'review',
            interval_days: 1,
            interval_unit: 'days',
            is_leech: false,
          },
          {
            flashcard_id: 'fc-learning',
            learning_state: 'learning',
            interval_days: 1,
            interval_unit: 'minutes',
            is_leech: false,
          },
          {
            flashcard_id: 'fc-leech',
            learning_state: 'review',
            interval_days: 6,
            interval_unit: 'days',
            is_leech: true,
          },
        ],
        error: null,
      });
      const practice = chain({ data: [], error: null });
      mock.from
        .mockReturnValueOnce(suspended)
        .mockReturnValueOnce(cardQuery)
        .mockReturnValueOnce(states)
        .mockReturnValueOnce(practice);

      const result = await service.getAllCardStats(ctx, { limit: 100 });

      expect(result.success).toBe(true);
      const items = (result.data as any).items as any[];
      const byId = new Map(items.map((i) => [i.id, i]));

      expect(byId.get('fc-review')).toMatchObject({
        state: 'review',
        intervalValue: 1,
        intervalUnit: 'days',
      });
      expect(byId.get('fc-learning')).toMatchObject({
        state: 'learning',
        intervalValue: 1,
        intervalUnit: 'minutes',
      });
      expect(byId.get('fc-leech')).toMatchObject({
        state: 'leech',
        intervalValue: 6,
        intervalUnit: 'days',
      });
      expect(byId.get('fc-new')).toMatchObject({
        state: 'new',
        intervalValue: null,
        intervalUnit: null,
      });
      expect(items.every((i) => !('intervalDays' in i))).toBe(true);
    });
  });

  describe('getCardsForPractice (#343)', () => {
    it('only returns cards from the resolved accessible set', async () => {
      const { accessibleFilter } = await import('@studiq/server/lib/authz');
      vi.mocked(accessibleFilter).mockResolvedValueOnce({
        organization_id: 'org-1',
        or: 'created_by.eq.test-user-id,id.in.(fc-1)',
      } as any);

      const matching = chain({ data: [{ id: 'fc-1' }], error: null });
      const reviewStates = chain({ data: [], error: null });
      const fullCards = chain({
        data: [{ id: 'fc-1', front: 'F', back: 'B', created_at: '2026-01-01T00:00:00Z' }],
        error: null,
      });
      mock.from
        .mockReturnValueOnce(matching)
        .mockReturnValueOnce(reviewStates)
        .mockReturnValueOnce(fullCards);

      const result = await service.getCardsForPractice(ctx, { deckIds: ['deck-1'] });

      expect(result.success).toBe(true);
      expect(matching.or).toHaveBeenCalledWith('created_by.eq.test-user-id,id.in.(fc-1)');
      expect(matching.in).toHaveBeenCalledWith('deck_id', ['deck-1']);
      const ids = (result.data as any[]).map((c) => c.id);
      expect(ids).toEqual(['fc-1']);
      expect(ids).not.toContain('fc-2');
    });
  });

  describe('pickLoadBalancedDate (SRS load balancing)', () => {
    function lbChain(rows: Array<{ next_review_at: string }>) {
      const c: any = {};
      c.eq = vi.fn(() => c);
      c.gte = vi.fn(() => c);
      c.lt = vi.fn().mockResolvedValue({ data: rows, error: null });
      return c;
    }

    it('keeps the base date when nothing else is scheduled nearby', async () => {
      mock.from.mockReturnValue({ select: vi.fn(() => lbChain([])) });

      const base = new Date('2026-01-10T00:00:00.000Z');
      const result = await (service as any).pickLoadBalancedDate(ctx, base, 2);

      expect(result.toISOString()).toBe(base.toISOString());
    });

    it('shifts to the least-loaded day within the fuzz window, tie-broken toward the base date', async () => {
      const base = new Date('2026-01-10T00:00:00.000Z');
      const rows = [
        { next_review_at: new Date('2026-01-10T00:00:00.000Z').toISOString() },
        { next_review_at: new Date('2026-01-10T00:00:00.000Z').toISOString() },
        { next_review_at: new Date('2026-01-11T00:00:00.000Z').toISOString() },
      ];
      mock.from.mockReturnValue({ select: vi.fn(() => lbChain(rows)) });

      const result = await (service as any).pickLoadBalancedDate(ctx, base, 2);

      expect(result.toISOString()).toBe(new Date('2026-01-09T00:00:00.000Z').toISOString());
    });
  });
});
