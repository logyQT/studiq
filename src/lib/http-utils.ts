import { NextResponse } from 'next/server';
import type { ControllerResponse } from '@/lib/controller-response';
import { APP_ERRORS, AppError, type AppErrorCode, getErrorMessage } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { z } from '@/lib/zod';
import { errorLogService } from '@/server/services/error-log.service';

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
  ctx?: RequestContext,
): Promise<NextResponse> {
  const status = error instanceof AppError ? error.statusCode : APP_ERRORS[fallback].status;

  if (error instanceof AppError) {
    if (error.code === 'INTERNAL_SERVER') {
      const errorId = await errorLogService.logError(error, error.code, ctx);
      console.error(`[AppError INTERNAL_SERVER] errorId=${errorId}:`, error);
      return NextResponse.json({ success: false, error: error.code, errorId }, { status });
    }

    return NextResponse.json(
      { success: false, error: getErrorMessage(error, APP_ERRORS[fallback].code) },
      { status },
    );
  }

  const errorId = await errorLogService.logError(error, fallback, ctx);
  console.error(`[Unhandled API Error] errorId=${errorId}:`, error);

  return NextResponse.json(
    { success: false, error: APP_ERRORS[fallback].code, errorId },
    { status },
  );
}
