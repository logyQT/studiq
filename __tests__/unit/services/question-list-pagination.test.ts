import { AccountType, type RequestContext } from '@studiq/authz';
import { accessibleFilter } from '@studiq/server/lib/authz';
import { QuestionListQuerySchema } from '@studiq/server/models/question.model';
import { QuestionService } from '@studiq/server/services/question.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

vi.mock('@studiq/server/lib/authz', () => ({
  accessibleFilter: vi.fn().mockResolvedValue({}),
  Permission: { QUESTION_READ: 'question.read' as const },
}));

vi.mock('@studiq/server/services/limits.resolver', () => ({
  limitsResolver: { checkLimit: vi.fn().mockResolvedValue(undefined) },
}));

// #651: the question list is paged, searched, filtered and sorted in the database. Without
// `page` the endpoint still answers with the whole array (quiz builder, assignments).

function chain(rows: unknown[], count?: number) {
  const resolved = { data: rows, count, error: null };
  const c: any = {};
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'filter', 'ilike', 'range', 'limit']) {
    c[m] = vi.fn(() => c);
  }
  c.then = (onfulfilled: any) => Promise.resolve(resolved).then(onfulfilled);
  return c;
}

describe('QuestionService.list pagination', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const ctx: RequestContext = {
    userId: 'u1',
    accountType: AccountType.EDUCATOR,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };
  const service = new QuestionService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    vi.mocked(accessibleFilter).mockResolvedValue({} as any);
  });

  it('keeps answering with a plain array, unordered, when no page is requested', async () => {
    const c = chain([{ id: 'q1', content: 'Q1' }]);
    mock.from.mockReturnValue(c);

    const result = await service.list(ctx, { bankId: 'b1' });

    expect(result.success && result.data).toEqual([{ id: 'q1', content: 'Q1', topics: [] }]);
    expect(c.range).not.toHaveBeenCalled();
    expect(c.order).not.toHaveBeenCalled();
    expect(c.select).toHaveBeenCalledWith(expect.any(String));
  });

  it('returns one page with the total count and asks the database for that range', async () => {
    const c = chain([{ id: 'q26', content: 'Q26' }], 51);
    mock.from.mockReturnValue(c);

    const result = await service.list(ctx, { bankId: 'b1', page: 2, limit: 25 });

    expect(result.success && result.data).toEqual({
      items: [{ id: 'q26', content: 'Q26', topics: [] }],
      total: 51,
      page: 2,
      limit: 25,
    });
    expect(c.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
    expect(c.range).toHaveBeenCalledWith(25, 49);
  });

  it('sorts by the requested column with id as the tie-breaker', async () => {
    const c = chain([], 0);
    mock.from.mockReturnValue(c);

    await service.list(ctx, { page: 1, limit: 10, sortBy: 'content', sortOrder: 'asc' });

    expect(c.order).toHaveBeenNthCalledWith(1, 'content', { ascending: true });
    expect(c.order).toHaveBeenNthCalledWith(2, 'id');
  });

  it('defaults to newest first when paged without a sort', async () => {
    const c = chain([], 0);
    mock.from.mockReturnValue(c);

    await service.list(ctx, { page: 1, limit: 10, sortOrder: 'desc' });

    expect(c.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
  });

  it('searches content in the database and escapes LIKE wildcards', async () => {
    const c = chain([], 0);
    mock.from.mockReturnValue(c);

    await service.list(ctx, { page: 1, limit: 10, search: '50%_off\\' });

    expect(c.ilike).toHaveBeenCalledWith('content', '%50\\%\\_off\\\\%');
  });

  it('escapes the PostgREST * wildcard as well', async () => {
    const c = chain([], 0);
    mock.from.mockReturnValue(c);

    await service.list(ctx, { page: 1, limit: 10, search: 'a*b' });

    expect(c.ilike).toHaveBeenCalledWith('content', '%a\\*b%');
  });

  it('applies the type filter and the bank filter next to the access filter', async () => {
    const c = chain([], 0);
    mock.from.mockReturnValue(c);

    await service.list(ctx, { page: 1, limit: 10, bankId: 'b1', type: 'open' });

    expect(c.eq).toHaveBeenCalledWith('bank_id', 'b1');
    expect(c.eq).toHaveBeenCalledWith('type', 'open');
  });

  it('answers an empty page with the REAL total for a page past the last row', async () => {
    const past = chain([]);
    past.then = (onfulfilled: any) =>
      Promise.resolve({
        data: null,
        count: null,
        error: { code: 'PGRST103', message: 'Requested range not satisfiable' },
      }).then(onfulfilled);
    const countOnly = chain([], 60);
    mock.from.mockReturnValueOnce(past).mockReturnValueOnce(countOnly);

    const result = await service.list(ctx, { page: 9, limit: 25, bankId: 'b1', type: 'open' });

    // The pager derives the last page from this total, so it must not be zeroed.
    expect(result.success && result.data).toEqual({ items: [], total: 60, page: 9, limit: 25 });
    // The count runs through the same filters as the rows.
    expect(countOnly.select).toHaveBeenCalledWith(expect.any(String), {
      count: 'exact',
      head: true,
    });
    expect(countOnly.eq).toHaveBeenCalledWith('bank_id', 'b1');
    expect(countOnly.eq).toHaveBeenCalledWith('type', 'open');
  });

  it('answers an empty page when the caller can read nothing', async () => {
    vi.mocked(accessibleFilter).mockResolvedValue({ _impossible: true } as any);

    const paged = await service.list(ctx, { page: 3, limit: 10 });
    const plain = await service.list(ctx);

    expect(paged.success && paged.data).toEqual({ items: [], total: 0, page: 3, limit: 10 });
    expect(plain.success && plain.data).toEqual([]);
    expect(mock.from).not.toHaveBeenCalled();
  });
});

describe('QuestionListQuerySchema', () => {
  it('accepts no parameters at all (legacy callers)', () => {
    const parsed = QuestionListQuerySchema.parse({});
    expect(parsed.page).toBeUndefined();
    expect(parsed.limit).toBe(25);
    expect(parsed.sortOrder).toBe('desc');
  });

  it('coerces page and limit from the query string', () => {
    const parsed = QuestionListQuerySchema.parse({ page: '3', limit: '50', sortBy: 'type' });
    expect(parsed).toMatchObject({ page: 3, limit: 50, sortBy: 'type' });
  });

  it.each([
    ['page 0', { page: '0' }],
    ['limit above the cap', { limit: '101' }],
    ['unknown sort column', { sortBy: 'password' }],
    ['unknown type', { type: 'essay' }],
    ['bank id that is not a uuid', { bankId: 'not-a-uuid' }],
    ['search that is too long', { search: 'x'.repeat(101) }],
  ])('rejects %s', (_name, input) => {
    expect(QuestionListQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('QuestionListQuerySchema topicIds', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const parse = (topicIds?: string) => QuestionListQuerySchema.safeParse({ topicIds });

  it('is an empty list when absent', () => {
    const parsed = parse();
    expect(parsed.success && parsed.data.topicIds).toEqual([]);
  });

  it('trims and dedupes a comma list of uuids', () => {
    const parsed = parse(` ${id(1)}, ${id(2)},${id(1)} `);
    expect(parsed.success && parsed.data.topicIds).toEqual([id(1), id(2)]);
  });

  it.each(['abc', `${id(1)},x`])('rejects %s with a validation error, not a database one', (v) => {
    expect(parse(v).success).toBe(false);
  });

  it('rejects more than 50 ids', () => {
    const many = Array.from({ length: 51 }, (_, i) => id(i + 1)).join(',');
    expect(parse(many).success).toBe(false);
  });
});
