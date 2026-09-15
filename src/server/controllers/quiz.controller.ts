import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { GenerateQuizSchema } from '@/server/models/quiz.model';
import { type QuizService, quizService } from '@/server/services/quiz.service';

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
