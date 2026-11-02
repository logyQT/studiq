import {
  gradableQuestionCounts,
  isGradableQuestionType,
} from '@studiq/server/lib/gradable-questions';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type Page = { data: unknown[]; error: unknown };

/**
 * A `quiz_attempt_questions` builder that serves one page per `.range()` call,
 * so the helper's paging loop can be exercised (a flat mock would loop forever).
 */
type PagedBuilder = {
  select: Mock;
  order: Mock;
  in: Mock;
  range: Mock;
  then: (
    onFulfilled: (value: Page) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

/** A recorded mock argument, narrowed to the id list the test compares. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('expected a list argument');
  return value.map((entry: unknown) => {
    if (typeof entry !== 'string') throw new Error('expected a string entry');
    return entry;
  });
}

function pagedBuilder(pages: unknown[][], error: unknown = null): PagedBuilder {
  let current: Page = { data: pages[0] ?? [], error };
  const b: PagedBuilder = {
    select: vi.fn(() => b),
    order: vi.fn(() => b),
    in: vi.fn(() => b),
    range: vi.fn((from: number) => {
      current = { data: pages[from / 1000] ?? [], error };
      return b;
    }),
    then: (onFulfilled, onRejected) => Promise.resolve(current).then(onFulfilled, onRejected),
  };
  return b;
}

function mockClient(builder: PagedBuilder) {
  const client = mockSupabaseClient();
  client.from.mockReturnValue(builder);
  return client;
}

const row = (attemptId: string, type: string | null) => ({
  attempt_id: attemptId,
  questions: type === null ? null : { type },
});

describe('isGradableQuestionType (#329/#619)', () => {
  it('counts every auto-graded type', () => {
    for (const type of ['mcq', 'true_false', 'multi_select', 'matching', 'short_answer']) {
      expect(isGradableQuestionType(type)).toBe(true);
    }
  });

  it('excludes open answers and missing question embeds', () => {
    expect(isGradableQuestionType('open')).toBe(false);
    expect(isGradableQuestionType(null)).toBe(false);
    expect(isGradableQuestionType(undefined)).toBe(false);
    expect(isGradableQuestionType('')).toBe(false);
  });
});

describe('gradableQuestionCounts (#619)', () => {
  it('returns an empty map without querying when there are no attempts', async () => {
    const client = mockClient(pagedBuilder([[]]));

    const result = await gradableQuestionCounts(client, []);

    expect(result).toEqual({ success: true, data: new Map() });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('counts closed questions per attempt and skips open / missing embeds', async () => {
    const client = mockClient(
      pagedBuilder([
        [
          row('a-1', 'mcq'),
          row('a-1', 'true_false'),
          row('a-1', 'open'),
          row('a-1', null),
          row('a-2', 'open'),
        ],
      ]),
    );

    const result = await gradableQuestionCounts(client, ['a-1', 'a-2', 'a-1']);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.get('a-1')).toBe(2);
    expect(result.data.get('a-2')).toBeUndefined();
  });

  it('de-duplicates ids and chunks the attempt filter', async () => {
    const builder = pagedBuilder([[]]);
    const client = mockClient(builder);
    const ids = Array.from({ length: 101 }, (_, index) => `a-${index}`);

    const result = await gradableQuestionCounts(client, ids);

    expect(result.success).toBe(true);
    expect(client.from).toHaveBeenCalledTimes(2);
    expect(stringList(builder.in.mock.calls[0][1])).toHaveLength(100);
    expect(stringList(builder.in.mock.calls[1][1])).toEqual(['a-100']);
  });

  it('pages past the PostgREST 1000-row cap instead of truncating the denominator', async () => {
    const firstPage = Array.from({ length: 1000 }, () => row('a-1', 'mcq'));
    const builder = pagedBuilder([firstPage, [row('a-2', 'mcq')]]);
    const client = mockClient(builder);

    const result = await gradableQuestionCounts(client, ['a-1', 'a-2']);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // A silent truncation would have made a-2 disappear from the denominator.
    expect(result.data.get('a-1')).toBe(1000);
    expect(result.data.get('a-2')).toBe(1);
    expect(builder.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('fails closed when the lookup fails', async () => {
    const client = mockClient(pagedBuilder([[]], { message: 'DB error' }));

    const result = await gradableQuestionCounts(client, ['a-1']);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('INTERNAL_SERVER');
  });
});
