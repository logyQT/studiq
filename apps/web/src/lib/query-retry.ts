import { ApiError } from '@/lib/api';

/** Matches the global `retry: 2` of the web `QueryProvider`. */
export const QUERY_MAX_RETRIES = 2;

/**
 * Web queries must not retry client errors: a 422 for a bad filter, or a 404 for a bank that
 * does not exist, will not become a 200 by asking again. The question list sends the user's
 * filters, so a stale URL or an over-long search used to go through every retry before the
 * error banner appeared. Same policy as the admin panel (`@admin/lib/query-retry`).
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < QUERY_MAX_RETRIES;
}
