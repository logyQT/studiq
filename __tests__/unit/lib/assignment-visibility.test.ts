import { hiddenResultAssignmentIds, resultsHidden } from '@studiq/server/lib/assignment-visibility';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { asSupabaseClient } from '#test/helpers/supabase-double';

interface AssignmentRow {
  id: string;
  show_results: boolean;
}

interface DbError {
  message: string;
}

/** A thenable chain implementing the `select().in()` subset the lookup uses. */
interface FakeQueryBuilder {
  select: Mock<() => FakeQueryBuilder>;
  in: Mock<() => FakeQueryBuilder>;
  then: Promise<{ data: AssignmentRow[] | null; error: DbError | null }>['then'];
  catch: Promise<{ data: AssignmentRow[] | null; error: DbError | null }>['catch'];
  finally: Promise<{ data: AssignmentRow[] | null; error: DbError | null }>['finally'];
}

function qb(data: AssignmentRow[] | null, error: DbError | null = null): FakeQueryBuilder {
  const promise = Promise.resolve({ data, error });
  const b: FakeQueryBuilder = {
    select: vi.fn(),
    in: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  b.select.mockImplementation(() => b);
  b.in.mockImplementation(() => b);
  return b;
}

function client(builder: FakeQueryBuilder) {
  // The lookup only touches `from().select().in()`; the rest of the client is
  // never reached, so a partial double is enough.
  return asSupabaseClient({ from: vi.fn(() => builder) });
}

describe('resultsHidden (#374)', () => {
  it('hides unless show_results is explicitly true', () => {
    expect(resultsHidden({ show_results: true })).toBe(false);
    expect(resultsHidden({ show_results: false })).toBe(true);
    expect(resultsHidden({ show_results: null })).toBe(true);
    expect(resultsHidden({})).toBe(true);
    expect(resultsHidden(null)).toBe(true);
    expect(resultsHidden(undefined)).toBe(true);
  });
});

describe('hiddenResultAssignmentIds (#374)', () => {
  it('returns an empty set without querying when there are no ids', async () => {
    const supabase = client(qb([]));

    const result = await hiddenResultAssignmentIds(supabase, [null, undefined]);

    expect(result).toEqual({ success: true, data: new Set() });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns only the ids whose results are hidden', async () => {
    const supabase = client(
      qb([
        { id: 'visible', show_results: true },
        { id: 'hidden', show_results: false },
      ]),
    );

    const result = await hiddenResultAssignmentIds(supabase, ['visible', 'hidden']);

    expect(result.success).toBe(true);
    if (result.success) expect([...result.data]).toEqual(['hidden']);
  });

  it('treats a missing assignment row as hidden', async () => {
    // Fail closed: deleted or RLS-hidden rows must never reveal a score.
    const supabase = client(qb([{ id: 'visible', show_results: true }]));

    const result = await hiddenResultAssignmentIds(supabase, ['visible', 'deleted']);

    expect(result.success).toBe(true);
    if (result.success) expect([...result.data]).toEqual(['deleted']);
  });

  it('deduplicates ids before querying', async () => {
    const builder = qb([{ id: 'assignment-1', show_results: true }]);
    const supabase = client(builder);

    await hiddenResultAssignmentIds(supabase, ['assignment-1', 'assignment-1']);

    expect(builder.in).toHaveBeenCalledWith('id', ['assignment-1']);
  });

  it('returns INTERNAL_SERVER when the lookup fails', async () => {
    const supabase = client(qb(null, { message: 'DB error' }));

    const result = await hiddenResultAssignmentIds(supabase, ['assignment-1']);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('INTERNAL_SERVER');
  });
});
