import { flashcardImportService } from '@/server/services';
import { CsvImportSchema } from '@/server/models';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';
import type { ControllerResponse } from '@/lib/controller-response';

export class FlashcardImportController {
  async importCsv(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CsvImportSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await flashcardImportService.importCsv(parsed.data, ctx);
      return { success: true, statusCode: 200, data: result };
    }, ctx);
  }
}

export const flashcardImportController = new FlashcardImportController();
