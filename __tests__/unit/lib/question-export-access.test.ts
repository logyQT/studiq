import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #652 operator decision: export follows read, import follows update, the export is never
// cached or sniffed, and the screen says what the file contains.

describe('question bank export access (#652)', () => {
  const screen = readFileSync(
    'apps/web/src/components/questions/screens/question-bank-detail-screen.tsx',
    'utf8',
  );
  const transfer = readFileSync(
    'apps/web/src/components/questions/shared/question-transfer.tsx',
    'utf8',
  );
  const route = readFileSync(
    'apps/web/src/app/(backend)/api/v1/questions/banks/[id]/export/route.ts',
    'utf8',
  );

  it('offers the menu to every reader and import only to those who can update the bank', () => {
    expect(screen).toContain('<QuestionBankTransfer bankId={bankId} canImport={canManageBank} />');
    expect(screen).not.toMatch(/canManageBank && <QuestionBankTransfer/);
    expect(transfer).toContain('{canImport && <ImportDialog');
  });

  it('does not claim the API enforces the same rules for export and import', () => {
    expect(transfer).not.toContain('the API enforces the same rules');
    expect(transfer).toContain('anyone who can read it may export it');
  });

  it('sends the export with no-store and nosniff', () => {
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it.each(['pl', 'en'])('%s tells the reader what the export contains', (locale) => {
    const json = JSON.parse(readFileSync(`apps/web/src/i18n/messages/${locale}.json`, 'utf8'));
    for (const key of [
      'export_note',
      'export_failed',
      'export_too_large',
      'export_not_reimportable',
    ]) {
      expect(json.QuestionTransfer[key]).toBeTruthy();
    }
  });
});
