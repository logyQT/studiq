import type { RequestContext } from '@studiq/authz';
import { can, Permission } from '@studiq/server/lib/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure, type ServiceResult } from '@studiq/server/lib/service-result';
import {
  AddQuestionsSchema,
  CreateTeacherAssignmentSchema,
  ExtendAssignmentSchema,
  GradeAnswerSchema,
  OverrideAssignmentSchema,
  PublishAssignmentSchema,
  RandomizeSchema,
  ReorderQuestionsSchema,
  SetTargetsSchema,
  TaughtItemSchema,
  UpdateTeacherAssignmentSchema,
  WithholdItemSchema,
} from '@studiq/server/models/teacher-assignment.model';
import type { TeacherAssignmentService } from '@studiq/server/services/teacher-assignment.service';
import {
  type AnswersExportRow,
  teacherAssignmentService,
} from '@studiq/server/services/teacher-assignment.service';

export class TeacherAssignmentController {
  constructor(private service: TeacherAssignmentService) {}

  /**
   * The route-layer persona gate is gone (ADR-0015 §7): the catalog key decides from
   * the context alone, before any schema parse. The service resolves the same key
   * against the loaded assignment row, so a foreign id is 404 and a same-org run the
   * caller's scope does not reach is 403.
   */
  private async gate<T>(
    ctx: RequestContext,
    permission: (typeof Permission)[keyof typeof Permission],
  ): Promise<ControllerResponse<T> | null> {
    return (await can(ctx, permission)) ? null : controllerResponse.error('FORBIDDEN');
  }

  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_CREATE);
    if (denied) return denied;
    const parsed = CreateTeacherAssignmentSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.create(parsed.data, ctx);
    return isFailure(result)
      ? controllerResponse.error(result.error)
      : controllerResponse.created(result.data);
  }

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_READ);
    if (denied) return denied;
    return this.fromService(await this.service.list(ctx));
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_READ);
    if (denied) return denied;
    return this.fromService(await this.service.getById(id, ctx));
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = UpdateTeacherAssignmentSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    return this.fromService(await this.service.update(id, parsed.data, ctx));
  }

  /** A service refusal keeps its per-field issues, so the deadline rule can answer on the field. */
  private fromService(result: ServiceResult<unknown>, created = false): ControllerResponse {
    if (isFailure(result)) return controllerResponse.error(result.error, result.details);
    return created
      ? controllerResponse.created(result.data)
      : controllerResponse.success(result.data);
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_DELETE);
    if (denied) return denied;
    return this.fromService(await this.service.delete(id, ctx));
  }

  async unpublish(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    return this.fromService(await this.service.unpublish(id, ctx));
  }

  async close(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    return this.fromService(await this.service.close(id, ctx));
  }

  async cancel(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    return this.fromService(await this.service.cancel(id, ctx));
  }

  async extend(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = ExtendAssignmentSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.extend(id, parsed.data.closesAt, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error, result.details);
    return controllerResponse.success(result.data);
  }

  async override(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = OverrideAssignmentSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.override(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error, result.details);
    return controllerResponse.success(result.data);
  }

  async setReviewHold(
    id: string,
    questionId: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = WithholdItemSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.setReviewHold(id, questionId, parsed.data.withheld, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async releaseItem(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    return this.fromService(await this.service.releaseItem(id, questionId, ctx));
  }

  /** R9: declares one assessment item taught (draft only, frozen at publish). */
  async setTaughtItem(
    id: string,
    questionId: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = TaughtItemSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.setTaughtItem(id, questionId, parsed.data.taught, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async publish(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = PublishAssignmentSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.publish(id, parsed.data, ctx);
    // A publish refusal carries the field paths that make it invalid (422), so the composer can
    // point at the control instead of showing a generic failure.
    if (isFailure(result)) return controllerResponse.error(result.error, result.details);
    return controllerResponse.success(result.data);
  }

  async addQuestions(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = AddQuestionsSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.addQuestions(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async removeQuestion(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const removed = await this.service.removeQuestion(id, questionId, ctx);
    return this.fromService(removed);
  }

  async randomize(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = RandomizeSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.randomize(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async reorderQuestions(
    id: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = ReorderQuestionsSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.reorderQuestions(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async setTargets(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = SetTargetsSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.setTargets(id, parsed.data, ctx);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getResults(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    return this.fromService(await this.service.getResults(id, ctx));
  }

  async getStudentAnswers(
    id: string,
    attemptId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    return this.fromService(await this.service.getStudentAnswers(id, attemptId, ctx));
  }

  async gradeAnswer(
    id: string,
    attemptId: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const denied = await this.gate(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
    const parsed = GradeAnswerSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    const result = await this.service.gradeAnswer(id, attemptId, parsed.data, ctx);
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
  ): Promise<ControllerResponse<AnswersExportRow[]>> {
    const denied = await this.gate<AnswersExportRow[]>(ctx, Permission.ASSIGNMENT_UPDATE);
    if (denied) return denied;
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
export const teacherAssignmentController = wrapService(
  new TeacherAssignmentController(teacherAssignmentService),
  'teacher-assignment.controller',
);
