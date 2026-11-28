import { AccountType, type RequestContext } from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { FlashcardPracticeService } from '@studiq/server/services/flashcard-practice.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
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

const settings = {
  learning_steps: [1, 10],
  leech_threshold: 8,
  new_cards_per_day: 20,
  new_cards_introduced: 0,
  daily_reset_date: new Date().toISOString().slice(0, 10),
};

type QueryResult = { data: unknown; error: unknown };

interface Chain {
  select: Mock;
  eq: Mock;
  in: Mock;
  or: Mock;
  order: Mock;
  limit: Mock;
  gt: Mock;
  gte: Mock;
  lt: Mock;
  filter: Mock;
  not: Mock;
  insert: Mock;
  upsert: Mock;
  update: Mock;
  delete: Mock;
  single: Mock;
  maybeSingle: Mock;
  then: Promise<QueryResult>['then'];
}

/** A thenable builder: every method chains, awaiting it resolves `result`. */
function builder(result: QueryResult = { data: null, error: null }): Chain {
  const promise = Promise.resolve(result);
  const c: Chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    gt: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    filter: vi.fn(),
    not: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: promise.then.bind(promise),
  };
  for (const method of [
    c.select,
    c.eq,
    c.in,
    c.or,
    c.order,
    c.limit,
    c.gt,
    c.gte,
    c.lt,
    c.filter,
    c.not,
    c.insert,
    c.upsert,
    c.update,
    c.delete,
  ]) {
    method.mockImplementation(() => c);
  }
  return c;
}

type StateRow = {
  user_id: string;
  flashcard_id: string;
  learning_state: string;
  learning_step: number;
  easiness_factor: number;
  interval_days: number;
  interval_unit: string;
  repetitions: number;
  next_review_at: string;
  last_reviewed_at: string;
  last_quality: number | null;
  sm2_lapse_count: number;
  is_leech: boolean;
  leech_stage: number;
  leech_rest_until: string | null;
};

function stateRow(overrides: Partial<StateRow> = {}): StateRow {
  return {
    user_id: ctx.userId,
    flashcard_id: 'fc-1',
    learning_state: 'review',
    learning_step: 0,
    easiness_factor: 2.5,
    interval_days: 10,
    interval_unit: 'days',
    repetitions: 3,
    next_review_at: '2026-11-01T00:00:00.000Z',
    last_reviewed_at: '2026-10-20T00:00:00.000Z',
    last_quality: 4,
    sm2_lapse_count: 7,
    is_leech: false,
    leech_stage: 0,
    leech_rest_until: null,
    ...overrides,
  };
}

type UpsertPayload = {
  flashcard_id: string;
  leech_stage: number;
  leech_rest_until: string | null;
  is_leech: boolean;
  sm2_lapse_count: number;
};

function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

/** The `flashcard_review_state` row `upsertReviewState` returns, narrowed by hand. */
type ReviewStatePayload = {
  sm2_lapse_count: number;
  is_leech: boolean;
  leech_stage: number;
  leech_rest_until: string | null;
};

function reviewStateOf(result: ServiceResult<unknown>): ReviewStatePayload {
  const data = expectSuccess(result);
  if (typeof data !== 'object' || data === null || !('reviewState' in data)) {
    throw new Error('expected the practice log payload');
  }
  const { reviewState } = data;
  if (
    typeof reviewState !== 'object' ||
    reviewState === null ||
    !('sm2_lapse_count' in reviewState) ||
    typeof reviewState.sm2_lapse_count !== 'number' ||
    !('is_leech' in reviewState) ||
    typeof reviewState.is_leech !== 'boolean' ||
    !('leech_stage' in reviewState) ||
    typeof reviewState.leech_stage !== 'number' ||
    !('leech_rest_until' in reviewState)
  ) {
    throw new Error('expected the leech fields on the review state');
  }
  return {
    sm2_lapse_count: reviewState.sm2_lapse_count,
    is_leech: reviewState.is_leech,
    leech_stage: reviewState.leech_stage,
    leech_rest_until:
      typeof reviewState.leech_rest_until === 'string' ? reviewState.leech_rest_until : null,
  };
}

function batchResults(result: ServiceResult<unknown>): Array<Record<string, unknown>> {
  const data = expectSuccess(result);
  if (typeof data !== 'object' || data === null || !('results' in data)) {
    throw new Error('expected the batch payload');
  }
  const { results } = data;
  if (!Array.isArray(results)) throw new Error('expected batch results');
  return results.filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
  );
}

function statsItems(result: ServiceResult<unknown>): Array<Record<string, unknown>> {
  const data = expectSuccess(result);
  if (typeof data !== 'object' || data === null || !('items' in data)) {
    throw new Error('expected the card stats payload');
  }
  const { items } = data;
  if (!Array.isArray(items)) throw new Error('expected card stats items');
  return items.filter(
    (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
  );
}

/** ISO distance in days, for the 7/30-day rest assertions. */
function daysFromNow(iso: unknown, days: number): boolean {
  if (typeof iso !== 'string') return false;
  const delta = new Date(iso).getTime() - Date.now() - days * 24 * 60 * 60 * 1000;
  return Math.abs(delta) < 60 * 60 * 1000;
}

describe('FlashcardPracticeService leech ladder', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const service = new FlashcardPracticeService(() => Promise.resolve(mock));

  let upserts: UpsertPayload[];
  let suspensionUpserts: Array<{ payload: unknown; options: unknown }>;
  let reviewStateUpdates: unknown[];
  let reviewStateDeletes: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    upserts = [];
    suspensionUpserts = [];
    reviewStateUpdates = [];
    reviewStateDeletes = 0;
  });

  function wireReviewWrite(existing: StateRow | null) {
    const state = builder({ data: existing, error: null });
    const lookup = builder({ data: [], error: null });

    state.select = vi.fn((columns: string) => {
      if (columns === '*') return state;
      return lookup;
    });
    state.maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
    state.upsert = vi.fn((payload: UpsertPayload) => {
      upserts.push(payload);
      return {
        select: () => ({ single: () => Promise.resolve({ data: { ...payload }, error: null }) }),
      };
    });
    state.update = vi.fn((values: unknown) => {
      reviewStateUpdates.push(values);
      return state;
    });
    state.delete = vi.fn(() => {
      reviewStateDeletes++;
      return state;
    });

    const practiceRow = { data: { id: 'p-1' }, error: null };
    const practice = builder(practiceRow);
    practice.insert = vi.fn(() => ({
      select: () => ({ single: () => Promise.resolve(practiceRow) }),
    }));

    const settingsBuilder = builder({ data: settings, error: null });

    const suspensions = builder({ data: null, error: null });
    suspensions.upsert = vi.fn((payload: unknown, options: unknown) => {
      suspensionUpserts.push({ payload, options });
      return Promise.resolve({ data: null, error: null });
    });

    mock.from.mockImplementation((table: string) => {
      if (table === 'flashcard_practice') return practice;
      if (table === 'flashcard_review_state') return state;
      if (table === 'user_study_settings') return settingsBuilder;
      if (table === 'suspended_cards') return suspensions;
      return builder();
    });

    return { state, lookup, suspensions };
  }

  function reviewCorrectly() {
    return service.log('fc-1', true, ctx, undefined, 5);
  }

  function reviewLapse() {
    return service.log('fc-1', false, ctx, undefined, 1);
  }

  it('rests the threshold lapse 7 days at stage 1 and does not suspend', async () => {
    wireReviewWrite(stateRow({ sm2_lapse_count: 7 }));

    const payload = reviewStateOf(await reviewLapse());

    expect(payload.sm2_lapse_count).toBe(8);
    expect(payload.is_leech).toBe(true);
    expect(payload.leech_stage).toBe(1);
    expect(daysFromNow(payload.leech_rest_until, 7)).toBe(true);
    expect(suspensionUpserts).toEqual([]);
  });

  it('rests the next qualifying lapse 30 days at stage 2', async () => {
    wireReviewWrite(stateRow({ sm2_lapse_count: 8, is_leech: true, leech_stage: 1 }));

    const payload = reviewStateOf(await reviewLapse());

    expect(payload.leech_stage).toBe(2);
    expect(daysFromNow(payload.leech_rest_until, 30)).toBe(true);
    expect(suspensionUpserts).toEqual([]);
  });

  it('suspends the third qualifying lapse and clears the rest', async () => {
    wireReviewWrite(stateRow({ sm2_lapse_count: 9, is_leech: true, leech_stage: 2 }));

    const payload = reviewStateOf(await reviewLapse());

    expect(payload.leech_stage).toBe(3);
    expect(payload.leech_rest_until).toBeNull();
    expect(suspensionUpserts).toEqual([
      {
        payload: { user_id: ctx.userId, flashcard_id: 'fc-1', reason: 'leech' },
        options: { onConflict: 'user_id, flashcard_id', ignoreDuplicates: true },
      },
    ]);
  });

  it('keeps the stage and the rest on a correct review', async () => {
    const restUntil = '2027-01-01T00:00:00.000Z';
    wireReviewWrite(
      stateRow({ sm2_lapse_count: 8, is_leech: true, leech_stage: 1, leech_rest_until: restUntil }),
    );

    const payload = reviewStateOf(await reviewCorrectly());

    expect(payload.leech_stage).toBe(1);
    expect(payload.leech_rest_until).toBe(restUntil);
    expect(suspensionUpserts).toEqual([]);
  });

  it('never restores the card from a review', async () => {
    wireReviewWrite(stateRow({ sm2_lapse_count: 9, is_leech: true, leech_stage: 2 }));

    await reviewCorrectly();

    expect(reviewStateUpdates).toEqual([]);
    expect(reviewStateDeletes).toBe(0);
  });

  it('writes nothing in cram mode', async () => {
    const result = await service.batch(
      { items: [{ flashcardId: 'fc-1', wasCorrect: false }], mode: 'cram' },
      ctx,
    );

    expect(expectSuccess(result)).toEqual({ success: true, results: [] });
    expect(mock.from).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('reports the stage this write produced in the batch result', async () => {
    wireReviewWrite(stateRow({ sm2_lapse_count: 7 }));

    const [first] = batchResults(
      await service.batch(
        { items: [{ flashcardId: 'fc-1', wasCorrect: false, confidenceLevel: 1 }], mode: 'review' },
        ctx,
      ),
    );

    expect(first).toMatchObject({
      flashcardId: 'fc-1',
      isLeech: true,
      leechStage: 1,
      suspended: false,
    });
    expect(daysFromNow(first?.leechRestUntil, 7)).toBe(true);
  });

  it('returns the suspension flag when this write lands on stage 3', async () => {
    wireReviewWrite(stateRow({ sm2_lapse_count: 9, is_leech: true, leech_stage: 2 }));

    const [first] = batchResults(
      await service.batch(
        { items: [{ flashcardId: 'fc-1', wasCorrect: false, confidenceLevel: 1 }], mode: 'review' },
        ctx,
      ),
    );

    expect(first).toMatchObject({ leechStage: 3, leechRestUntil: null, suspended: true });
  });

  it('parses the suspended bucket from the state breakdown', async () => {
    mock.rpc.mockResolvedValue({
      data: {
        totalCards: 4,
        neverPracticed: 1,
        learning: 0,
        review: 1,
        relearning: 0,
        leeched: 1,
        suspended: 1,
        practicedCards: 3,
        averageAccuracy: 50,
        averageEasinessFactor: 2.4,
      },
      error: null,
    });

    const breakdown = expectSuccess(await service.getStateBreakdown(ctx));

    expect(breakdown.suspended).toBe(1);
    expect(breakdown.totalCards).toBe(4);
  });

  it('returns the suspension and rest fields and filters state=suspended', async () => {
    const restUntil = '2027-01-01T00:00:00.000Z';
    const cards = builder({
      data: [{ id: 'fc-1', front: 'front', back: 'back', created_at: '2026-01-01' }],
      error: null,
    });
    const states = builder({
      data: [
        {
          flashcard_id: 'fc-1',
          learning_state: 'review',
          is_leech: true,
          leech_stage: 2,
          leech_rest_until: restUntil,
          easiness_factor: 2.5,
          interval_days: 10,
          interval_unit: 'days',
          next_review_at: '2026-11-01T00:00:00.000Z',
          repetitions: 3,
          learning_step: 0,
        },
      ],
      error: null,
    });
    const suspensions = builder({ data: [{ flashcard_id: 'fc-1' }], error: null });
    const practice = builder({ data: [], error: null });
    const decks = builder({ data: [], error: null });

    mock.from.mockImplementation((table: string) => {
      if (table === 'flashcards') return cards;
      if (table === 'flashcard_review_state') return states;
      if (table === 'suspended_cards') return suspensions;
      if (table === 'flashcard_practice') return practice;
      if (table === 'suspended_decks') return decks;
      return builder();
    });

    const suspended = statsItems(await service.getAllCardStats(ctx, { state: 'suspended' }));
    expect(suspended).toHaveLength(1);
    expect(suspended[0]).toMatchObject({
      id: 'fc-1',
      state: 'leech',
      suspended: true,
      leechStage: 2,
      leechRestUntil: restUntil,
    });

    // `state` stays `leech`, so the leech filter still finds the resting card.
    const leeched = statsItems(await service.getAllCardStats(ctx, { state: 'leech' }));
    expect(leeched.map((item) => item.id)).toEqual(['fc-1']);

    const reviewed = statsItems(await service.getAllCardStats(ctx, { state: 'review' }));
    expect(reviewed).toEqual([]);
  });
});
