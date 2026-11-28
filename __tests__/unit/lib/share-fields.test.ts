import { describe, expect, it } from 'vitest';
import { contentFormPayload } from '@/lib/share-fields';

const storedGroupDeck = { visibility: 'group' as const, groupIds: ['b', 'a'] };

describe('contentFormPayload (#1555)', () => {
  it('omits an unchanged share set, so a name-only edit sends only the name', () => {
    expect(
      contentFormPayload(storedGroupDeck, {
        name: 'Renamed',
        description: 'kept',
        visibility: 'group',
        groupIds: ['a', 'b'],
      }),
    ).toEqual({ name: 'Renamed', description: 'kept' });
  });

  it('sends both share fields for a share-only edit', () => {
    expect(
      contentFormPayload(storedGroupDeck, {
        name: 'Unchanged',
        description: 'kept',
        visibility: 'group',
        groupIds: ['a', 'c'],
      }),
    ).toEqual({
      name: 'Unchanged',
      description: 'kept',
      visibility: 'group',
      groupIds: ['a', 'c'],
    });
  });

  it('clears the group list when the visibility becomes personal', () => {
    expect(
      contentFormPayload(storedGroupDeck, {
        name: 'Renamed',
        description: 'kept',
        visibility: 'personal',
        groupIds: ['a', 'b'],
      }),
    ).toEqual({ name: 'Renamed', description: 'kept', visibility: 'personal', groupIds: [] });
  });

  it('always carries the share set for a new item', () => {
    expect(contentFormPayload(null, { name: 'New', description: '' })).toEqual({
      name: 'New',
      description: '',
      visibility: 'personal',
      groupIds: [],
    });
  });
});
