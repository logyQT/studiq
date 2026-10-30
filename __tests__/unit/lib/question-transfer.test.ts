import { csvRecordsToQuestions, questionsToCsv } from '@studiq/server/lib/question-transfer';
import {
  IMPORT_MAX_QUESTIONS,
  ImportQuestionsSchema,
  TransferQuestionSchema,
} from '@studiq/server/models/question-transfer.model';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';

// #652: a bank is exported as CSV or JSON and imported back. The CSV <-> question mapping is a
// pure module shared by the server (export) and the browser (reading a file), and
// TransferQuestionSchema is the one place a question is validated.

const mcq = {
  type: 'mcq' as const,
  content: 'Stolica Polski?',
  explanation: 'Warszawa od 1596',
  topics: ['Geografia', 'Europa'],
  answers: [
    { content: 'Kraków', isCorrect: false },
    { content: 'Warszawa', isCorrect: true },
    { content: 'Gdańsk', isCorrect: false },
  ],
};
const trueFalse = {
  type: 'true_false' as const,
  content: 'Ziemia jest płaska',
  topics: [],
  answers: [
    { content: 'Prawda', isCorrect: false },
    { content: 'Fałsz', isCorrect: true },
  ],
};
const open = { type: 'open' as const, content: 'Opisz fotosyntezę', topics: [], answers: [] };

function readCsv(csv: string) {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return csvRecordsToQuestions(parsed.data);
}

describe('questionsToCsv', () => {
  it('starts with a BOM and the fixed header, one row per question', () => {
    const csv = questionsToCsv([mcq, open]);
    const lines = csv.split('\n');

    expect(csv.startsWith('﻿type,content,explanation,topics,answer_1,')).toBe(true);
    expect(lines[0]).toMatch(/,answer_10,correct$/);
    expect(lines).toHaveLength(3);
  });

  it('writes the 1-based numbers of the right answers', () => {
    const [, row] = questionsToCsv([mcq]).split('\n');
    expect(row).toContain(',Kraków,Warszawa,Gdańsk,');
    expect(row.endsWith(',2')).toBe(true);
  });

  it('quotes commas, quotes and line breaks', () => {
    const csv = questionsToCsv([{ ...open, content: 'a, "b"\nc' }]);
    expect(csv).toContain('"a, ""b""\nc"');
  });

  it('neutralises formulas in every text cell', () => {
    const csv = questionsToCsv([
      {
        ...mcq,
        content: '=HYPERLINK("x")',
        explanation: '+1',
        answers: [
          { content: '-2', isCorrect: true },
          { content: '@SUM(A1)', isCorrect: false },
        ],
      },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain(",'+1,");
    expect(csv).toContain(",'-2,");
    expect(csv).toContain(",'@SUM(A1),");
  });
});

describe('csvRecordsToQuestions', () => {
  it('round-trips an export, including topics, explanation and formulas', () => {
    const originals = [
      mcq,
      trueFalse,
      open,
      { ...mcq, content: '=1+1', explanation: undefined, topics: [] },
    ].map((q) => TransferQuestionSchema.parse(q));

    const { questions, issues } = readCsv(questionsToCsv(originals));

    expect(issues).toEqual([]);
    expect(questions.map((q) => TransferQuestionSchema.parse(q))).toEqual(originals);
  });

  it('lets `correct` refer to the answer column, even after an empty answer cell', () => {
    const { questions } = csvRecordsToQuestions([
      { type: 'MCQ', content: 'Q', answer_1: 'A', answer_2: '', answer_3: 'C', correct: '3' },
    ]);
    expect(questions[0].type).toBe('mcq');
    expect(questions[0].answers).toEqual([
      { content: 'A', isCorrect: false },
      { content: 'C', isCorrect: true },
    ]);
  });

  it('accepts several right answers separated by ; or ,', () => {
    const { questions } = csvRecordsToQuestions([
      { type: 'mcq', content: 'Q', answer_1: 'A', answer_2: 'B', answer_3: 'C', correct: '1; 3' },
    ]);
    expect(questions[0].answers.map((a) => a.isCorrect)).toEqual([true, false, true]);
  });

  it.each([
    ['a number that is not an answer column', '4'],
    ['text', 'B'],
    ['zero', '0'],
    ['a column past the last', '11'],
  ])('reports an issue for `correct` = %s', (_name, correct) => {
    const { issues } = csvRecordsToQuestions([
      { type: 'mcq', content: 'Q', answer_1: 'A', answer_2: 'B', answer_3: '', correct },
      { type: 'mcq', content: 'Q2', answer_1: 'A', answer_2: 'B', correct: '1' },
    ]);
    expect(issues).toEqual([{ row: 1, code: 'INVALID_CORRECT' }]);
  });

  it('reports one issue per row even when several `correct` tokens are wrong', () => {
    const { issues } = csvRecordsToQuestions([
      { type: 'mcq', content: 'Q', answer_1: 'A', answer_2: 'B', correct: '9;10' },
    ]);
    expect(issues).toEqual([{ row: 1, code: 'INVALID_CORRECT' }]);
  });

  it('splits topics on ; and drops blanks and surrounding spaces', () => {
    const { questions } = csvRecordsToQuestions([
      { type: 'open', content: 'Q', topics: ' A ;; B;' },
    ]);
    expect(questions[0].topics).toEqual(['A', 'B']);
  });
});

describe('TransferQuestionSchema', () => {
  it('accepts the three question types in their valid shapes', () => {
    for (const q of [mcq, trueFalse, open]) {
      expect(TransferQuestionSchema.safeParse(q).success).toBe(true);
    }
  });

  it.each([
    [
      'mcq without a right answer',
      { ...mcq, answers: mcq.answers.map((a) => ({ ...a, isCorrect: false })) },
    ],
    ['mcq with one option', { ...mcq, answers: [mcq.answers[1]] }],
    ['true_false with three options', { ...trueFalse, answers: mcq.answers }],
    [
      'true_false with two right answers',
      { ...trueFalse, answers: trueFalse.answers.map((a) => ({ ...a, isCorrect: true })) },
    ],
    ['open with answers', { ...open, answers: mcq.answers }],
    ['empty content', { ...open, content: '   ' }],
    ['content over 255 characters', { ...open, content: 'x'.repeat(256) }],
    ['unknown type', { ...open, type: 'essay' }],
    [
      'more than 10 answers',
      {
        ...mcq,
        answers: Array.from({ length: 11 }, (_, i) => ({ content: `a${i}`, isCorrect: i === 0 })),
      },
    ],
    ['more than 10 topics', { ...open, topics: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
  ])('rejects %s', (_name, question) => {
    expect(TransferQuestionSchema.safeParse(question).success).toBe(false);
  });

  it('trims text and defaults topics and answers', () => {
    const parsed = TransferQuestionSchema.parse({ type: 'open', content: '  Q  ' });
    expect(parsed).toEqual({ type: 'open', content: 'Q', topics: [], answers: [] });
  });
});

describe('ImportQuestionsSchema', () => {
  it('needs at least one question and at most the import limit', () => {
    expect(ImportQuestionsSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(
      ImportQuestionsSchema.safeParse({ questions: Array(IMPORT_MAX_QUESTIONS + 1).fill(open) })
        .success,
    ).toBe(false);
    expect(
      ImportQuestionsSchema.safeParse({ questions: Array(IMPORT_MAX_QUESTIONS).fill(open) })
        .success,
    ).toBe(true);
  });

  it('points at the failing row and field', () => {
    const result = ImportQuestionsSchema.safeParse({
      questions: [open, { ...mcq, answers: [] }],
    });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0].path).toEqual(['questions', 1, 'answers']);
  });
});
