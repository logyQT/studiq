import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import {
  AddQuestionsSchema,
  CreateTeacherAssignmentSchema,
  GradeAnswerSchema,
  PublishAssignmentSchema,
  RandomizeSchema,
  ReorderQuestionsSchema,
  SetTargetsSchema,
  UpdateTeacherAssignmentSchema,
} from '@/server/models';
import type { TeacherAssignmentService } from '@/server/services/teacher-assignment.service';

export class TeacherAssignmentController {
  constructor(private service: TeacherAssignmentService) {}

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = CreateTeacherAssignmentSchema.safeParse(body);
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

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = UpdateTeacherAssignmentSchema.safeParse(body);
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

  async publish(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = PublishAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.publish(id, parsed.data.deadline, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async addQuestions(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = AddQuestionsSchema.safeParse(body);
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

  async randomize(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = RandomizeSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.randomize(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async reorderQuestions(
    id: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = ReorderQuestionsSchema.safeParse(body);
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

  async setTargets(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = SetTargetsSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.setTargets(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getResults(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getResults(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getStudentAnswers(
    id: string,
    studentId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const result = await this.service.getStudentAnswers(id, studentId, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async gradeAnswer(
    id: string,
    studentId: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = GradeAnswerSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.service.gradeAnswer(id, studentId, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async listForStudent(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.listForStudent(ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getForStudent(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getForStudent(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async startAttempt(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.startAttempt(id, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async exportAnswers(
    id: string,
    studentId: string | undefined,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const result = await this.service.exportAnswers(id, studentId, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async uploadImage(
    id: string,
    attemptId: string,
    questionId: string,
    imageUrl: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const result = await this.service.uploadImage(id, attemptId, questionId, imageUrl, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
