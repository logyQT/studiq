import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import {
  BulkCreateTopicSchema,
  CreateTopicSchema,
  UpdateTopicSchema,
} from '@studiq/server/models/topic.model';
import { describe, expect, it } from 'vitest';

/** Each schema wraps the name differently, so the raw name is lifted in/out per case. */
const schemas = [
  ['CreateTopicSchema', CreateTopicSchema, (name: string) => ({ name })],
  ['UpdateTopicSchema', UpdateTopicSchema, (name: string) => ({ name })],
  ['BulkCreateTopicSchema', BulkCreateTopicSchema, (name: string) => ({ topics: [{ name }] })],
] as const;

describe.each(schemas)('%s name', (_label, schema, wrap) => {
  it('rejects a whitespace-only name', () => {
    const result = schema.safeParse(wrap('   '));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.slice(-1)).toEqual(['name']);
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        ValidationErrorCode.TOO_SHORT,
      );
    }
  });

  it('rejects a tab/newline-only name', () => {
    const result = schema.safeParse(wrap('\t\n'));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path.slice(-1)).toEqual(['name']);
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
      expect(result.error.issues.map((issue) => issue.message)).toContain(
        ValidationErrorCode.TOO_SHORT,
      );
    }
  });

  it('rejects an empty name', () => {
    const result = schema.safeParse(wrap(''));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.REQUIRED);
    }
  });

  it('trims a padded name', () => {
    const result = schema.safeParse(wrap('  Math  '));

    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { name?: string; topics?: { name: string }[] };
      expect(data.name ?? data.topics?.[0].name).toBe('Math');
    }
  });

  it('measures the length limit after trimming', () => {
    const result = schema.safeParse(wrap(`   ${'a'.repeat(64)}   `));

    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { name?: string; topics?: { name: string }[] };
      expect(data.name ?? data.topics?.[0].name).toBe('a'.repeat(64));
    }
  });

  it('accepts a 64-character name', () => {
    expect(schema.safeParse(wrap('a'.repeat(64))).success).toBe(true);
  });

  it('rejects a 65-character name', () => {
    const result = schema.safeParse(wrap('a'.repeat(65)));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(ValidationErrorCode.TOO_LONG);
    }
  });
});

describe('UpdateTopicSchema', () => {
  it('accepts an empty body (name stays optional)', () => {
    expect(UpdateTopicSchema.safeParse({}).success).toBe(true);
  });
});

describe('CreateTopicSchema', () => {
  it('requires a name', () => {
    expect(CreateTopicSchema.safeParse({}).success).toBe(false);
  });
});
