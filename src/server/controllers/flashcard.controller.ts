import { flashcardService } from '@/server/services';
import {
  CreateFlashcardSchema,
  BulkCreateFlashcardsSchema,
  UpdateFlashcardSchema,
  LinkFlashcardSchema,
  CopyFlashcardSchema,
} from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

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
    filters?: { topicIds?: string[]; deckIds?: string[] },
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const flashcards = await flashcardService.list(ctx, filters);

      return { success: true, statusCode: 200, data: flashcards };
    }, ctx);
  }

  async bulkCreate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BulkCreateFlashcardsSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const flashcards = await flashcardService.bulkCreate(parsed.data, ctx);

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
}

export const flashcardController = new FlashcardController();
