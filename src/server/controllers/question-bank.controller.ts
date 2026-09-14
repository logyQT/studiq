import { can, Permission } from '@/lib/access';
import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import {
  BatchDeleteQuestionBankSchema,
  BulkCreateQuestionBankSchema,
  CreateQuestionBankSchema,
  QuestionBankListQuerySchema,
  UpdateQuestionBankSchema,
} from '@/server/models';
import type { QuestionBankService } from '@/server/services/question-bank.service';

export class QuestionBankController {
  constructor(private questionBankService: QuestionBankService) {}

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await can(ctx, Permission.QUESTION_BANK_CREATE))) throw new AppError('FORBIDDEN');
    const parsed = CreateQuestionBankSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const bank = await this.questionBankService.create(parsed.data, ctx);

    if (isFailure(bank)) {
      return controllerResponse.error(bank.error);
    }

    return controllerResponse.created(bank.data);
  }

  async list(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = QuestionBankListQuerySchema.safeParse(body ?? {});

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.questionBankService.list(ctx, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const bank = await this.questionBankService.getById(id, ctx);

    if (isFailure(bank)) {
      return controllerResponse.error(bank.error);
    }

    return controllerResponse.success(bank.data);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = UpdateQuestionBankSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const bank = await this.questionBankService.update(id, parsed.data, ctx);

    if (isFailure(bank)) {
      return controllerResponse.error(bank.error);
    }

    return controllerResponse.success(bank.data);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.questionBankService.delete(id, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }

  async bulkCreate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BulkCreateQuestionBankSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const banks = await this.questionBankService.bulkCreate(parsed.data, ctx);

    if (isFailure(banks)) {
      return controllerResponse.error(banks.error);
    }

    return controllerResponse.created(banks.data);
  }

  async batchDelete(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BatchDeleteQuestionBankSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.questionBankService.batchDelete(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }
}
