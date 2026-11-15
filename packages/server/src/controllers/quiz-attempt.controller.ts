import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isRecord } from '@studiq/server/lib/record';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  SaveQuizAnswersSchema,
  SubmitQuizAttemptSchema,
} from '@studiq/server/models/quiz-attempt.model';
import {
  type QuizAttemptService,
  quizAttemptService,
} from '@studiq/server/services/quiz-attempt.service';

/** A request body is spread into the schema input; a non-object body adds nothing. */
function bodyOrEmptyObject(body: unknown): Record<string, unknown> {
  return isRecord(body) ? body : {};
}

export class QuizAttemptController {
  constructor(private service: QuizAttemptService) {}

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.list(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getDetails(attemptId: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.service.getById(attemptId, ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async submit(body: unknown, attemptId: string, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = SubmitQuizAttemptSchema.safeParse({
      ...bodyOrEmptyObject(body),
      attemptId,
    });

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.service.submit(parsed.data, ctx);

    if (isFailure(result)) return controllerResponse.error(result.error, result.details);

    return controllerResponse.success(result.data);
  }

  async saveAnswers(
    body: unknown,
    attemptId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = SaveQuizAnswersSchema.safeParse({
      ...bodyOrEmptyObject(body),
      attemptId,
    });

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.service.saveDraft(parsed.data, ctx);

    if (isFailure(result)) return controllerResponse.error(result.error, result.details);

    return controllerResponse.success(result.data);
  }
}
export const quizAttemptController = wrapService(
  new QuizAttemptController(quizAttemptService),
  'quiz-attempt.controller',
);
