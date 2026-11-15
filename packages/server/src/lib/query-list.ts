import type { PostgrestError } from '@supabase/supabase-js';
import { AppError } from '@studiq/server/lib/errors';
import type { FilterableBuilder } from '@studiq/server/lib/postgrest';
import { readColumn } from '@studiq/server/lib/record';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { z } from '@studiq/server/lib/zod';

/** A cursor is `{ value, id }`; anything else is a corrupt/forged token. */
const CursorSchema = z.object({
  v: z.union([z.string(), z.number()]),
  id: z.string(),
});

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The row-scoping half of `accessibleFilter`, as a read query consumes it. */
export interface AccessFilter {
  or?: string;
  created_by?: string;
  organization_id?: string;
}

/**
 * ANDs the caller's RBAC scope onto a read query. Row visibility must be applied
 * identically wherever a row is read, so the mapping lives here instead of being
 * retyped per projection (and differing by accident).
 */
export function applyAccessFilter<T extends FilterableBuilder<T>>(
  query: T,
  filter: AccessFilter,
): T {
  let filtered = query;
  if (filter.or) filtered = filtered.or(filter.or);
  if (filter.created_by) filtered = filtered.eq('created_by', filter.created_by);
  if (filter.organization_id) filtered = filtered.eq('organization_id', filter.organization_id);
  return filtered;
}

/**
 * The filter composition every content list shares: RBAC scope, then an optional
 * owner restriction, explicit group ids and a text search. The page query and its
 * `total` count both go through it, so the two can never disagree about what the
 * list contains.
 */
export interface ListFilterOptions {
  userId: string;
  /** The list's query params: paging plus the shared `owner`/`q` filters. */
  params: (PageQueryParams & { owner?: string; q?: string }) | undefined;
  groupIds?: string[];
  /** Columns the search term is matched against with `ilike`. */
  searchColumns?: readonly string[];
}

/**
 * One `ilike` term for a PostgREST logic tree. The pattern is double-quoted, so
 * `,` and `(`/`)` stay inside the value instead of ending the term; inside the
 * quotes only `"` and `\` have to be escaped.
 */
function ilikeTerm(column: string, pattern: string): string {
  const quoted = pattern.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `${column}.ilike."${quoted}"`;
}

export function applyListFilters<T extends FilterableBuilder<T>>(
  query: T,
  filter: AccessFilter,
  options: ListFilterOptions,
): T {
  let filtered = applyAccessFilter(query, filter);
  if (options.params?.owner === 'mine') filtered = filtered.eq('created_by', options.userId);
  if (options.groupIds) filtered = filtered.in('id', options.groupIds);

  const search = options.params?.q;
  const pattern = search ? `%${search}%` : '';
  const [firstColumn, ...otherColumns] = options.searchColumns ?? [];
  if (search && firstColumn && otherColumns.length === 0) {
    // A single column needs no logic tree, and `ilike` encodes the value itself —
    // a comma or a quote in the search box must never reach the filter parser.
    filtered = filtered.ilike(firstColumn, pattern);
  } else if (search && firstColumn) {
    filtered = filtered.or(
      [firstColumn, ...otherColumns].map((column) => ilikeTerm(column, pattern)).join(','),
    );
  }
  return filtered;
}

/**
 * Binds `applyListFilters` to one list's scope, so a service reads its filters as
 * a single call instead of re-stating the same option bag in the page and count.
 */
export function listFilters(
  filter: AccessFilter,
  options: ListFilterOptions,
): <T extends FilterableBuilder<T>>(q: T) => T {
  return (q) => applyListFilters(q, filter, options);
}

/**
 * The page a list returns when a filter cannot match anything (an explicit group
 * the caller does not teach, an impossible RBAC scope). `total` is 0 for the same
 * reason the rows are: nothing is visible.
 */
export const EMPTY_PAGE = { items: [], nextCursor: null, hasMore: false, total: 0 } as const;

/**
 * Applies an opaque `(sortBy, id)` cursor. The strict `>` on the tie-breaker
 * makes the boundary row belong to the previous page only, so paging neither
 * repeats nor skips rows that share the sort value.
 */
function applyCursor<T extends { or(filters: string): T }>(
  query: T,
  cursor: string,
  sortBy: string,
  sortAsc: boolean,
): T {
  const { v, id } = decodeCursor(cursor);
  const op = sortAsc ? 'gt' : 'lt';
  return query.or(`${sortBy}.${op}.${v},and(${sortBy}.eq.${v},id.gt.${id})`);
}

/** The transform slice of a list query: ordering, page limit and cursor. */
export interface PageableBuilder<T> {
  order(column: string, options?: { ascending?: boolean }): T;
  limit(count: number): T;
  or(filters: string): T;
}

/**
 * Applies the ordering, cursor and `pageSize + 1` limit a cursor-paginated list
 * needs. `id` is the tie-breaker: without it, rows that share the sort value
 * could swap places between pages and be returned twice.
 */
export function pageQuery<T extends PageableBuilder<T>>(
  query: T,
  opts: { sortBy: string; sortAsc: boolean; pageSize: number; cursor?: string },
): T {
  const ordered = query.order(opts.sortBy, { ascending: opts.sortAsc }).order('id');
  const limited = ordered.limit(opts.pageSize + 1);
  return opts.cursor ? applyCursor(limited, opts.cursor, opts.sortBy, opts.sortAsc) : limited;
}

/** The paging fields `createListQuerySchema` accepts on every list endpoint. */
export interface PageQueryParams {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

export interface Paging {
  sortBy: string;
  sortAsc: boolean;
  /** The page size the caller asked for, already capped at the hard maximum. */
  pageSize: number;
  cursor?: string;
}

/**
 * Resolves the paging contract of a list endpoint: the caller's `sortBy`,
 * `sortOrder` and `limit` against the endpoint's defaults. The hard cap lives
 * here so no list accepts a page size larger than any other.
 */
export function pageParams(
  params: PageQueryParams | undefined,
  defaults: { sortBy: string; limit: number },
): Paging {
  return {
    sortBy: params?.sortBy ?? defaults.sortBy,
    sortAsc: (params?.sortOrder ?? 'desc') === 'asc',
    pageSize: Math.min(params?.limit ?? defaults.limit, 100),
    cursor: params?.cursor,
  };
}

export interface PageOptions<TRow, TItem> extends Pick<Paging, 'pageSize' | 'sortBy'> {
  map: (row: TRow) => TItem;
}

/**
 * Turns the `pageSize + 1` rows a list query fetches into one page: the extra
 * row is what proves there is a next page, and it is not returned — the cursor
 * points at the last returned row instead.
 */
export function toPage<TRow extends { id: string }, TItem>(
  data: TRow[] | null | undefined,
  { pageSize, sortBy, map }: PageOptions<TRow, TItem>,
): PaginatedResult<TItem> {
  const rows = dbRows(data);
  const hasMore = rows.length > pageSize;
  const sliced = hasMore ? rows.slice(0, pageSize) : rows;
  const lastRow = sliced.at(-1);
  const nextCursor =
    hasMore && lastRow ? encodeCursor(readColumn(lastRow, sortBy), lastRow.id) : null;
  return { items: sliced.map(map), nextCursor, hasMore };
}

/**
 * Awaits a list query and cuts its rows into one page. A failed read becomes the
 * `ServiceResult` failure every list returns, so no endpoint can report a page
 * error differently from the others.
 */
export async function readPage<TRow extends { id: string }, TItem>(
  query: PromiseLike<{ data: TRow[] | null; error: PostgrestError | null }>,
  options: PageOptions<TRow, TItem>,
): Promise<ServiceResult<PaginatedResult<TItem>>> {
  const { data, error } = await query;
  if (error) return toDbFailure(error);
  return success(toPage(data, options));
}

export interface CountedPage<TItem> extends PaginatedResult<TItem> {
  /** Rows matching the same filters as the page, ignoring the cursor. */
  total: number;
}

/**
 * Awaits a list page and its `total` count in parallel. Both queries must be
 * built from the same filter function, so the count always describes the set the
 * page was drawn from — a list that shows "3 decks" must not page through 2.
 */
export async function readPageWithTotal<TRow extends { id: string }, TItem>(
  page: PromiseLike<{ data: TRow[] | null; error: PostgrestError | null }>,
  count: PromiseLike<{ count: number | null; error: PostgrestError | null }>,
  options: PageOptions<TRow, TItem>,
): Promise<ServiceResult<CountedPage<TItem>>> {
  const [{ data, error }, counted] = await Promise.all([page, count]);
  if (error) return toDbFailure(error);
  if (counted.error) return toDbFailure(counted.error);
  return success({ ...toPage(data, options), total: counted.count ?? 0 });
}

/**
 * Keeps only the fields a partial update actually sent. A `undefined` value
 * cannot express "leave this column alone" once the body is serialised, so an
 * unsent field has to be absent rather than present-and-undefined.
 */
export function pickDefined<T extends object>(fields: T): Partial<T> {
  const kept: Partial<T> = {};
  for (const key of Object.keys(fields)) {
    const value = readColumn(fields, key);
    if (value !== undefined) Object.assign(kept, { [key]: value });
  }
  return kept;
}

export function encodeCursor(value: unknown, id: unknown): string {
  return Buffer.from(JSON.stringify({ v: value, id })).toString('base64');
}

export function decodeCursor(cursor: string): { v: string | number; id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  } catch {
    throw new AppError('BAD_REQUEST');
  }

  const result = CursorSchema.safeParse(parsed);
  if (!result.success) throw new AppError('BAD_REQUEST');
  return result.data;
}

/**
 * `groups=g1,g2` (#595/#137): comma-joined, trimmed, deduped, max 50.
 * Empty/blank means "no restriction" — the only state that also includes ungrouped rows.
 */
export const groupsParamSchema = z
  .string()
  .optional()
  .default('')
  .transform((raw) =>
    raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.uuid({ error: ValidationErrorCode.UUID_INVALID }))
      .max(50, { error: ValidationErrorCode.TOO_MANY }),
  )
  .transform((ids) => [...new Set(ids)]);

/**
 * Forwards the named query params to a controller, dropping the ones the request
 * did not set — an empty string would otherwise reach the schema as a value.
 * Every list route builds the same object; `limit` arrives as a string and the
 * list schema coerces it, so an absent `?limit=` still falls back to its default.
 */
export function listQuery(
  searchParams: URLSearchParams,
  keys: readonly string[],
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) query[key] = value;
  }
  return query;
}

export function createListQuerySchema<const TSort extends readonly [string, ...string[]]>(opts: {
  /** Sortable columns; `sortBy` is validated against exactly this list. */
  sortColumns: TSort;
  maxLimit?: number;
  defaultLimit?: number;
  sortByDefault?: TSort[number];
  sortOrderDefault?: 'asc' | 'desc';
}) {
  const { sortColumns } = opts;
  const maxLimit = opts.maxLimit ?? 100;
  const defaultLimit = opts.defaultLimit ?? 24;
  const sortByDefault: TSort[number] = opts.sortByDefault ?? sortColumns[0];
  const sortOrderDefault = opts.sortOrderDefault ?? 'desc';

  return z.object({
    q: z.string().optional(),
    sortBy: z
      .enum([...sortColumns])
      .optional()
      .default(sortByDefault),
    sortOrder: z
      .enum(['asc', 'desc'] as const)
      .optional()
      .default(sortOrderDefault),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(maxLimit).optional().default(defaultLimit),
  });
}
