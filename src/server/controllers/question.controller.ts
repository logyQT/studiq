import type { ControllerResponse } from '@/lib/controller-response';
import { AppError } from '@/lib/errors';
import { hasPermission, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import { CreateQuestionSchema, UpdateQuestionSchema } from '@/server/models';
import { questionService } from '@/server/services';

export class QuestionController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      if (!(await hasPermission(ctx, Permission.TEST_CREATE))) throw new AppError('FORBIDDEN');
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
