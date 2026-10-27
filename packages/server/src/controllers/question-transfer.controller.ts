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

export class QuestionTransferController {
  constructor(private questionTransferService: QuestionTransferService) {}

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

    const { bankName, questions } = result.data;
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
          }
        : {
            body: questionsToCsv(questions),
            contentType: 'text/csv; charset=utf-8',
            filename: `${base}.csv`,
          };

    return controllerResponse.success(file);
  }

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
