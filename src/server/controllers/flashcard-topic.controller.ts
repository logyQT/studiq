import { flashcardTopicService } from '@/server/services';
import { CreateTopicSchema, UpdateTopicSchema } from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardTopicController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateTopicSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const topic = await flashcardTopicService.create(parsed.data, ctx);

      return { success: true, statusCode: 201, data: topic };
    }, ctx);
  }

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const topics = await flashcardTopicService.list(ctx);

      return { success: true, statusCode: 200, data: topics };
    }, ctx);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const topic = await flashcardTopicService.getById(id, ctx);

      return { success: true, statusCode: 200, data: topic };
    }, ctx);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UpdateTopicSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const topic = await flashcardTopicService.update(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: topic };
    }, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await flashcardTopicService.delete(id, ctx);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }
}

export const flashcardTopicController = new FlashcardTopicController();
