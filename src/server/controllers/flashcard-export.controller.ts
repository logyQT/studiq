import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';
import { ExportQuerySchema } from '@/server/models';
import { flashcardExportService } from '@/server/services';

export class FlashcardExportController {
  async exportCsv(
    query: Record<string, string | null>,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
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

      const csv = await flashcardExportService.exportCsv(
        ctx,
        Object.keys(filters).length > 0 ? filters : undefined,
      );
      return controllerResponse.success(csv);
    }, ctx);
  }
}

export const flashcardExportController = new FlashcardExportController();
