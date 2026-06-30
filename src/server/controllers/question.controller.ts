import { questionService } from '@/server/services';
import { CreateQuestionSchema, UpdateQuestionSchema } from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';
import { requireFeature } from '@/server/guards/feature.guard';

export class QuestionController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await requireFeature(ctx, 'test.create');
      const parsed = CreateQuestionSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const question = await questionService.create(parsed.data, ctx);

      return { success: true, statusCode: 201, data: question };
    }, ctx);
  }

  async list(
    ctx: RequestContext,
    filters?: {
      subjectId?: string;
      type?: string;
    },
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const questions = await questionService.list(ctx, filters);

      return { success: true, statusCode: 200, data: questions };
    }, ctx);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const question = await questionService.getById(id, ctx);

      return { success: true, statusCode: 200, data: question };
    }, ctx);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UpdateQuestionSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const question = await questionService.update(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: question };
    }, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await questionService.delete(id, ctx);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }
}

export const questionController = new QuestionController();
