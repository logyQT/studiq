import { quizService } from '@/server/services';
import { GenerateQuizSchema } from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class QuizController {
  async generate(body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = GenerateQuizSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await quizService.generateQuiz(parsed.data, userId);

      return { success: true, statusCode: 201, data: result };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const quizController = new QuizController();
