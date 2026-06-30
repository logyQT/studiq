import type { ControllerResponse } from '@/lib/controller-response';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { errorLogService } from '@/server/services';

export async function withErrorHandling(
  fn: () => Promise<ControllerResponse>,
  ctx?: RequestContext,
): Promise<ControllerResponse> {
  const t0 = performance.now();
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) {
      log.trace.error('AppError', {
        metadata: { traceId: ctx?.traceId, code: error.code, message: error.message },
        durationMs: performance.now() - t0,
      });
      if (error.code === 'INTERNAL_SERVER') {
        const errorId = await errorLogService.logError(error, error.code, ctx);
        console.error(`[AppError INTERNAL_SERVER] errorId=${errorId}:`, error);
        return { success: false, statusCode: error.statusCode, error: error.code, errorId };
      }
      return { success: false, statusCode: error.statusCode, error: error.code };
    }

    if (error instanceof SyntaxError) {
      log.trace.warn('SyntaxError', {
        metadata: { traceId: ctx?.traceId, message: error.message },
        durationMs: performance.now() - t0,
      });
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    log.trace.error('unhandled', {
      metadata: { traceId: ctx?.traceId, error: String(error) },
      durationMs: performance.now() - t0,
    });
    const errorId = await errorLogService.logError(error, 'INTERNAL_SERVER', ctx);
    console.error(`[Unhandled API Error] errorId=${errorId}:`, error);

    return {
      success: false,
      statusCode: 500,
      error: 'INTERNAL_SERVER',
      errorId,
    };
  }
}
