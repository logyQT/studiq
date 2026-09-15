import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { SubmitQuizAttemptSchema } from '@/server/models/quiz-attempt.model';
import {
  type QuizAttemptService,
  quizAttemptService,
} from '@/server/services/quiz-attempt.service';

export class QuizAttemptController {
  constructor(private quizAttemptService: QuizAttemptService) {}

  async list(ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.quizAttemptService.list(ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async getDetails(attemptId: string, ctx: RequestContext): Promise<ControllerResponse> {
    const result = await this.quizAttemptService.getById(attemptId, ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }

  async submit(body: unknown, attemptId: string, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = SubmitQuizAttemptSchema.safeParse({
      ...(body as Record<string, unknown>),
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

    const result = await this.quizAttemptService.submit(parsed.data, ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.success(result.data);
  }
}
export const quizAttemptController = wrapService(
  new QuizAttemptController(quizAttemptService),
  'quiz-attempt.controller',
);
