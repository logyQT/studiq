import { z } from '@studiq/server/lib/zod';

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function encodeCursor(value: unknown, id: unknown): string {
  return Buffer.from(JSON.stringify({ v: value, id })).toString('base64');
}

export function decodeCursor(cursor: string): { v: string | number; id: string } {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
}

export function createListQuerySchema(opts?: {
  sortColumns?: readonly [string, ...string[]];
  maxLimit?: number;
  defaultLimit?: number;
  sortByDefault?: string;
  sortOrderDefault?: 'asc' | 'desc';
}) {
  const sortColumns = opts?.sortColumns ?? (['created_at', 'updated_at', 'name'] as const);
  const maxLimit = opts?.maxLimit ?? 100;
  const defaultLimit = opts?.defaultLimit ?? 24;
  const sortByDefault = opts?.sortByDefault ?? 'created_at';
  const sortOrderDefault = opts?.sortOrderDefault ?? 'desc';

  return z.object({
    q: z.string().optional(),
    sortBy: z
      .enum(sortColumns as [string, ...string[]])
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
