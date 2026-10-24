import { buildCsv, escapeCsvCell, neutralizeCsvFormula } from '@studiq/server/lib/csv';
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

describe('neutralizeCsvFormula', () => {
  it('leaves ordinary user names untouched', () => {
    expect(neutralizeCsvFormula('Classroom Student')).toBe('Classroom Student');
    expect(neutralizeCsvFormula('Kowalski, Jan')).toBe('Kowalski, Jan');
    expect(neutralizeCsvFormula('')).toBe('');
  });

  it('prefixes every formula trigger with an apostrophe', () => {
    expect(neutralizeCsvFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeCsvFormula('+1')).toBe("'+1");
    expect(neutralizeCsvFormula('-1')).toBe("'-1");
    expect(neutralizeCsvFormula('@x')).toBe("'@x");
    expect(neutralizeCsvFormula('\tfoo')).toBe("'\tfoo");
    expect(neutralizeCsvFormula('\rfoo')).toBe("'\rfoo");
  });

  it('neutralises a command payload without quoting it', () => {
    expect(neutralizeCsvFormula("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
  });

  it('stays inert after RFC 4180 escaping', () => {
    expect(escapeCsvCell(neutralizeCsvFormula('=HYPERLINK("http://evil")'))).toBe(
      `"'=HYPERLINK(""http://evil"")"`,
    );
    expect(buildCsv([['=HYPERLINK("http://evil")'].map(neutralizeCsvFormula)])).toBe(
      `\uFEFF"'=HYPERLINK(""http://evil"")"`,
    );
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
