import { AppError } from '@studiq/server/lib/errors';
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
