import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  CreateQuestionReportSchema,
  CreateReportMessageSchema,
} from '@studiq/server/models/question-report.model';
import type {
  QuestionReportService,
  ReportTarget,
} from '@studiq/server/services/question-report.service';
import { questionReportService } from '@studiq/server/services/question-report.service';

export class QuestionReportController {
  constructor(private service: QuestionReportService) {}

  async createReport(
    target: ReportTarget,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = CreateQuestionReportSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.createReport(target, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.list(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getById(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async addMessage(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = CreateReportMessageSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.addMessage(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async markRead(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.markRead(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async unreadCount(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.unreadCount(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
export const questionReportController = wrapService(
  new QuestionReportController(questionReportService),
  'question-report.controller',
);
