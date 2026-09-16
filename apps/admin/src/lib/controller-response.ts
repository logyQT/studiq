import type { ZodIssue } from 'zod';

import type { AppErrorCode } from '@/lib/errors';

export type ControllerResponse<T = unknown> =
  | { success: true; statusCode: number; data?: T }
  | {
      success: false;
      statusCode: number;
      error: AppErrorCode;
      details?: ZodIssue[];
      errorId?: string;
    };
