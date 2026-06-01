import { quizService } from '@/server/services';
import { GenerateQuizSchema } from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

export class QuizController {
  async generate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = GenerateQuizSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await quizService.generateQuiz(parsed.data, ctx);

      return { success: true, statusCode: 201, data: result };
    }, ctx);
  }
}

export const quizController = new QuizController();
