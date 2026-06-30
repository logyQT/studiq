import type { ZodIssue } from 'zod';
import { APP_ERRORS, type AppErrorCode } from '@/lib/errors';

export type ControllerResponse<T = unknown> =
  | { success: true; statusCode: number; data?: T }
  | {
      success: false;
      statusCode: number;
      error: AppErrorCode;
      details?: ZodIssue[];
      errorId?: string;
    };

function success<T>(data: T, statusCode = 200): ControllerResponse<T> {
  return { success: true, statusCode, data };
}

function created<T>(data: T): ControllerResponse<T> {
  return { success: true, statusCode: 201, data };
}

function error(code: AppErrorCode, details?: ZodIssue[]): ControllerResponse {
  const statusCode = APP_ERRORS[code]?.status ?? 500;
  return { success: false, statusCode, error: code, ...(details ? { details } : {}) };
}

export const controllerResponse = { success, created, error };
