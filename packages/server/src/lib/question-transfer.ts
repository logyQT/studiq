import { buildCsv, neutralizeCsvFormula } from '@studiq/server/lib/csv';
import {
  TRANSFER_MAX_ANSWERS,
  type TransferQuestion,
} from '@studiq/server/models/question-transfer.model';

/**
 * Question bank CSV layout (#652). One question per row:
 *
 * `type,content,explanation,topics,answer_1 … answer_10,correct`
 *
 * - `type`: `mcq`, `true_false` or `open`.
 * - `topics`: names separated by `;`.
 * - `answer_N`: the options in order; empty cells are skipped.
 * - `correct`: the 1-based numbers of the right answer columns, separated by `;`
 *   (`2` or `1;3`).
 *
 * This module is pure so the server (export) and the browser (reading a file before it is
 * sent) use the same mapping.
 */
export const TRANSFER_CSV_COLUMNS = [
  'type',
  'content',
  'explanation',
  'topics',
  ...Array.from({ length: TRANSFER_MAX_ANSWERS }, (_, i) => `answer_${i + 1}`),
  'correct',
] as const;

const FORMULA_ESCAPE = /^'[=+\-@\t\r]/;

/** Undoes `neutralizeCsvFormula`, so an exported file imports back to the same text. */
function restoreCsvFormula(value: string): string {
  return FORMULA_ESCAPE.test(value) ? value.slice(1) : value;
}

/** Text cells carry user input, so a leading `=`, `+`, `-` or `@` must not become a formula. */
function textCell(value: string): string {
  return neutralizeCsvFormula(value);
}

/** Serialises questions in the bank layout: the BOM and fixed header first, one row per question. */
export function questionsToCsv(questions: TransferQuestion[]): string {
  const rows: string[][] = [[...TRANSFER_CSV_COLUMNS]];

  for (const question of questions) {
    const answerCells = Array.from({ length: TRANSFER_MAX_ANSWERS }, (_, i) =>
      question.answers[i] ? textCell(question.answers[i].content) : '',
    );
    const correct = question.answers
      .map((answer, i) => (answer.isCorrect ? String(i + 1) : null))
      .filter((n): n is string => n !== null)
      .join(';');

    rows.push([
      question.type,
      textCell(question.content),
      textCell(question.explanation ?? ''),
      textCell(question.topics.join(';')),
      ...answerCells,
      correct,
    ]);
  }

  return buildCsv(rows);
}

export interface CsvReadIssue {
  /** 1-based number of the data row (the header is not counted). */
  row: number;
  code: 'INVALID_CORRECT';
}

/**
 * Turns parsed CSV records (header -> cell) into transfer questions. Mapping problems that
 * cannot be expressed in the question itself are reported as issues; everything else is
 * left to `TransferQuestionSchema`, which is the single place that validates a question.
 */
export function csvRecordsToQuestions(records: Array<Record<string, string | undefined>>): {
  questions: TransferQuestion[];
  issues: CsvReadIssue[];
} {
  const questions: TransferQuestion[] = [];
  const issues: CsvReadIssue[] = [];

  records.forEach((record, index) => {
    const cell = (name: string) => restoreCsvFormula((record[name] ?? '').trim());

    // Columns keep their position: `correct` refers to the answer column number, even when an
    // earlier answer cell is empty.
    const answerColumns = Array.from({ length: TRANSFER_MAX_ANSWERS }, (_, i) =>
      cell(`answer_${i + 1}`),
    );
    const correctColumns = new Set<number>();
    const correctText = cell('correct');
    // One issue per row, not per bad token: `9;10` is one problem to fix, and a duplicate
    // would also key the same row twice in the import dialog's problem list.
    let invalidCorrect = false;
    for (const token of correctText.split(/[;,]/).map((t) => t.trim())) {
      if (token === '') continue;
      const n = Number(token);
      if (
        !Number.isInteger(n) ||
        n < 1 ||
        n > TRANSFER_MAX_ANSWERS ||
        answerColumns[n - 1] === ''
      ) {
        invalidCorrect = true;
      } else {
        correctColumns.add(n);
      }
    }
    if (invalidCorrect) issues.push({ row: index + 1, code: 'INVALID_CORRECT' });

    const explanation = cell('explanation');
    questions.push({
      type: cell('type').toLowerCase() as TransferQuestion['type'],
      content: cell('content'),
      ...(explanation ? { explanation } : {}),
      topics: cell('topics')
        .split(';')
        .map((topic) => topic.trim())
        .filter(Boolean),
      answers: answerColumns
        .map((content, i) => ({ content, isCorrect: correctColumns.has(i + 1) }))
        .filter((answer) => answer.content !== ''),
    });
  });

  return { questions, issues };
}
