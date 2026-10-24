import { buildCsv, escapeCsvCell } from '@studiq/server/lib/csv';
import { describe, expect, it } from 'vitest';

describe('escapeCsvCell', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvCell('Uczeń')).toBe('Uczeń');
    expect(escapeCsvCell('3/4')).toBe('3/4');
    expect(escapeCsvCell('')).toBe('');
  });

  it('quotes a value containing a comma', () => {
    expect(escapeCsvCell('Kowalski, Jan')).toBe('"Kowalski, Jan"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCsvCell('Jan "Jaś" Kowalski')).toBe('"Jan ""Jaś"" Kowalski"');
  });

  it('quotes values containing newlines', () => {
    expect(escapeCsvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(escapeCsvCell('line 1\rline 2')).toBe('"line 1\rline 2"');
  });
});

describe('buildCsv', () => {
  it('prefixes a UTF-8 BOM so Excel renders Polish characters', () => {
    expect(buildCsv([['Uczeń']])).toBe('\uFEFFUczeń');
  });

  it('joins cells with commas and rows with newlines, escaping each cell', () => {
    const csv = buildCsv([
      ['Uczeń', 'E-mail', 'Wynik'],
      ['Kowalski, Jan', 'jan@example.com', '3/4'],
    ]);

    expect(csv).toBe('\uFEFFUczeń,E-mail,Wynik\n"Kowalski, Jan",jan@example.com,3/4');
  });

  it('produces only the BOM for no rows', () => {
    expect(buildCsv([])).toBe('\uFEFF');
  });
});
