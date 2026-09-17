import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  AddQuizQuestionsSchema,
  BulkSaveQuizSchema,
  CreateQuizSchema,
  ReorderQuizQuestionsSchema,
  UpdateQuizSchema,
} from '@studiq/server/models/quiz.model';
import type { QuizTeacherService } from '@studiq/server/services/quiz-teacher.service';
import { quizTeacherService } from '@studiq/server/services/quiz-teacher.service';

export class QuizTeacherController {
  constructor(private service: QuizTeacherService) {}

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = CreateQuizSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.create(parsed.data, ctx);
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

  async bulkSave(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = BulkSaveQuizSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.bulkSave(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = UpdateQuizSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.update(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.delete(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async addQuestions(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = AddQuizQuestionsSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.addQuestions(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async removeQuestion(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const result = await this.service.removeQuestion(id, questionId, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async reorderQuestions(
    id: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = ReorderQuizQuestionsSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.reorderQuestions(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async createAssignment(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.createAssignment(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }
}
export const quizTeacherController = wrapService(
  new QuizTeacherController(quizTeacherService),
  'quiz-teacher.controller',
);
