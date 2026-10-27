import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { DeckListQuerySchema } from '@studiq/server/models/flashcard-deck.model';
import { QuestionBankListQuerySchema } from '@studiq/server/models/question-bank.model';
import { TopicListQuerySchema } from '@studiq/server/models/topic.model';
import { describe, expect, it } from 'vitest';

const uuid = (n: number) => `550e8400-e29b-41d4-a716-${String(n).padStart(12, '0')}`;

const schemas = [
  ['DeckListQuerySchema', DeckListQuerySchema],
  ['QuestionBankListQuerySchema', QuestionBankListQuerySchema],
  ['TopicListQuerySchema', TopicListQuerySchema],
] as const;

describe.each(schemas)('%s — #595 filter contract', (_label, schema) => {
  it.each([
    ['absent', {}, []],
    ['empty string', { groups: '' }, []],
    ['blank entries', { groups: ' , ' }, []],
  ])('maps groups %s to "no restriction"', (_case, input, expected) => {
    const result = schema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.groups).toEqual(expected);
  });

  it('trims and dedupes comma-joined group ids', () => {
    const result = schema.safeParse({ groups: ` ${uuid(1)} , ${uuid(2)},${uuid(1)} ` });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.groups).toEqual([uuid(1), uuid(2)]);
  });

  it('rejects a non-UUID group id', () => {
    const result = schema.safeParse({ groups: 'not-a-uuid' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        ValidationErrorCode.UUID_INVALID,
      );
    }
  });

  it('rejects more than 50 group ids', () => {
    const result = schema.safeParse({
      groups: Array.from({ length: 51 }, (_, i) => uuid(i)).join(','),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        ValidationErrorCode.TOO_MANY,
      );
    }
  });

  it('defaults owner to all and accepts the two scopes', () => {
    const defaulted = schema.safeParse({});
    expect(defaulted.success).toBe(true);
    if (defaulted.success) expect(defaulted.data.owner).toBe('all');

    expect(schema.safeParse({ owner: 'all' }).success).toBe(true);
    expect(schema.safeParse({ owner: 'mine' }).success).toBe(true);
  });

  it.each(['group', 'shared'])('rejects the retired owner=%s scope', (owner) => {
    expect(schema.safeParse({ owner }).success).toBe(false);
  });

  it('rejects the retired groupFilter param instead of stripping it', () => {
    const result = schema.safeParse({ groupFilter: 'mine' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.INVALID_INPUT);
    }
  });
});
