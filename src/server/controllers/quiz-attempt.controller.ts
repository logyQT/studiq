import { quizAttemptService } from '@/server/services';
import { SubmitQuizAttemptSchema } from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class QuizAttemptController {
  async list(userId: string): Promise<ControllerResponse> {
    try {
      const attempts = await quizAttemptService.list(userId);

      return { success: true, statusCode: 200, data: attempts };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getDetails(attemptId: string, userId: string): Promise<ControllerResponse> {
    try {
      const attempt = await quizAttemptService.getById(attemptId, userId);

      return { success: true, statusCode: 200, data: attempt };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async submit(body: unknown, attemptId: string, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = SubmitQuizAttemptSchema.safeParse({ ...(body as Record<string, unknown>), attemptId });

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await quizAttemptService.submit(parsed.data, userId);

      return { success: true, statusCode: 200, data: result };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const quizAttemptController = new QuizAttemptController();
