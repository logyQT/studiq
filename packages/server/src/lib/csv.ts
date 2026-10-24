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

/**
 * Builds a CSV document from rows, joining cells with `,` and rows with `\n`.
 * The UTF-8 BOM is required so Excel on Windows renders Polish characters
 * (`Uczeń`, `Ukończono`) instead of mojibake.
 */
export function buildCsv(rows: string[][]): string {
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  return `\uFEFF${body}`;
}
