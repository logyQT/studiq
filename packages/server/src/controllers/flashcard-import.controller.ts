import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { CsvImportSchema } from '@studiq/server/models/flashcard-import.model';
import {
  type FlashcardImportService,
  flashcardImportService,
} from '@studiq/server/services/flashcard-import.service';

export class FlashcardImportController {
  constructor(private flashcardImportService: FlashcardImportService) {}

  async importCsv(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = CsvImportSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.flashcardImportService.importCsv(parsed.data, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success(result.data);
  }
}
export const flashcardImportController = wrapService(
  new FlashcardImportController(flashcardImportService),
  'flashcard-import.controller',
);
