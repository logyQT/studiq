import type { RequestContext } from '@studiq/authz';
import { can, Permission } from '@studiq/server/lib/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { requireEntitlement } from '@studiq/server/lib/entitlements';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure, type ServiceResult } from '@studiq/server/lib/service-result';
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

  /** Maps a service result to the envelope, 201 when `created`. */
  private fromService(result: ServiceResult<unknown>, created = false): ControllerResponse {
    return isFailure(result)
      ? controllerResponse.error(result.error, result.details)
      : created
        ? controllerResponse.created(result.data)
        : controllerResponse.success(result.data);
  }

  /**
   * The catalog key decides, from the context alone, before any schema parse (ADR-0015 §7).
   * The service resolves the same key against the loaded quiz row, so a foreign id is 404 and
   * a same-org quiz the caller's scope does not reach is 403.
   */
  async create(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    // The saved-quiz library is the paid surface (phase 5d): the entitlement
    // gate is the first statement, before the permission check and the parse —
    // the `ai/chat` precedent. Reads (`list`, `getById`) stay open.
    await requireEntitlement(ctx, 'quiz.templates');
    if (!(await can(ctx, Permission.QUIZ_CREATE))) return controllerResponse.error('FORBIDDEN');
    const parsed = CreateQuizSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    return this.fromService(await this.service.create(parsed.data, ctx), true);
  }

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await can(ctx, Permission.QUIZ_READ))) return controllerResponse.error('FORBIDDEN');
    return this.fromService(await this.service.list(ctx));
  }

  async getById(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    if (!(await can(ctx, Permission.QUIZ_READ))) return controllerResponse.error('FORBIDDEN');
    return this.fromService(await this.service.getById(id, ctx));
  }

  async bulkSave(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    await requireEntitlement(ctx, 'quiz.templates');
    if (!(await can(ctx, Permission.QUIZ_UPDATE))) return controllerResponse.error('FORBIDDEN');
    const parsed = BulkSaveQuizSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    return this.fromService(await this.service.bulkSave(id, parsed.data, ctx));
  }

  async update(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    await requireEntitlement(ctx, 'quiz.templates');
    if (!(await can(ctx, Permission.QUIZ_UPDATE))) return controllerResponse.error('FORBIDDEN');
    const parsed = UpdateQuizSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    return this.fromService(await this.service.update(id, parsed.data, ctx));
  }

  async delete(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    await requireEntitlement(ctx, 'quiz.templates');
    if (!(await can(ctx, Permission.QUIZ_DELETE))) return controllerResponse.error('FORBIDDEN');
    return this.fromService(await this.service.delete(id, ctx));
  }

  async addQuestions(id: string, body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    await requireEntitlement(ctx, 'quiz.templates');
    if (!(await can(ctx, Permission.QUIZ_UPDATE))) return controllerResponse.error('FORBIDDEN');
    const parsed = AddQuizQuestionsSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    return this.fromService(await this.service.addQuestions(id, parsed.data, ctx));
  }

  async removeQuestion(
    id: string,
    questionId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    await requireEntitlement(ctx, 'quiz.templates');
    if (!(await can(ctx, Permission.QUIZ_UPDATE))) return controllerResponse.error('FORBIDDEN');
    return this.fromService(await this.service.removeQuestion(id, questionId, ctx));
  }

  async reorderQuestions(
    id: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    await requireEntitlement(ctx, 'quiz.templates');
    if (!(await can(ctx, Permission.QUIZ_UPDATE))) return controllerResponse.error('FORBIDDEN');
    const parsed = ReorderQuizQuestionsSchema.safeParse(body);
    if (!parsed.success)
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    return this.fromService(await this.service.reorderQuestions(id, parsed.data, ctx));
  }

  async createAssignment(id: string, ctx: RequestContext): Promise<ControllerResponse> {
    // The saved-quiz library is the paid surface (phase 5d): minting an
    // assignment from a saved quiz is a library write, so the entitlement
    // gate runs first. The ad-hoc path (/edu/assignments/new without
    // ?quizId, POST /api/v1/teacher/assignments) stays open.
    await requireEntitlement(ctx, 'quiz.templates');
    // The child acts on the parent quiz's update key, and the assignment it mints
    // is an `assignment.create` write (the INSERT policy asks for the same key).
    if (!(await can(ctx, Permission.QUIZ_UPDATE))) return controllerResponse.error('FORBIDDEN');
    if (!(await can(ctx, Permission.ASSIGNMENT_CREATE)))
      return controllerResponse.error('FORBIDDEN');
    return this.fromService(await this.service.createAssignment(id, ctx), true);
  }
}
export const quizTeacherController = wrapService(
  new QuizTeacherController(quizTeacherService),
  'quiz-teacher.controller',
);
