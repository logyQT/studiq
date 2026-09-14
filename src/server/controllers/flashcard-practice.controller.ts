import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { BatchPracticeSchema, CompleteSessionSchema, LogPracticeSchema } from '@/server/models';
import type { FlashcardPracticeService } from '@/server/services/flashcard-practice.service';

export class FlashcardPracticeController {
  constructor(private flashcardPracticeService: FlashcardPracticeService) {}

  async log(flashcardId: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = LogPracticeSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardPracticeService.log(
      flashcardId,
      parsed.data.wasCorrect,
      ctx,
      parsed.data.responseTimeMs,
      parsed.data.confidenceLevel,
      parsed.data.sessionId,
    );

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.created(result.data);
  }

  async batch(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchPracticeSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardPracticeService.batch(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getDueCards(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
    limit: number = 20,
    newOnly: boolean = false,
  ): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getDueCards(ctx, filters, limit, newOnly);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getDueBreakdown(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getDueBreakdown(ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getDueCount(
    ctx: RequestContext,
    filters: { topicIds?: string[]; deckIds?: string[] },
  ): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getDueCount(ctx, filters);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getStatsForFlashcard(
    flashcardId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getStatsForFlashcard(flashcardId, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getStatsAll(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getStatsAll(ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getStateBreakdown(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getStateBreakdown(ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getAllCardStats(
    ctx: RequestContext,
    filters?: {
      deckIds?: string[];
      topicIds?: string[];
      state?: string;
      sortBy?: string;
      order?: string;
      limit?: number;
      cursor?: string;
    },
  ): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getAllCardStats(ctx, filters);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getSettings(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getSettings(ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async prepare(
    ctx: RequestContext,
    filters: { deckIds?: string[]; topicIds?: string[] },
  ): Promise<ControllerResponse> {
    const result = await this.flashcardPracticeService.getCardsForPractice(ctx, filters);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async completeSession(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = CompleteSessionSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardPracticeService.completeSession(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }
}
