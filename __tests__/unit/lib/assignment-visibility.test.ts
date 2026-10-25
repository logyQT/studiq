import { hiddenResultAssignmentIds, resultsHidden } from '@studiq/server/lib/assignment-visibility';
import { describe, expect, it, vi } from 'vitest';

function qb(data: any, error: any = null) {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

function client(builder: any) {
  return { from: vi.fn(() => builder) } as any;
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
