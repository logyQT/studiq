import { NextResponse } from 'next/server';
import type { ControllerResponse } from '@/lib/controller-response';
import { APP_ERRORS, AppError, type AppErrorCode } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
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

  if (response.errorId) {
    body.errorId = response.errorId;
  }

  return NextResponse.json(body, { status: response.statusCode });
}

export async function handleApiError(
  error: unknown,
  fallback: AppErrorCode = 'INTERNAL_SERVER',
  _ctx?: RequestContext,
): Promise<NextResponse> {
  const status = error instanceof AppError ? error.statusCode : APP_ERRORS[fallback].status;

  if (error instanceof AppError) {
    return NextResponse.json({ success: false, error: error.code }, { status });
  }

  console.error('[Unhandled API Error]', error);

  return NextResponse.json({ success: false, error: APP_ERRORS[fallback].code }, { status });
}
