import type { ControllerResponse } from '@/lib/controller-response';
import { AppError } from '@/lib/errors';
import { hasPermission, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  BatchDeleteQuestionBankSchema,
  BulkCreateQuestionBankSchema,
  CreateQuestionBankSchema,
  QuestionBankListQuerySchema,
  UpdateQuestionBankSchema,
} from '@/server/models';
import { questionBankService } from '@/server/services';

export class QuestionBankController {
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      if (!(await hasPermission(ctx, Permission.QUESTION_BANK_CREATE)))
        throw new AppError('FORBIDDEN');
      const parsed = CreateQuestionBankSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const bank = await questionBankService.create(parsed.data, ctx);

      return { success: true, statusCode: 201, data: bank };
    }, ctx);
  }

  async list(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = QuestionBankListQuerySchema.safeParse(body ?? {});

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await questionBankService.list(ctx, parsed.data);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const bank = await questionBankService.getById(id, ctx);

      return { success: true, statusCode: 200, data: bank };
    }, ctx);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UpdateQuestionBankSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const bank = await questionBankService.update(id, parsed.data, ctx);

      return { success: true, statusCode: 200, data: bank };
    }, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await questionBankService.delete(id, ctx);

      return { success: true, statusCode: 200, data: { success: true } };
    }, ctx);
  }

  async bulkCreate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BulkCreateQuestionBankSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const banks = await questionBankService.bulkCreate(parsed.data, ctx);

      return { success: true, statusCode: 201, data: banks };
    }, ctx);
  }

  async batchDelete(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = BatchDeleteQuestionBankSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await questionBankService.batchDelete(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }
}

export const questionBankController = new QuestionBankController();
