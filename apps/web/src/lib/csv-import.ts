export type CsvRecord = Record<string, string | undefined>;

export interface CsvColumnMap {
  front: string;
  back: string;
  topic: string | null;
  deck: string | null;
}

/** What the file picker and a drop both accept: `accept=".csv"` only filters the OS dialog. */
export function isCsvFile(file: { name: string; type: string }): boolean {
  return file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';
}

/**
 * The header and every data row of a CSV text, or null when it holds no row. A blank line
 * between rows is a row: it keeps its number and is reported like any row without a front
 * and a back (STU-20). The line breaks around the content are not rows.
 */
export async function parseCsv(
  text: string,
): Promise<{ columns: string[]; rows: CsvRecord[] } | null> {
  const Papa = (await import('papaparse')).default;
  const result = Papa.parse<CsvRecord>(text.replace(/^[\r\n]+|[\r\n]+$/g, ''), {
    header: true,
    skipEmptyLines: false,
    transformHeader: (header) => header.trim(),
  });
  if (result.data.length === 0) return null;
  return { columns: result.meta.fields ?? [], rows: result.data };
}

/** Guesses the mapping from the usual column names, else from the first two columns. */
export function autoMapColumns(columns: string[]): CsvColumnMap {
  const named = (...names: string[]) =>
    columns.find((column) => names.includes(column.toLowerCase()));
  return {
    front: named('front', 'question', 'q') ?? columns[0] ?? '',
    back: named('back', 'answer', 'a') ?? columns[1] ?? '',
    topic: named('topic', 'topics', 'tag', 'tags') ?? null,
    deck: named('deck', 'decks', 'deck_name') ?? null,
  };
}

/** One card per row, in order and with none dropped, so row numbers survive the request. */
export function toImportCards(rows: CsvRecord[], map: CsvColumnMap) {
  return rows.map((row) => ({
    front: row[map.front] ?? '',
    back: row[map.back] ?? '',
    topic: (map.topic ? row[map.topic] : undefined) || undefined,
    deck: (map.deck ? row[map.deck] : undefined) || undefined,
  }));
}
