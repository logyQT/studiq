import { AppError } from '@studiq/server/lib/errors';
import {
  applyListFilters,
  decodeCursor,
  encodeCursor,
  pageParams,
  readPage,
  toPage,
} from '@studiq/server/lib/query-list';
import type { FilterableBuilder } from '@studiq/server/lib/postgrest';
import { describe, expect, it } from 'vitest';

describe('cursor helpers', () => {
  it('round-trips a value and id', () => {
    expect(decodeCursor(encodeCursor('2024-01-02T00:00:00Z', 'row-2'))).toEqual({
      v: '2024-01-02T00:00:00Z',
      id: 'row-2',
    });
  });

  it('rejects a non-JSON cursor as BAD_REQUEST', () => {
    const cursor = Buffer.from('not json').toString('base64');
    expect(() => decodeCursor(cursor)).toThrow(AppError);
  });

  it('rejects a valid-JSON cursor with the wrong shape as BAD_REQUEST', () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1 })).toString('base64');
    expect(() => decodeCursor(cursor)).toThrow(AppError);
  });
});

describe('pageParams', () => {
  it('falls back to the endpoint defaults and caps the page size at 100', () => {
    expect(pageParams(undefined, { sortBy: 'created_at', limit: 24 })).toEqual({
      sortBy: 'created_at',
      sortAsc: false,
      pageSize: 24,
      cursor: undefined,
    });
    expect(pageParams({ limit: 500 }, { sortBy: 'created_at', limit: 24 }).pageSize).toBe(100);
    expect(
      pageParams(
        { sortBy: 'name', sortOrder: 'asc', limit: 10 },
        { sortBy: 'created_at', limit: 24 },
      ),
    ).toMatchObject({ sortBy: 'name', sortAsc: true, pageSize: 10 });
  });
});

/**
 * Records the filters `applyListFilters` applies, so the search term's path into
 * PostgREST is asserted instead of inferred from a rendered URL.
 */
function fakeBuilder() {
  const calls: Array<readonly [string, ...string[]]> = [];
  const query: FilterableBuilder<unknown> = {
    or: (filters: string) => {
      calls.push(['or', filters]);
      return query;
    },
    eq: (column: string, value: string) => {
      calls.push(['eq', column, value]);
      return query;
    },
    neq: () => query,
    not: () => query,
    in: (column: string, values: readonly string[]) => {
      calls.push(['in', column, ...values]);
      return query;
    },
    ilike: (column: string, pattern: string) => {
      calls.push(['ilike', column, pattern]);
      return query;
    },
  };
  return { calls, query };
}

function searchCalls(q: string, searchColumns: readonly string[]) {
  const { calls, query } = fakeBuilder();
  applyListFilters(query, {}, { userId: 'user-1', params: { q }, searchColumns });
  return calls;
}

describe('applyListFilters search', () => {
  it('uses a plain ilike, never a logic tree, when there is one search column', () => {
    expect(searchCalls('Algebra, chapter 5', ['name'])).toEqual([
      ['ilike', 'name', '%Algebra, chapter 5%'],
    ]);
  });

  it.each(['(x)', 'a"b', '100%', '   ', ','])('passes %j through ilike untouched', (term) => {
    expect(searchCalls(term, ['name'])).toEqual([['ilike', 'name', `%${term}%`]]);
  });

  it('quotes each value so a comma stays inside the term when the search spans columns', () => {
    expect(searchCalls('a,b', ['name', 'description'])).toEqual([
      ['or', 'name.ilike."%a,b%",description.ilike."%a,b%"'],
    ]);
  });

  it('escapes a quote and a backslash inside the quoted value', () => {
    expect(searchCalls('a"b\\c', ['name', 'description'])).toEqual([
      ['or', 'name.ilike."%a\\"b\\\\c%",description.ilike."%a\\"b\\\\c%"'],
    ]);
  });

  it('applies no search filter for an empty q', () => {
    expect(searchCalls('', ['name'])).toEqual([]);
  });
});

const mapId = (row: { id: string }) => row.id;

describe('toPage', () => {
  it('drops the probe row and points the cursor at the last returned row', () => {
    const rows = [
      { id: 'a', created_at: '2026-01-03' },
      { id: 'b', created_at: '2026-01-02' },
      { id: 'c', created_at: '2026-01-01' },
    ];
    const page = toPage(rows, { pageSize: 2, sortBy: 'created_at', map: mapId });
    expect(page.items).toEqual(['a', 'b']);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor!)).toEqual({ v: '2026-01-02', id: 'b' });
  });

  it('reports no next page when the read returned exactly one page', () => {
    const page = toPage([{ id: 'a', created_at: '2026-01-03' }], {
      pageSize: 2,
      sortBy: 'created_at',
      map: mapId,
    });
    expect(page).toEqual({ items: ['a'], nextCursor: null, hasMore: false });
  });

  it('treats a missing list as an empty page', () => {
    expect(toPage(null, { pageSize: 2, sortBy: 'created_at', map: mapId })).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });
});

describe('readPage', () => {
  it('maps a successful read into a page', async () => {
    const result = await readPage(
      Promise.resolve({ data: [{ id: 'a' }, { id: 'b' }], error: null }),
      { pageSize: 1, sortBy: 'id', map: mapId },
    );
    expect(result).toMatchObject({ success: true, data: { items: ['a'], hasMore: true } });
  });

  it('turns a failed read into a NOT_FOUND-style DB failure', async () => {
    const result = await readPage(
      Promise.resolve({
        data: null,
        error: {
          name: 'PostgrestError',
          message: 'no rows',
          details: '',
          hint: '',
          code: 'PGRST116',
        },
      }),
      { pageSize: 1, sortBy: 'id', map: mapId },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toBe('NOT_FOUND');
  });
});
