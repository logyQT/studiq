import type { RequestContext } from '@studiq/authz';
import { can, check, Permission } from '@studiq/server/lib/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { AppError } from '@studiq/server/lib/errors';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { CreateQuestionSchema, UpdateQuestionSchema } from '@studiq/server/models/question.model';
import { type QuestionService, questionService } from '@studiq/server/services/question.service';

export class QuestionController {
  constructor(private questionService: QuestionService) {}

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await can(ctx, Permission.QUESTION_CREATE))) throw new AppError('FORBIDDEN');
    const parsed = CreateQuestionSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    let bankVisibility: string | undefined;
    if (parsed.data.bankId) {
      const supabase = await createClient();
      const { data: bank } = await supabase
        .from('question_banks')
        .select('id, created_by, organization_id, visibility')
        .eq('id', parsed.data.bankId)
        .single();
      if (!bank) throw new AppError('NOT_FOUND');
      await check(ctx, Permission.QUESTION_BANK_UPDATE, bank);
      bankVisibility = bank.visibility;
    }

    const question = await this.questionService.create(parsed.data, ctx, bankVisibility);

    if (isFailure(question)) {
      return controllerResponse.error(question.error);
    }

    return controllerResponse.created(question.data);
  }

  async list(
    ctx: RequestContext,
    filters?: {
      bankId?: string;
      topicIds?: string;
      type?: string;
    },
  ): Promise<ControllerResponse> {
    const questions = await this.questionService.list(ctx, filters);

    if (isFailure(questions)) {
      return controllerResponse.error(questions.error);
    }

    return controllerResponse.success(questions.data);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const question = await this.questionService.getById(id, ctx);

    if (isFailure(question)) {
      return controllerResponse.error(question.error);
    }

    return controllerResponse.success(question.data);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = UpdateQuestionSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    let bankVisibility: string | undefined;
    if (parsed.data.bankId) {
      const supabase = await createClient();
      const { data: bank } = await supabase
        .from('question_banks')
        .select('id, created_by, organization_id, visibility')
        .eq('id', parsed.data.bankId)
        .single();
      if (!bank) throw new AppError('NOT_FOUND');
      await check(ctx, Permission.QUESTION_BANK_UPDATE, bank);
      bankVisibility = bank.visibility;
    }

    const question = await this.questionService.update(id, parsed.data, ctx, bankVisibility);

    if (isFailure(question)) {
      return controllerResponse.error(question.error);
    }

    return controllerResponse.success(question.data);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.questionService.delete(id, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }
}
export const questionController = wrapService(
  new QuestionController(questionService),
  'question.controller',
);
