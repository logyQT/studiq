import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { CreateQuestionReportSchema, CreateReportMessageSchema } from '@/server/models';
import type {
  QuestionReportService,
  ReportTarget,
} from '@/server/services/question-report.service';

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
