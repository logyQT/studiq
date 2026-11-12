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
