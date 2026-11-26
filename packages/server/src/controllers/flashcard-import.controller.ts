import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  type CsvImportResult,
  type CsvImportRow,
  type CsvImportRowError,
  CsvImportRowSchema,
  CsvImportSchema,
} from '@studiq/server/models/flashcard-import.model';
import {
  type FlashcardImportService,
  flashcardImportService,
} from '@studiq/server/services/flashcard-import.service';

/** Splits the rows into the ones to import and the reasons the others are not. */
function judgeRows(rows: unknown[]): { valid: CsvImportRow[]; errors: CsvImportRowError[] } {
  const valid: CsvImportRow[] = [];
  const errors: CsvImportRowError[] = [];

  rows.forEach((row, index) => {
    const parsed = CsvImportRowSchema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }
    for (const issue of parsed.error.issues) {
      errors.push({
        row: index + 1,
        field: CsvImportRowSchema.keyof().parse(issue.path[0]),
        error: issue.message,
      });
    }
  });

  return { valid, errors };
}

export class FlashcardImportController {
  constructor(private service: FlashcardImportService) {}

  async importCsv(body: unknown, ctx: RequestContext): Promise<ControllerResponse> {
    const parsed = CsvImportSchema.safeParse(body);

    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const { valid, errors } = judgeRows(parsed.data.cards);
    const result = await this.service.importCsv({ ...parsed.data, cards: valid }, ctx);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    const report: CsvImportResult = {
      total: parsed.data.cards.length,
      imported: result.data.imported,
      errors,
    };
    return controllerResponse.success(report);
  }
}
export const flashcardImportController = wrapService(
  new FlashcardImportController(flashcardImportService),
  'flashcard-import.controller',
);
