import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { APP_ERRORS, AppError, type AppErrorCode } from '@studiq/server/lib/errors';
import { error as logError } from '@studiq/server/lib/log';
import { z } from '@studiq/server/lib/zod';
import { NextResponse } from 'next/server';

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

  if (response.errorId) {
    body.errorId = response.errorId;
  }

  // Surface the app error code as a header so withAuth() can log it with the
  // failure without re-reading the response body.
  return NextResponse.json(body, {
    status: response.statusCode,
    headers: { 'x-error-code': response.error },
  });
}

export async function handleApiError(
  error: unknown,
  fallback: AppErrorCode = 'INTERNAL_SERVER',
  _ctx?: RequestContext,
): Promise<NextResponse> {
  const status = error instanceof AppError ? error.statusCode : APP_ERRORS[fallback].status;

  if (error instanceof AppError) {
    return NextResponse.json(
      { success: false, error: error.code },
      { status, headers: { 'x-error-code': error.code } },
    );
  }

  logError('Unhandled API error', { error });

  return NextResponse.json(
    { success: false, error: APP_ERRORS[fallback].code },
    { status, headers: { 'x-error-code': APP_ERRORS[fallback].code } },
  );
}
