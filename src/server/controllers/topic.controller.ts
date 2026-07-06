import type { ControllerResponse } from '@/lib/controller-response';
import { AppError } from '@/lib/errors';
import { hasPermission, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  BatchDeleteTopicSchema,
  BulkCreateTopicSchema,
  CreateTopicSchema,
  TopicListQuerySchema,
  UpdateTopicSchema,
} from '@/server/models';
import { topicService } from '@/server/services';

export class TopicController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      if (!(await hasPermission(ctx, Permission.TOPIC_CREATE))) throw new AppError('FORBIDDEN');
      const parsed = CreateTopicSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const topic = await topicService.create(parsed.data, ctx);

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

      const result = await topicService.list(ctx, parsed.data);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const topic = await topicService.getById(id, ctx);

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

      const topic = await topicService.update(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: topic };
    }, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await topicService.delete(id, ctx);

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

      const topics = await topicService.bulkCreate(parsed.data, ctx);

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

      const result = await topicService.batchDelete(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }
}

export const topicController = new TopicController();
