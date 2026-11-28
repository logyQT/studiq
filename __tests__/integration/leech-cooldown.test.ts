import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asJson } from '#test/helpers/json';
import { type BeforeResult, before } from '#test/helpers/test-user';
import { createServiceClient, mockUser, useRealSupabase } from '#test/integration/helpers';
import {
  createNextRequestWithParams,
  latestShippedFunction,
  requiredAt,
} from '#test/integration/test-utils';
import { PUT as updateFlashcard } from '@/app/(backend)/api/v1/flashcards/[id]/route';

// #1063: a leeched card used to leave review forever (`NOT is_leech`). The ladder
// now rests it 7 days, then 30, then suspends it, and an explicit restore is the
// only early exit. These assertions read the SQL functions the app calls, so a
// change to the RPC bodies fails here rather than in the UI.

const DAY_MS = 24 * 60 * 60 * 1000;

function requireLocalDatabaseUrl(): string {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) {
    throw new Error(
      "leech-cooldown needs SUPABASE_DB_URL pointing at this checkout's local Supabase: the " +
        'RPCs are installed from their migration so a mutation to that file reaches the ' +
        'database. Run the suite through `bun run env:run -- bun run test:integration`.',
    );
  }
  const { hostname } = new URL(raw);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new Error('leech-cooldown must run against the local stack, not a remote database');
  }
  return raw;
}

/**
 * Install the shipped bodies over the direct connection. A copy here could pass
 * while production ships something else, and a mutation to the migration has to
 * reach the database to turn this suite red.
 */
const SHIPPED_FUNCTIONS = [
  latestShippedFunction('get_due_flashcards'),
  latestShippedFunction('get_due_breakdown'),
  latestShippedFunction('get_practice_state_breakdown'),
  latestShippedFunction('count_new_cards'),
];

interface DueCard {
  id: string;
  reviewState?: { leechStage?: number; leechRestUntil?: string | null } | null;
}

interface DueBreakdown {
  total: number;
  nextReviewAt: string | null;
}

interface StateBreakdown {
  totalCards: number;
  neverPracticed: number;
  review: number;
  relearning: number;
  leeched: number;
  suspended: number;
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

describe('Leech cooldown and suspension (#1063)', () => {
  let student: BeforeResult;
  let cardId: string;
  let db: ReturnType<typeof createServiceClient>;

  beforeAll(async () => {
    student = await before({ role: 'student', decks: 1, flashcards: 1 });
    cardId = requiredAt(student.created.flashcards, 0, 'seeded flashcard');
    db = createServiceClient();

    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      for (const definition of SHIPPED_FUNCTIONS) await sql.unsafe(definition);
    } finally {
      await sql.end();
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();
    await db.from('suspended_cards').delete().eq('user_id', student.user.id);
    await db.from('flashcard_review_state').delete().eq('user_id', student.user.id);
  });

  afterAll(async () => {
    await db.from('suspended_cards').delete().eq('user_id', student.user.id);
    await db.from('flashcard_review_state').delete().eq('user_id', student.user.id);
  });

  /** One leeched review state, due now, with the rest date under test control. */
  async function seedLeech(restUntil: string | null, stage = 1) {
    const { error } = await db.from('flashcard_review_state').insert({
      user_id: student.user.id,
      flashcard_id: cardId,
      easiness_factor: 2.5,
      interval_days: 10,
      repetitions: 3,
      next_review_at: new Date(Date.now() - 60_000).toISOString(),
      learning_state: 'review',
      sm2_lapse_count: 8,
      is_leech: true,
      leech_stage: stage,
      leech_rest_until: restUntil,
    });
    if (error) throw new Error(`seed review state: ${error.message}`);
  }

  async function updateReviewState(patch: Record<string, unknown>) {
    const { error } = await db
      .from('flashcard_review_state')
      .update(patch)
      .eq('user_id', student.user.id)
      .eq('flashcard_id', cardId);
    if (error) throw new Error(`update review state: ${error.message}`);
  }

  async function suspendCard(reason: 'manual' | 'leech' = 'manual', target = cardId) {
    const { error } = await db
      .from('suspended_cards')
      .insert({ user_id: student.user.id, flashcard_id: target, reason });
    if (error) throw new Error(`seed suspension: ${error.message}`);
  }

  async function dueCards(): Promise<DueCard[]> {
    const { data, error } = await db.rpc('get_due_flashcards', {
      p_user_id: student.user.id,
      p_filter_type: 'own',
      p_limit: 50,
      p_new_card_limit: 0,
    });
    if (error) throw new Error(error.message);
    return asJson<DueCard[]>(data);
  }

  async function dueBreakdown(): Promise<DueBreakdown> {
    const { data, error } = await db.rpc('get_due_breakdown', {
      p_user_id: student.user.id,
      p_created_by: student.user.id,
    });
    if (error) throw new Error(error.message);
    return asJson<DueBreakdown>(data);
  }

  async function newCardCount(): Promise<number> {
    const { data, error } = await db.rpc('count_new_cards', {
      p_user_id: student.user.id,
      p_filter_type: 'own',
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async function breakdown(): Promise<StateBreakdown> {
    const { data, error } = await db.rpc('get_practice_state_breakdown', {
      p_user_id: student.user.id,
      p_created_by: student.user.id,
    });
    if (error) throw new Error(error.message);
    return asJson<StateBreakdown>(data);
  }

  function update(body: unknown) {
    const { request, params } = createNextRequestWithParams(
      `http://localhost/api/v1/flashcards/${cardId}`,
      { id: cardId },
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return updateFlashcard(request, { params });
  }

  it('excludes a resting leech and includes it once the rest is over', async () => {
    await seedLeech(daysFromNow(7));

    expect(await dueCards()).toEqual([]);

    await updateReviewState({ leech_rest_until: new Date(Date.now() - 60_000).toISOString() });

    const due = await dueCards();
    expect(due.map((card) => card.id)).toEqual([cardId]);
    expect(due[0]?.reviewState).toMatchObject({ leechStage: 1, isLeech: true });
  });

  it('keeps a suspended card out of review even when it is due', async () => {
    await seedLeech(new Date(Date.now() - 60_000).toISOString(), 3);
    mockUser(student.user);

    const response = await update({ suspended: true });
    expect(response.status).toBe(200);

    const { data: rows } = await db
      .from('suspended_cards')
      .select('reason')
      .eq('user_id', student.user.id)
      .eq('flashcard_id', cardId);
    expect(rows).toEqual([{ reason: 'manual' }]);

    expect(await dueCards()).toEqual([]);
  });

  it('restores a suspended card and resets its leech state', async () => {
    await seedLeech(daysFromNow(7), 3);
    await suspendCard('leech');
    mockUser(student.user);

    const response = await update({ suspended: false });
    expect(response.status).toBe(200);

    const { data: state } = await db
      .from('flashcard_review_state')
      .select('sm2_lapse_count, leech_stage, is_leech, leech_rest_until')
      .eq('user_id', student.user.id)
      .eq('flashcard_id', cardId)
      .single();
    expect(state).toEqual({
      sm2_lapse_count: 0,
      leech_stage: 0,
      is_leech: false,
      leech_rest_until: null,
    });

    const { data: suspensions } = await db
      .from('suspended_cards')
      .select('flashcard_id')
      .eq('user_id', student.user.id);
    expect(suspensions).toEqual([]);

    // The card stays due: restore returns it to review immediately.
    expect((await dueCards()).map((card) => card.id)).toEqual([cardId]);
  });

  it('counts a suspended card once under suspended and keeps totalCards constant', async () => {
    await seedLeech(daysFromNow(7), 2);

    const initial = await breakdown();
    expect(initial.totalCards).toBe(1);
    expect(initial.leeched).toBe(1);
    expect(initial.suspended).toBe(0);

    await suspendCard();

    const after = await breakdown();
    expect(after.totalCards).toBe(initial.totalCards);
    expect(after.suspended).toBe(1);
    expect(after.leeched).toBe(0);
    expect(after.review).toBe(0);
    expect(after.relearning).toBe(0);
  });

  it('leaves neverPracticed when a card with no review state is suspended', async () => {
    const initial = await breakdown();
    expect(initial.totalCards).toBe(1);
    expect(initial.neverPracticed).toBe(1);
    expect(initial.suspended).toBe(0);

    await suspendCard();

    const after = await breakdown();
    expect(after.totalCards).toBe(initial.totalCards);
    expect(after.neverPracticed).toBe(0);
    expect(after.suspended).toBe(1);
  });

  it('excludes a resting and a suspended card from the due breakdown', async () => {
    // Due now, but resting: neither the due count nor the next review may include it.
    await seedLeech(daysFromNow(7));
    const resting = await dueBreakdown();
    expect(resting.total).toBe(0);
    expect(resting.nextReviewAt).toBeNull();

    // A future review date under an active rest must not become the next review.
    const nextReviewAt = daysFromNow(3);
    await updateReviewState({ next_review_at: nextReviewAt });
    expect((await dueBreakdown()).nextReviewAt).toBeNull();

    // Lift the rest: the same future date now counts.
    await updateReviewState({ leech_rest_until: null });
    const resumed = await dueBreakdown();
    expect(resumed.nextReviewAt).not.toBeNull();
    expect(
      Math.abs(new Date(resumed.nextReviewAt!).getTime() - new Date(nextReviewAt).getTime()),
    ).toBeLessThan(1000);

    // Make it due, then suspend it: the count drops to zero regardless of the date.
    await updateReviewState({ next_review_at: new Date(Date.now() - 60_000).toISOString() });
    expect((await dueBreakdown()).total).toBe(1);

    await suspendCard();
    expect((await dueBreakdown()).total).toBe(0);
  });

  it('does not count a suspended card with no review state as a new card', async () => {
    expect(await newCardCount()).toBe(1);

    await suspendCard();

    expect(await newCardCount()).toBe(0);
  });
});
