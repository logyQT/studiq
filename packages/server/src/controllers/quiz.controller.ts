import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { GenerateQuizSchema } from '@studiq/server/models/quiz.model';
import { type QuizService, quizService } from '@studiq/server/services/quiz.service';

export class QuizController {
  constructor(private quizService: QuizService) {}

  async generate(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = GenerateQuizSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.quizService.generateQuiz(parsed.data, ctx);

    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.created(result.data);
  }
}
export const quizController = wrapService(new QuizController(quizService), 'quiz.controller');
