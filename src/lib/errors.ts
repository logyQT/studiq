import { NextResponse } from 'next/server';

export enum AppErrorCode {
  // 1. Błędy ogólne serwera
  INTERNAL_SERVER = 'ERROR_INTERNAL_SERVER',
  INVALID_INPUT = 'ERROR_INVALID_INPUT',
  VALIDATION_FAILED = 'ERROR_VALIDATION_FAILED',

  // 2. Błędy autoryzacji i sesji
  UNAUTHORIZED = 'ERROR_UNAUTHORIZED',
  FORBIDDEN = 'ERROR_FORBIDDEN',
  INVALID_CREDENTIALS = 'ERROR_INVALID_CREDENTIALS',
  LOGIN_FAILED = 'ERROR_LOGIN_FAILED',
  LOGOUT_FAILED = 'ERROR_LOGOUT_FAILED',
  AUTH_CALLBACK_FAILED = 'ERROR_AUTH_CALLBACK_FAILED',
  SESSION_EXPIRED = 'ERROR_SESSION_EXPIRED',

  // 3. Błędy haseł i resetowania
  SAME_PASSWORD = 'ERROR_SAME_PASSWORD',
  PASSWORD_UPDATE_FAILED = 'ERROR_PASSWORD_UPDATE_FAILED',
  PASSWORD_RESET_FAILED = 'ERROR_PASSWORD_RESET_FAILED',

  // 4. Błędy walidacji formularzy (Zod)
  EMAIL_INVALID = 'ERROR_EMAIL_INVALID',
  EMAIL_REQUIRED = 'ERROR_EMAIL_REQUIRED',

  PASSWORD_REQUIRED = 'ERROR_PASSWORD_REQUIRED',
  PASSWORD_TOO_SHORT = 'ERROR_PASSWORD_TOO_SHORT',
  PASSWORD_TOO_LONG = 'ERROR_PASSWORD_TOO_LONG',
  PASSWORD_MISSING_UPPERCASE = 'ERROR_PASSWORD_MISSING_UPPERCASE',
  PASSWORD_MISSING_NUMBER = 'ERROR_PASSWORD_MISSING_NUMBER',
  PASSWORDS_DO_NOT_MATCH = 'ERROR_PASSWORDS_DO_NOT_MATCH',

  NAME_REQUIRED = 'ERROR_NAME_REQUIRED',
  NAME_TOO_SHORT = 'ERROR_NAME_TOO_SHORT',
  NAME_INVALID_FORMAT = 'ERROR_NAME_INVALID_FORMAT',
}

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

/**
 * Global Error Handler for API controllers.
 * Catches all unhandled errors, logs them, and returns a consistent JSON response.
 */
export function handleApiError(
  error: unknown,
  fallback: AppErrorCode = AppErrorCode.INTERNAL_SERVER,
) {
  const status = error instanceof AppError ? error.statusCode : 500;

  if (!(error instanceof AppError)) {
    console.error('[Unhandled API Error]:', error);
  }

  return NextResponse.json(
    {
      success: false,
      error: getErrorMessage(error, fallback),
    },
    { status },
  );
}
