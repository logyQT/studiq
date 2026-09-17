import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { ExportQuerySchema } from '@studiq/server/models/flashcard-export.model';
import {
  type FlashcardExportService,
  flashcardExportService,
} from '@studiq/server/services/flashcard-export.service';

export class FlashcardExportController {
  constructor(private flashcardExportService: FlashcardExportService) {}

  async exportCsv(
    query: Record<string, string | null>,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = ExportQuerySchema.safeParse(query);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const filters: { deckIds?: string[]; ids?: string[] } = {};

    if (parsed.data.deckId) {
      filters.deckIds = [parsed.data.deckId];
    }
    if (parsed.data.ids) {
      filters.ids = parsed.data.ids
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const result = await this.flashcardExportService.exportCsv(
      ctx,
      Object.keys(filters).length > 0 ? filters : undefined,
    );

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }
}
export const flashcardExportController = wrapService(
  new FlashcardExportController(flashcardExportService),
  'flashcard-export.controller',
);
