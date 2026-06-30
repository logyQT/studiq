import type { ControllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import { DifficultyBucketSchema, TeacherFlashcardStatsQuerySchema } from '@/server/models';
import { flashcardStatsService } from '@/server/services';

export class FlashcardStatsController {
  async getTeacherStats(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = TeacherFlashcardStatsQuerySchema.safeParse(query);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const stats = await flashcardStatsService.getTeacherStats(ctx, parsed.data);
      return { success: true, statusCode: 200, data: stats };
    }, ctx);
  }

  async getDifficultyCards(
    query: { bucket?: string },
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = DifficultyBucketSchema.safeParse(query.bucket);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const cards = await flashcardStatsService.getDifficultyCards(ctx, parsed.data);
      return { success: true, statusCode: 200, data: cards };
    }, ctx);
  }
}

export const flashcardStatsController = new FlashcardStatsController();
