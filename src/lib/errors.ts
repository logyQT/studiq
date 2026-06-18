export const APP_ERRORS = {
  BAD_REQUEST: { code: 'ERROR_BAD_REQUEST', status: 400 },
  UNAUTHORIZED: { code: 'ERROR_UNAUTHORIZED', status: 401 },
  FORBIDDEN: { code: 'ERROR_FORBIDDEN', status: 403 },
  NOT_FOUND: { code: 'ERROR_NOT_FOUND', status: 404 },
  GONE: { code: 'ERROR_GONE', status: 410 },
  CONFLICT: { code: 'ERROR_CONFLICT', status: 409 },
  UNPROCESSABLE_ENTITY: { code: 'ERROR_UNPROCESSABLE_ENTITY', status: 422 },
  RATE_LIMITED: { code: 'ERROR_RATE_LIMITED', status: 429 },
  USAGE_LIMIT_EXCEEDED: { code: 'ERROR_USAGE_LIMIT_EXCEEDED', status: 429 },
  INTERNAL_SERVER: { code: 'ERROR_INTERNAL_SERVER', status: 500 },
  SERVICE_UNAVAILABLE: { code: 'ERROR_SERVICE_UNAVAILABLE', status: 503 },
} as const;

export type AppErrorCode = keyof typeof APP_ERRORS;

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode) {
    super(APP_ERRORS[code].code);
    this.name = 'AppError';
    this.code = code;
  }

  get statusCode(): number {
    return APP_ERRORS[this.code].status;
  }
}
