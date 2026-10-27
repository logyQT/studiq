import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { CsvImportRowSchema, CsvImportSchema } from '@studiq/server/models/flashcard-import.model';
import { describe, expect, it } from 'vitest';

describe('CsvImportRowSchema topic/deck names', () => {
  it('trims a padded topic and deck', () => {
    const result = CsvImportRowSchema.safeParse({
      front: 'a',
      back: 'b',
      topic: '  Math  ',
      deck: '  Deck  ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topic).toBe('Math');
      expect(result.data.deck).toBe('Deck');
    }
  });

  it('parses a whitespace-only topic and deck as empty (no name)', () => {
    const result = CsvImportRowSchema.safeParse({
      front: 'a',
      back: 'b',
      topic: '   ',
      deck: '\t\n',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topic).toBe('');
      expect(result.data.deck).toBe('');
    }
  });

  it('accepts a row without topic or deck', () => {
    expect(CsvImportRowSchema.safeParse({ front: 'a', back: 'b' }).success).toBe(true);
  });
});

describe('CsvImportSchema defaultDeckName', () => {
  it('rejects a whitespace-only default deck name', () => {
    const result = CsvImportSchema.safeParse({
      defaultDeckName: '   ',
      cards: [{ front: 'a', back: 'b' }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['defaultDeckName']);
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });

  it('trims a padded default deck name', () => {
    const result = CsvImportSchema.safeParse({
      defaultDeckName: '  Imported  ',
      cards: [{ front: 'a', back: 'b' }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultDeckName).toBe('Imported');
    }
  });
});
