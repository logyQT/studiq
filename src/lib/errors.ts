export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function isAppError(error: unknown): error is Error {
  return error instanceof Error;
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export enum AppErrorCode {
  INTERNAL_SERVER = 'ERROR_INTERNAL_SERVER',
  INVALID_INPUT = 'ERROR_INVALID_INPUT',
  UNAUTHORIZED = 'ERROR_UNAUTHORIZED',

  INVALID_CREDENTIALS = 'ERROR_INVALID_CREDENTIALS',
  USER_ALREADY_EXISTS = 'ERROR_USER_ALREADY_EXISTS',

  SAME_PASSWORD = 'ERROR_SAME_PASSWORD',
  PASSWORD_UPDATE_FAILED = 'ERROR_PASSWORD_UPDATE_FAILED',
  PASSWORD_RESET_FAILED = 'ERROR_PASSWORD_RESET_FAILED',

  AUTH_CALLBACK_FAILED = 'ERROR_AUTH_CALLBACK_FAILED',
  SESSION_EXPIRED = 'ERROR_SESSION_EXPIRED',
}
