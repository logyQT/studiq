import { flashcardPracticeService } from '@/server/services';
import { LogPracticeSchema } from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class FlashcardPracticeController {
  async log(flashcardId: string, body: unknown, userId: string): Promise<ControllerResponse> {
    try {
      const parsed = LogPracticeSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardPracticeService.log(
        flashcardId,
        parsed.data.wasCorrect,
        userId,
        parsed.data.responseTimeMs,
        parsed.data.confidenceLevel,
        parsed.data.sessionId,
      );

      return { success: true, statusCode: 201, data: result };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getHistory(userId: string): Promise<ControllerResponse> {
    try {
      const history = await flashcardPracticeService.getHistory(userId);

      return { success: true, statusCode: 200, data: history };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getHistoryForFlashcard(flashcardId: string, userId: string): Promise<ControllerResponse> {
    try {
      const history = await flashcardPracticeService.getHistoryForFlashcard(flashcardId, userId);

      return { success: true, statusCode: 200, data: history };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async getStatsForFlashcard(_flashcardId: string): Promise<ControllerResponse> {
    return { success: false, statusCode: 501, error: 'NOT_IMPLEMENTED' };
  }

  async getStatsAll(): Promise<ControllerResponse> {
    return { success: false, statusCode: 501, error: 'NOT_IMPLEMENTED' };
  }
}

export const flashcardPracticeController = new FlashcardPracticeController();
