import { NextResponse } from 'next/server';
import { AppError, AppErrorCode, APP_ERRORS, getErrorMessage } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';
import { z } from '@/lib/zod';

export function toNextResponse<T>(response: ControllerResponse<T>): NextResponse {
  if (response.success) {
    return NextResponse.json(
      { success: true, ...(response.data !== undefined && { data: response.data }) },
      { status: response.statusCode },
    );
  }

  const body: Record<string, unknown> = {
    success: false,
    error: response.error,
  };

  if (response.details) {
    const zodError = new z.ZodError(response.details);
    body.issues = z.treeifyError(zodError);
  }

  return NextResponse.json(body, { status: response.statusCode });
}

export function handleApiError(
  error: unknown,
  fallback: AppErrorCode = 'INTERNAL_SERVER',
): NextResponse {
  const status = error instanceof AppError ? error.statusCode : APP_ERRORS[fallback].status;

  if (!(error instanceof AppError)) {
    console.error('[Unhandled API Error]:', error);
  }

  return NextResponse.json(
    {
      success: false,
      error: getErrorMessage(error, APP_ERRORS[fallback].code),
    },
    { status },
  );
}
