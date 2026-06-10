import { quizAttemptService } from '@/server/services';
import { SubmitQuizAttemptSchema } from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class QuizAttemptController {
  async list(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const attempts = await quizAttemptService.list(ctx);

      return { success: true, statusCode: 200, data: attempts };
    }, ctx);
  }

  async getDetails(attemptId: string, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const attempt = await quizAttemptService.getById(attemptId, ctx);

      return { success: true, statusCode: 200, data: attempt };
    }, ctx);
  }

  async submit(
    body: unknown,
    attemptId: string,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
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

      const result = await quizAttemptService.submit(parsed.data, ctx);

      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }
}

export const quizAttemptController = new QuizAttemptController();
