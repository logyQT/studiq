import { AppErrorCode } from '@/lib/errors';
import { ZodIssue } from 'zod';

export type ControllerResponse<T = unknown> =
  | { success: true; statusCode: number; data?: T }
  | {
      success: false;
      statusCode: number;
      error: AppErrorCode;
      details?: ZodIssue[];
      errorId?: string;
    };
