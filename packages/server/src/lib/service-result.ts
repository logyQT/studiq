import type { AppErrorCode } from '@studiq/server/lib/errors';
import type { ZodIssue } from 'zod';

export type ServiceResult<T, E extends AppErrorCode = AppErrorCode> =
  { success: true; data: T } | { success: false; error: E; details?: ZodIssue[] };

export function isSuccess<T, E extends AppErrorCode>(
  result: ServiceResult<T, E>,
): result is { success: true; data: T } {
  return result.success;
}

export function isFailure<T, E extends AppErrorCode>(
  result: ServiceResult<T, E>,
): result is { success: false; error: E; details?: ZodIssue[] } {
  return !result.success;
}

export function success<T>(data: T): ServiceResult<T, never> {
  return { success: true, data };
}

/**
 * Most failures are a bare error code. A few (bulk operations) reject a whole
 * batch and must name the offending entries, so the details travel with the
 * result and the controller forwards them into the 4xx `issues` tree.
 */
export function failure<E extends AppErrorCode>(
  error: E,
  details?: ZodIssue[],
): ServiceResult<never, E> {
  return { success: false, error, ...(details && details.length > 0 ? { details } : {}) };
}
