import { flashcardDeckService } from '@/server/services';
import { CreateDeckSchema, UpdateDeckSchema } from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardDeckController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateDeckSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const deck = await flashcardDeckService.create(parsed.data, ctx);

      return { success: true, statusCode: 201, data: deck };
    }, ctx);
  }

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const decks = await flashcardDeckService.list(ctx);

      return { success: true, statusCode: 200, data: decks };
    }, ctx);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const deck = await flashcardDeckService.getById(id, ctx);

      return { success: true, statusCode: 200, data: deck };
    }, ctx);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UpdateDeckSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const deck = await flashcardDeckService.update(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: deck };
    }, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await flashcardDeckService.delete(id, ctx);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }
}

export const flashcardDeckController = new FlashcardDeckController();
