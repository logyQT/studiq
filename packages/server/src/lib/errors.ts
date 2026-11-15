export const APP_ERRORS = {
  BAD_REQUEST: { code: 'ERROR_BAD_REQUEST', status: 400 },
  UNAUTHORIZED: { code: 'ERROR_UNAUTHORIZED', status: 401 },
  INVALID_CURRENT_PASSWORD: { code: 'ERROR_INVALID_CURRENT_PASSWORD', status: 400 },
  FORBIDDEN: { code: 'ERROR_FORBIDDEN', status: 403 },
  EXPORT_FORBIDDEN: { code: 'ERROR_EXPORT_FORBIDDEN', status: 403 },
  REVIEW_LOCKED: { code: 'ERROR_REVIEW_LOCKED', status: 403 },
  NOT_FOUND: { code: 'ERROR_NOT_FOUND', status: 404 },
  GONE: { code: 'ERROR_GONE', status: 410 },
  CONFLICT: { code: 'ERROR_CONFLICT', status: 409 },
  ASSESSMENT_LIVE: { code: 'ERROR_ASSESSMENT_LIVE', status: 409 },
  ASSESSMENT_CLOSED: { code: 'ERROR_ASSESSMENT_CLOSED', status: 409 },
  ASSESSMENT_NOT_LIVE: { code: 'ERROR_ASSESSMENT_NOT_LIVE', status: 409 },
  ASSESSMENT_NOT_PUBLISHED: { code: 'ERROR_ASSESSMENT_NOT_PUBLISHED', status: 409 },
  ASSESSMENT_ALREADY_PUBLISHED: { code: 'ERROR_ASSESSMENT_ALREADY_PUBLISHED', status: 409 },
  ATTEMPTS_CLOSED: { code: 'ERROR_ATTEMPTS_CLOSED', status: 409 },
  ATTEMPTS_NOT_OPEN: { code: 'ERROR_ATTEMPTS_NOT_OPEN', status: 409 },
  ATTEMPT_EXPIRED: { code: 'ERROR_ATTEMPT_EXPIRED', status: 409 },
  EXPOSURE_ACK_REQUIRED: { code: 'ERROR_EXPOSURE_ACK_REQUIRED', status: 409 },
  PAYLOAD_TOO_LARGE: { code: 'ERROR_PAYLOAD_TOO_LARGE', status: 413 },
  UNPROCESSABLE_ENTITY: { code: 'ERROR_UNPROCESSABLE_ENTITY', status: 422 },
  RATE_LIMITED: { code: 'ERROR_RATE_LIMITED', status: 429 },
  USAGE_LIMIT_EXCEEDED: { code: 'ERROR_USAGE_LIMIT_EXCEEDED', status: 429 },
  FEATURE_REQUIRES_UPGRADE: { code: 'ERROR_FEATURE_REQUIRES_UPGRADE', status: 402 },
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
