import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';
import { errorLogService } from '@/server/services';
import type { RequestContext } from '@/lib/request-context';

export async function withErrorHandling(
  fn: () => Promise<ControllerResponse>,
  ctx?: RequestContext,
): Promise<ControllerResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === 'INTERNAL_SERVER') {
        const errorId = await errorLogService.logError(error, error.code, ctx);
        console.error(`[AppError INTERNAL_SERVER] errorId=${errorId}:`, error);
        return { success: false, statusCode: error.statusCode, error: error.code, errorId };
      }
      return { success: false, statusCode: error.statusCode, error: error.code };
    }

    if (error instanceof SyntaxError) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

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
