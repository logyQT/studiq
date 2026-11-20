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
import {
  CreateQuestionSchema,
  QuestionListQuerySchema,
  UpdateQuestionSchema,
} from '@studiq/server/models/question.model';
import { type QuestionService, questionService } from '@studiq/server/services/question.service';

export class QuestionController {
  constructor(private service: QuestionService) {}

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

    const question = await this.service.create(parsed.data, ctx, bankVisibility);

    if (isFailure(question)) {
      return controllerResponse.error(question.error);
    }

    return controllerResponse.created(question.data);
  }

  async list(ctx: RequestContext, query?: unknown): Promise<ControllerResponse> {
    const parsed = QuestionListQuerySchema.safeParse(query ?? {});

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const questions = await this.service.list(ctx, parsed.data);

    if (isFailure(questions)) {
      return controllerResponse.error(questions.error);
    }

    return controllerResponse.success(questions.data);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const question = await this.service.getById(id, ctx);

    if (isFailure(question)) {
      return controllerResponse.error(question.error);
    }

    return controllerResponse.success(question.data);
  }

  /** R8: the staff ledger of one item — who saw its key, when, and with which classes. */
  async ledger(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    // The service resolves the same staff key against the loaded row; the persona
    // gate the route carried is gone (ADR-0015 §7).
    if (!(await can(ctx, Permission.QUESTION_BANK_UPDATE)))
      return controllerResponse.error('FORBIDDEN');
    const result = await this.service.exposureLedger(id, ctx);
    return isFailure(result)
      ? controllerResponse.error(result.error)
      : controllerResponse.success(result.data);
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

    const question = await this.service.update(id, parsed.data, ctx, bankVisibility);

    if (isFailure(question)) {
      // The authoring rules are judged on the merged item inside the service, so their per-field
      // issues travel with the failure and have to reach the client like a schema 422 does.
      return controllerResponse.error(question.error, question.details);
    }

    return controllerResponse.success(question.data);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.delete(id, ctx);

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
