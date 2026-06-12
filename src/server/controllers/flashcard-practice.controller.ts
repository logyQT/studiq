import { flashcardPracticeService } from '@/server/services';
import { LogPracticeSchema, BatchPracticeSchema, CompleteSessionSchema } from '@/server/models';
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

  async batch(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchPracticeSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardPracticeService.batch(parsed.data, ctx);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async getHistory(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      // kept for backward compatibility, delegates to service
      return { success: true, statusCode: 200, data: [] };
    }, ctx);
  }

  async getHistoryForFlashcard(
    flashcardId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      return { success: true, statusCode: 200, data: [] };
    }, ctx);
  }

  async getDueCards(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
    limit: number = 20,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const cards = await flashcardPracticeService.getDueCards(ctx, filters, limit);
      return { success: true, statusCode: 200, data: cards };
    }, ctx);
  }

  async getDueBreakdown(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const result = await flashcardPracticeService.getDueBreakdown(ctx);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async getDueCount(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const result = await flashcardPracticeService.getDueCount(ctx, filters);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async getStatsForFlashcard(
    flashcardId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const stats = await flashcardPracticeService.getStatsForFlashcard(flashcardId, ctx);
      return { success: true, statusCode: 200, data: stats };
    }, ctx);
  }

  async getStatsAll(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const stats = await flashcardPracticeService.getStatsAll(ctx);
      return { success: true, statusCode: 200, data: stats };
    }, ctx);
  }

  async completeSession(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CompleteSessionSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardPracticeService.completeSession(parsed.data, ctx);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }
}

export const flashcardPracticeController = new FlashcardPracticeController();
