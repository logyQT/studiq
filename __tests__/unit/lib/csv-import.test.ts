import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import {
  autoMapColumns,
  isCsvFile,
  parseCsv,
  summarizeImport,
  toImportCards,
} from '@/lib/csv-import';

describe('isCsvFile (#888)', () => {
  it.each([
    ['fiszki.csv', 'text/csv', true],
    ['FISZKI.CSV', 'application/vnd.ms-excel', true],
    ['export', 'text/csv', true],
    ['notatka.txt', 'text/plain', false],
    ['obrazek.png', 'image/png', false],
    ['fiszki.csv.txt', '', false],
  ])('%s (%s) → %s', (name, type, expected) => {
    expect(isCsvFile({ name, type })).toBe(expected);
  });
});

const cardsOf = async (text: string) => {
  const parsed = await parseCsv(text);
  if (!parsed) throw new Error('expected rows');
  return toImportCards(parsed.rows, autoMapColumns(parsed.columns));
};

describe('parseCsv (#888)', () => {
  it('keeps a blank line between rows as a numbered, empty row', async () => {
    const cards = await cardsOf('front,back\nq1,a1\n\nq3,a3\n,\nq5,a5\n');

    expect(cards.map((c) => [c.front, c.back])).toEqual([
      ['q1', 'a1'],
      ['', ''],
      ['q3', 'a3'],
      ['', ''],
      ['q5', 'a5'],
    ]);
  });

  it.each([
    ['one final newline', 'front,back\nq,a\n'],
    ['several final CRLFs', 'front,back\r\nq,a\r\n\r\n\r\n'],
    ['blank lines before the header', '\n\nfront,back\nq,a'],
  ])('adds no row for %s', async (_label, text) => {
    expect(await cardsOf(text)).toMatchObject([{ front: 'q', back: 'a' }]);
  });

  it('keeps a quoted line break inside its one row', async () => {
    expect(await cardsOf('front,back\n"line 1\n\nline 3",a\n')).toMatchObject([
      { front: 'line 1\n\nline 3', back: 'a' },
    ]);
  });

  it('keeps every row of a file longer than the preview ever shows', async () => {
    const text = ['front,back', ...Array.from({ length: 620 }, (_, i) => `q${i},a${i}`)].join('\n');

    const cards = await cardsOf(text);

    expect(cards).toHaveLength(620);
    expect(cards.at(-1)).toMatchObject({ front: 'q619', back: 'a619' });
  });

  it.each([
    ['an empty file', ''],
    ['only line breaks', '\n\n'],
    ['a header without rows', 'front,back\n'],
  ])('finds no rows in %s', async (_label, text) => {
    expect(await parseCsv(text)).toBeNull();
  });
});

describe('column mapping', () => {
  it('maps by name, in any order and case, and leaves absent optional columns unmapped', () => {
    expect(autoMapColumns(['Topic', 'Answer', 'Question'])).toEqual({
      front: 'Question',
      back: 'Answer',
      topic: 'Topic',
      deck: null,
    });
  });

  it('leaves the back unmapped when the file has a single column', () => {
    expect(autoMapColumns(['front'])).toMatchObject({ front: 'front', back: '' });
  });
});

const issue = (row: number, field: 'front' | 'back') => ({ row, field, error: 'REQUIRED' });

describe('summarizeImport (#888)', () => {
  it.each([
    ['every row imported', 3, [], false, 'import_complete', 0],
    ['some rows imported', 1, [issue(2, 'back')], false, 'import_complete', 1],
    ['no row imported', 0, [issue(1, 'back'), issue(2, 'front')], true, 'import_failed', 2],
    [
      'two problems in one row',
      1,
      [issue(2, 'front'), issue(2, 'back'), issue(3, 'back')],
      false,
      'import_complete',
      2,
    ],
  ] as const)('judges %s', (_label, imported, errors, failed, titleKey, errorRows) => {
    expect(summarizeImport({ total: 3, imported, errors: [...errors] })).toEqual({
      failed,
      titleKey,
      errorRows,
    });
  });
});

const IMPORT_NAMESPACES = [
  'AppFlashcardDeckViewPage',
  'AppFlashcardDecksPage',
  'EduDeckViewPage',
  'EduFlashcardDecksPage',
] as const;

describe.each(IMPORT_NAMESPACES)('%s.import_errors (#888)', (namespace) => {
  it.each([
    [1, '1 wiersz z błędem'],
    [2, '2 wiersze z błędami'],
    [5, '5 wierszy z błędami'],
    [22, '22 wiersze z błędami'],
  ])('counts %i rows in Polish', (count, expected) => {
    const translate = createTranslator({ locale: 'pl', messages: pl, namespace });

    expect(translate('import_errors', { count })).toBe(expected);
  });

  it.each([
    [1, '1 row has errors'],
    [2, '2 rows have errors'],
  ])('counts %i rows in English', (count, expected) => {
    const translate = createTranslator({ locale: 'en', messages: en, namespace });

    expect(translate('import_errors', { count })).toBe(expected);
  });
});
