import { flashcardTopicService } from '@/server/services';
import { CreateTopicSchema, UpdateTopicSchema, BatchDeleteTopicSchema, BulkCreateTopicSchema, TopicListQuerySchema } from '@/server/models';
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

  async list(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = TopicListQuerySchema.safeParse(body ?? {});

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardTopicService.list(ctx, parsed.data);
      return { success: true, statusCode: 200, data: result };
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

  async bulkCreate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BulkCreateTopicSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const topics = await flashcardTopicService.bulkCreate(parsed.data, ctx);

      return { success: true, statusCode: 201, data: topics };
    }, ctx);
  }

  async batchDelete(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchDeleteTopicSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardTopicService.batchDelete(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }
}

export const flashcardTopicController = new FlashcardTopicController();
