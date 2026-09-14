import type { AppErrorCode } from '@/lib/errors';

export type ServiceResult<T, E extends AppErrorCode = AppErrorCode> =
  | { success: true; data: T }
  | { success: false; error: E };

export function isSuccess<T, E extends AppErrorCode>(
  result: ServiceResult<T, E>,
): result is { success: true; data: T } {
  return result.success;
}

export function isFailure<T, E extends AppErrorCode>(
  result: ServiceResult<T, E>,
): result is { success: false; error: E } {
  return !result.success;
}

export function success<T>(data: T): ServiceResult<T, never> {
  return { success: true, data };
}

export function failure<E extends AppErrorCode>(error: E): ServiceResult<never, E> {
  return { success: false, error };
}
