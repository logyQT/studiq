import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { createSeedDb } from '#test/helpers/tenant-seed';
import { type BeforeResult, before } from '#test/helpers/test-user';
import { mockUser, useRealSupabase } from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { POST as importPost } from '@/app/(backend)/api/v1/flashcards/import/csv/route';

const suiteId = crypto.randomUUID().slice(0, 8);
const TIGHT_LIMIT = 3;

interface ImportBody {
  success: boolean;
  error?: string;
  data?: { total: number; imported: number; errors: unknown[] };
}

// #888: a CSV import keeps its good rows, reports the bad ones, and respects the plan.
describe('POST /api/v1/flashcards/import/csv (#888)', () => {
  let db!: SupabaseClient<Database>;
  let student!: BeforeResult;
  let originalPlan!: string;
  // Dedicated plans, so the shared seeded ones are never touched.
  const roomyPlan = `test-import-roomy-${suiteId}`;
  const tightPlan = `test-import-tight-${suiteId}`;

  async function assignPlan(key: string) {
    const { error } = await db
      .from('profiles')
      .update({ personal_plan_key: key })
      .eq('id', student.user.id);
    if (error) throw new Error(`[import] plan update failed: ${error.message}`);
  }

  async function importCsv(cards: unknown[]) {
    const req = createNextRequest('http://localhost/api/v1/flashcards/import/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards, defaultDeckName: `import-${suiteId}` }),
    });
    const response = await importPost(req);
    return { status: response.status, body: await json<ImportBody>(response) };
  }

  const ownRows = <T extends 'flashcards' | 'flashcard_decks' | 'topics'>(table: T) =>
    db.from(table).select('*').eq('created_by', student.user.id);

  /** Everything an import can write, as the student now owns it. */
  async function owned() {
    const [cards, decks, topics] = await Promise.all([
      ownRows('flashcards'),
      ownRows('flashcard_decks'),
      ownRows('topics'),
    ]);
    return {
      cards: dbRows(cards.data).map((c) => ('front' in c ? c.front : '')),
      decks: dbRows(decks.data).map((d) => ('name' in d ? d.name : '')),
      topics: dbRows(topics.data).map((t) => ('name' in t ? t.name : '')),
    };
  }

  async function wipe() {
    for (const table of ['flashcards', 'flashcard_decks', 'topics'] as const) {
      const { error } = await db.from(table).delete().eq('created_by', student.user.id);
      if (error) throw new Error(`[import] cleanup of ${table} failed: ${error.message}`);
    }
  }

  beforeAll(async () => {
    db = createSeedDb();
    student = await before({ role: 'student' });
    const { data, error } = await db
      .from('profiles')
      .select('personal_plan_key')
      .eq('id', student.user.id)
      .single();
    if (error || !data.personal_plan_key) throw new Error('[import] no personal plan');
    originalPlan = data.personal_plan_key;

    for (const [key, limit] of [
      [roomyPlan, 1000],
      [tightPlan, TIGHT_LIMIT],
    ] as const) {
      const plan = await db.from('subscription_plans').insert({
        key,
        name: key,
        price_monthly: 0,
        currency: 'PLN',
        sort_order: 999,
        scope: 'personal',
        audience: 'student',
        is_active: false,
      });
      if (plan.error) throw new Error(`[import] plan create failed: ${plan.error.message}`);
      const limits = await db
        .from('plan_limits')
        .insert({ plan_key: key, limit_key: 'max_flashcards', limit_value: limit });
      if (limits.error) throw new Error(`[import] limit create failed: ${limits.error.message}`);
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    useRealSupabase();
    mockUser(student.user);
    await wipe();
    await assignPlan(roomyPlan);
  });

  afterAll(async () => {
    await wipe();
    await assignPlan(originalPlan);
    await db.from('plan_limits').delete().in('plan_key', [roomyPlan, tightPlan]);
    await db.from('subscription_plans').delete().in('key', [roomyPlan, tightPlan]);
  });

  it('writes only the good rows and reports the bad ones by their number', async () => {
    const { status, body } = await importCsv([
      { front: 'q1', back: 'a1', topic: 'Kept topic' },
      { front: '', back: 'a2', topic: 'Topic of a bad row' },
      { front: '', back: '' },
      { front: 'q4', back: '   ' },
      { front: 'q5', back: 'a5' },
    ]);

    expect(status).toBe(200);
    expect(body.data).toEqual({
      total: 5,
      imported: 2,
      errors: [
        { row: 2, field: 'front', error: 'VALIDATION_REQUIRED' },
        { row: 3, field: 'front', error: 'VALIDATION_REQUIRED' },
        { row: 3, field: 'back', error: 'VALIDATION_REQUIRED' },
        { row: 4, field: 'back', error: 'VALIDATION_REQUIRED' },
      ],
    });
    const after = await owned();
    expect(after.cards.toSorted()).toEqual(['q1', 'q5']);
    expect(after.decks).toEqual([`import-${suiteId}`]);
    expect(after.topics).toEqual(['Kept topic']);
  });

  it('writes nothing at all when every row is bad', async () => {
    const { status, body } = await importCsv([
      { front: ' ', back: 'a', topic: 'Never', deck: 'Never either' },
      { front: 'q', back: '' },
    ]);

    expect(status).toBe(200);
    expect(body.data).toMatchObject({ total: 2, imported: 0 });
    expect(await owned()).toEqual({ cards: [], decks: [], topics: [] });
  });

  it('imports a file far longer than the dialog preview', async () => {
    const cards = Array.from({ length: 120 }, (_, i) => ({ front: `q${i}`, back: `a${i}` }));

    const { body } = await importCsv(cards);

    expect(body.data).toMatchObject({ total: 120, imported: 120 });
    expect((await owned()).cards).toHaveLength(120);
  });

  it('refuses the whole import past max_flashcards, before writing anything', async () => {
    await assignPlan(tightPlan);
    const cards = Array.from({ length: TIGHT_LIMIT + 1 }, (_, i) => ({
      front: `q${i}`,
      back: 'a',
      topic: 'Over limit',
    }));

    const { status, body } = await importCsv(cards);

    expect(status).toBe(429);
    expect(body.error).toBe('USAGE_LIMIT_EXCEEDED');
    expect(await owned()).toEqual({ cards: [], decks: [], topics: [] });
  });

  it('counts only the rows it would write against the limit, on top of the cards owned', async () => {
    await assignPlan(tightPlan);
    const bad = { front: '', back: '' };

    const first = await importCsv([
      { front: 'q1', back: 'a' },
      { front: 'q2', back: 'a' },
      bad,
      bad,
    ]);
    const second = await importCsv([
      { front: 'q3', back: 'a' },
      { front: 'q4', back: 'a' },
    ]);
    const third = await importCsv([{ front: 'q3', back: 'a' }, bad]);

    expect([first.status, second.status, third.status]).toEqual([200, 429, 200]);
    expect((await owned()).cards.toSorted()).toEqual(['q1', 'q2', 'q3']);
  });
});
