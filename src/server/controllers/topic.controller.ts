import { can, Permission } from '@/lib/authz';
import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import {
  BatchDeleteTopicSchema,
  BulkCreateTopicSchema,
  CreateTopicSchema,
  TopicListQuerySchema,
  UpdateTopicSchema,
} from '@/server/models';
import type { TopicService } from '@/server/services/topic.service';

export class TopicController {
  constructor(private topicService: TopicService) {}

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await can(ctx, Permission.TOPIC_CREATE))) {
      return controllerResponse.error('FORBIDDEN');
    }
    const parsed = CreateTopicSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.topicService.create(parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async list(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = TopicListQuerySchema.safeParse(body ?? {});

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.topicService.list(ctx, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.topicService.getById(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = UpdateTopicSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.topicService.update(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.topicService.delete(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return { success: true, statusCode: 200, data: { success: true } };
  }

  async bulkCreate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BulkCreateTopicSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.topicService.bulkCreate(parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async batchDelete(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchDeleteTopicSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.topicService.batchDelete(parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
