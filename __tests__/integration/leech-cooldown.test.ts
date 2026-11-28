import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asJson } from '#test/helpers/json';
import { type BeforeResult, before } from '#test/helpers/test-user';
import { createServiceClient, mockUser, useRealSupabase } from '#test/integration/helpers';
import { createNextRequestWithParams, requiredAt } from '#test/integration/test-utils';
import { PUT as updateFlashcard } from '@/app/(backend)/api/v1/flashcards/[id]/route';

// #1063: a leeched card used to leave review forever (`NOT is_leech`). The ladder
// now rests it 7 days, then 30, then suspends it, and an explicit restore is the
// only early exit. These assertions read the SQL functions the app calls, so a
// change to the RPC bodies fails here rather than in the UI.

const DAY_MS = 24 * 60 * 60 * 1000;

interface DueCard {
  id: string;
  reviewState?: { leechStage?: number; leechRestUntil?: string | null } | null;
}

interface StateBreakdown {
  totalCards: number;
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

    const { error } = await db
      .from('flashcard_review_state')
      .update({ leech_rest_until: new Date(Date.now() - 60_000).toISOString() })
      .eq('user_id', student.user.id)
      .eq('flashcard_id', cardId);
    if (error) throw new Error(error.message);

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
    const { error: seedError } = await db.from('suspended_cards').insert({
      user_id: student.user.id,
      flashcard_id: cardId,
      reason: 'leech',
    });
    if (seedError) throw new Error(`seed suspension: ${seedError.message}`);
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

    const { error } = await db.from('suspended_cards').insert({
      user_id: student.user.id,
      flashcard_id: cardId,
      reason: 'manual',
    });
    if (error) throw new Error(`seed suspension: ${error.message}`);

    const after = await breakdown();
    expect(after.totalCards).toBe(initial.totalCards);
    expect(after.suspended).toBe(1);
    expect(after.leeched).toBe(0);
    expect(after.review).toBe(0);
    expect(after.relearning).toBe(0);
  });
});
