import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  DifficultyBucketSchema,
  TeacherFlashcardStatsQuerySchema,
} from '@studiq/server/models/flashcard-stats.model';
import {
  type FlashcardStatsService,
  flashcardStatsService,
} from '@studiq/server/services/flashcard-stats.service';

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
