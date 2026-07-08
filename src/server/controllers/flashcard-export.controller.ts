import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { isFailure } from '@/lib/service-result';
import { ExportQuerySchema } from '@/server/models';
import type { FlashcardExportService } from '@/server/services/flashcard-export.service';

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
    if (parsed.data.deckIds) {
      filters.deckIds = (filters.deckIds ?? []).concat(
        parsed.data.deckIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
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
