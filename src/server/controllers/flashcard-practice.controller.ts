import { flashcardPracticeService } from '@/server/services';
import { LogPracticeSchema } from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardPracticeController {
  async log(
    flashcardId: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = LogPracticeSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardPracticeService.log(
        flashcardId,
        parsed.data.wasCorrect,
        ctx,
        parsed.data.responseTimeMs,
        parsed.data.confidenceLevel,
        parsed.data.sessionId,
      );

      return { success: true, statusCode: 201, data: result };
    }, ctx);
  }

  async getHistory(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const history = await flashcardPracticeService.getHistory(ctx);

      return { success: true, statusCode: 200, data: history };
    }, ctx);
  }

  async getHistoryForFlashcard(
    flashcardId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const history = await flashcardPracticeService.getHistoryForFlashcard(flashcardId, ctx);

      return { success: true, statusCode: 200, data: history };
    }, ctx);
  }

  async getStatsForFlashcard(_flashcardId: string): Promise<ControllerResponse> {
    return { success: false, statusCode: 501, error: 'NOT_IMPLEMENTED' };
  }

  async getStatsAll(): Promise<ControllerResponse> {
    return { success: false, statusCode: 501, error: 'NOT_IMPLEMENTED' };
  }
}

export const flashcardPracticeController = new FlashcardPracticeController();
