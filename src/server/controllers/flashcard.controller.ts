import { flashcardService } from '@/server/services';
import {
  CreateFlashcardSchema,
  BulkCreateFlashcardsSchema,
  UpdateFlashcardSchema,
  LinkFlashcardSchema,
  CopyFlashcardSchema,
  BatchDeleteSchema,
  BatchLinkSchema,
  BatchTopicsSchema,
  BatchMoveSchema,
  BatchCopySchema,
  UnlinkFlashcardSchema,
  BatchUnlinkSchema,
} from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';
import { log } from '@/lib/logger';

export class FlashcardController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateFlashcardSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const flashcard = await flashcardService.create(parsed.data, ctx);

      return { success: true, statusCode: 201, data: flashcard };
    }, ctx);
  }

  async list(
    ctx: RequestContext,
    filters?: { topicIds?: string[]; deckIds?: string[]; q?: string; sortBy?: string; sortOrder?: string; cursor?: string; limit?: number },
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const result = await flashcardService.list(ctx, filters);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async bulkCreate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BulkCreateFlashcardsSchema.safeParse(body);
      const t0 = performance.now();

      if (!parsed.success) {
        log.trace.warn('bulkCreate:validation_failed', {
          metadata: { traceId: ctx.traceId, issues: parsed.error.issues },
          durationMs: performance.now() - t0,
        });
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const cardCount = parsed.data.cards.length;
      log.trace.info('bulkCreate:validation_ok', {
        metadata: { traceId: ctx.traceId, cardCount, deckIds: parsed.data.deckIds?.length ?? 0, topicIds: parsed.data.topicIds?.length ?? 0 },
        durationMs: performance.now() - t0,
      });

      const flashcards = await flashcardService.bulkCreate(parsed.data, ctx);

      log.trace.info('bulkCreate:success', {
        metadata: { traceId: ctx.traceId, created: flashcards?.length },
        durationMs: performance.now() - t0,
      });

      return { success: true, statusCode: 201, data: flashcards };
    }, ctx);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const flashcard = await flashcardService.getById(id, ctx);

      return { success: true, statusCode: 200, data: flashcard };
    }, ctx);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UpdateFlashcardSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const flashcard = await flashcardService.update(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: flashcard };
    }, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await flashcardService.delete(id, ctx);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }

  async link(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = LinkFlashcardSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const flashcard = await flashcardService.link(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: flashcard };
    }, ctx);
  }

  async copy(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CopyFlashcardSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const flashcard = await flashcardService.copy(id, parsed.data, ctx);

      return { success: true, statusCode: 201, data: flashcard };
    }, ctx);
  }

  async batchDelete(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchDeleteSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardService.batchDelete(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async batchLink(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchLinkSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardService.batchLink(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async batchTopics(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchTopicsSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardService.batchTopics(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async batchMove(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchMoveSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardService.batchMove(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async unlinkFromDeck(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UnlinkFlashcardSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardService.unlinkFromDeck(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async batchUnlink(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchUnlinkSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardService.batchUnlinkFromDeck(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async batchCopy(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchCopySchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardService.batchCopy(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }
}

export const flashcardController = new FlashcardController();
