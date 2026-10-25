import { ApiError } from '@admin/lib/api';

export const QUERY_MAX_RETRIES = 3;

/**
 * Admin queries must not retry client errors: a 404/401 will not become a 200
 * by asking again, and retrying 4xx is what made a missing org look like a ~7 s
 * spinner and what hammered the PEM gate with unsigned requests.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < QUERY_MAX_RETRIES;
}
