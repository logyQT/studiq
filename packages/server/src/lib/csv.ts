/**
 * RFC 4180 cell escaping: quote when the value contains a comma, a quote or a
 * line break, and double any embedded quote.
 */
export function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** First character that makes Excel/LibreOffice/Sheets evaluate a cell. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * CWE-1236 (CSV formula injection) mitigation for cells whose value is
 * user-controlled. A leading `'` makes Excel/LibreOffice/Sheets treat the cell
 * as literal text (the apostrophe itself is not displayed). Keep this separate
 * from `escapeCsvCell` so numeric/date columns and the literal `-` placeholders
 * are untouched.
 */
export function neutralizeCsvFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

/**
 * Builds a CSV document from rows, joining cells with `,` and rows with `\n`.
 * The UTF-8 BOM is required so Excel on Windows renders Polish characters
 * (`Uczeń`, `Ukończono`) instead of mojibake.
 */
export function buildCsv(rows: string[][]): string {
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  return `\uFEFF${body}`;
}
