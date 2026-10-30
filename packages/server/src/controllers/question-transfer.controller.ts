import type { RequestContext } from '@studiq/authz';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { questionsToCsv } from '@studiq/server/lib/question-transfer';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  ExportQuestionsQuerySchema,
  ImportQuestionsSchema,
} from '@studiq/server/models/question-transfer.model';
import {
  type QuestionTransferService,
  questionTransferService,
} from '@studiq/server/services/question-transfer.service';

/** A file the route sends as a download. */
export interface QuestionExportFile {
  body: string;
  contentType: string;
  filename: string;
  /** Exported questions the importer would reject; sent to the client so it can warn. */
  notReimportable: number;
}

/** ASCII-only and quote-free, so the name is safe inside a Content-Disposition header. */
function fileSlug(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'bank';
}

/**
 * Turns a bank into a downloadable file and a validated file into questions. The file mapping
 * lives here (not in the service) so the service only knows the question shape.
 */
export class QuestionTransferController {
  constructor(private questionTransferService: QuestionTransferService) {}

  /**
   * Answers with the whole bank as a downloadable file. The mapping lives in the controller
   * (not the service) so the service only knows the question shape, and the file name is
   * slugged because header values must stay ASCII.
   */
  async exportBank(
    bankId: string,
    query: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = ExportQuestionsQuerySchema.safeParse(query ?? {});
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.questionTransferService.exportBank(ctx, bankId);
    if (isFailure(result)) return controllerResponse.error(result.error);

    const { bankName, questions, notReimportable } = result.data;
    const base = `questions-${fileSlug(bankName)}`;
    const file: QuestionExportFile =
      parsed.data.format === 'json'
        ? {
            body: JSON.stringify(
              { version: 1, bank: bankName, exportedAt: new Date().toISOString(), questions },
              null,
              2,
            ),
            contentType: 'application/json; charset=utf-8',
            filename: `${base}.json`,
            notReimportable,
          }
        : {
            body: questionsToCsv(questions),
            contentType: 'text/csv; charset=utf-8',
            filename: `${base}.csv`,
            notReimportable,
          };

    return controllerResponse.success(file);
  }

  /**
   * Validates the whole batch before the service sees it, so a single bad row rejects the file
   * instead of importing the good rows and reporting the rest afterwards. 201, because the
   * request creates questions.
   */
  async importQuestions(
    bankId: string,
    body: unknown,
    ctx: RequestContext,
  ): Promise<ControllerResponse> {
    const parsed = ImportQuestionsSchema.safeParse(body);
    if (!parsed.success) {
      return controllerResponse.error('UNPROCESSABLE_ENTITY', parsed.error.issues);
    }

    const result = await this.questionTransferService.importQuestions(
      ctx,
      bankId,
      parsed.data.questions,
    );
    if (isFailure(result)) return controllerResponse.error(result.error);

    return controllerResponse.created(result.data);
  }
}

export const questionTransferController = wrapService(
  new QuestionTransferController(questionTransferService),
  'question-transfer.controller',
);
