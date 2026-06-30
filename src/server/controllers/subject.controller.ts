import type { ControllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import { CreateSubjectSchema, UpdateSubjectSchema } from '@/server/models';
import { subjectService } from '@/server/services';

export class SubjectController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateSubjectSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const subject = await subjectService.create(parsed.data, ctx);

      return { success: true, statusCode: 201, data: subject };
    }, ctx);
  }

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const subjects = await subjectService.list(ctx);

      return { success: true, statusCode: 200, data: subjects };
    }, ctx);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const subject = await subjectService.getById(id, ctx);

      return { success: true, statusCode: 200, data: subject };
    }, ctx);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UpdateSubjectSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const subject = await subjectService.update(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: subject };
    }, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await subjectService.delete(id, ctx);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }
}

export const subjectController = new SubjectController();
