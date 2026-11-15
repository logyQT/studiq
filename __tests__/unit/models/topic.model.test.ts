import { contentSortOptions } from '@/lib/content-sort-options';
import { TopicListQuerySchema } from '@studiq/server/models/topic.model';
import { describe, expect, it } from 'vitest';

const t = (key: string) => key;

describe('TopicListQuerySchema', () => {
  // The decks, question banks and topics lists share one sort select, so every
  // order it offers must be valid for every one of them. Topics lagged behind:
  // the table had no `updated_at`, so "recently updated" 422'd here only.
  it.each(contentSortOptions(t).map((option) => option.value))(
    'accepts the shared sort order %s',
    (value) => {
      const [sortBy, sortOrder] = value.split(':');
      const parsed = TopicListQuerySchema.safeParse({ sortBy, sortOrder });
      expect(parsed.success, `sortBy=${sortBy}&sortOrder=${sortOrder}`).toBe(true);
    },
  );

  it('rejects a sort column no list offers', () => {
    expect(TopicListQuerySchema.safeParse({ sortBy: 'flashcard_count' }).success).toBe(false);
  });
});
