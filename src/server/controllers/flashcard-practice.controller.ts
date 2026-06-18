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

  async getDueCards(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
    limit: number = 20,
    newOnly: boolean = false,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const cards = await flashcardPracticeService.getDueCards(ctx, filters, limit, newOnly);
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

  async getStateBreakdown(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const breakdown = await flashcardPracticeService.getStateBreakdown(ctx);
      return { success: true, statusCode: 200, data: breakdown };
    }, ctx);
  }

  async getAllCardStats(
    ctx: RequestContext,
    filters?: { deckIds?: string[]; topicIds?: string[]; state?: string; sortBy?: string; order?: string; limit?: number; cursor?: string },
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const result = await flashcardPracticeService.getAllCardStats(ctx, filters);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async getSettings(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const settings = await flashcardPracticeService.getSettings(ctx);
      return { success: true, statusCode: 200, data: settings };
    }, ctx);
  }

  async prepare(
    ctx: RequestContext,
    filters: { deckIds?: string[]; topicIds?: string[] },
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const cards = await flashcardPracticeService.getCardsForPractice(ctx, filters);
      return { success: true, statusCode: 200, data: cards };
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
