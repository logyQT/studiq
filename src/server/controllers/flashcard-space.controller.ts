import { flashcardSpaceService } from '@/server/services';
import { CreateSpaceSchema, UpdateSpaceSchema } from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardSpaceController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateSpaceSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const space = await flashcardSpaceService.create(parsed.data, ctx);

      return { success: true, statusCode: 201, data: space };
    }, ctx);
  }

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const spaces = await flashcardSpaceService.list(ctx);

      return { success: true, statusCode: 200, data: spaces };
    }, ctx);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const space = await flashcardSpaceService.getById(id, ctx);

      return { success: true, statusCode: 200, data: space };
    }, ctx);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UpdateSpaceSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const space = await flashcardSpaceService.update(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: space };
    }, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await flashcardSpaceService.delete(id, ctx);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }
}

export const flashcardSpaceController = new FlashcardSpaceController();
