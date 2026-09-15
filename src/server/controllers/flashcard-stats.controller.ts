import type { RequestContext } from '@studiq/authz';
import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import { isFailure } from '@/lib/service-result';
import {
  DifficultyBucketSchema,
  TeacherFlashcardStatsQuerySchema,
} from '@/server/models/flashcard-stats.model';
import {
  type FlashcardStatsService,
  flashcardStatsService,
} from '@/server/services/flashcard-stats.service';

export class FlashcardStatsController {
  constructor(private flashcardStatsService: FlashcardStatsService) {}

  async getTeacherStats(query: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = TeacherFlashcardStatsQuerySchema.safeParse(query);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardStatsService.getTeacherStats(ctx, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }

  async getDifficultyCards(
    query: { bucket?: string },
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = DifficultyBucketSchema.safeParse(query.bucket);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardStatsService.getDifficultyCards(ctx, parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }
}
export const flashcardStatsController = wrapService(
  new FlashcardStatsController(flashcardStatsService),
  'flashcard-stats.controller',
);
