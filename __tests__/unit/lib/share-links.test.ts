import { planShareLinks } from '@studiq/server/lib/share-links';
import { describe, expect, it } from 'vitest';

describe('planShareLinks', () => {
  it('clears the links for a personal target even when a list is sent', () => {
    expect(
      planShareLinks({
        sentVisibility: 'personal',
        sentGroupIds: ['g-1', 'g-1'],
        storedVisibility: 'group',
      }),
    ).toEqual({ groupIds: [], groupWithoutLinks: false });
  });

  it('dedupes the sent list for a group target', () => {
    expect(
      planShareLinks({
        sentVisibility: 'group',
        sentGroupIds: ['g-1', 'g-1', 'g-2'],
        storedVisibility: 'group',
      }),
    ).toEqual({ groupIds: ['g-1', 'g-2'], groupWithoutLinks: false });
  });

  it('keeps the stored links when a group update sends no list', () => {
    expect(planShareLinks({ sentVisibility: 'group', storedVisibility: 'group' })).toEqual({
      groupIds: null,
      groupWithoutLinks: false,
    });
  });

  it('deletes the stored links when a personal update sends no list', () => {
    expect(planShareLinks({ sentVisibility: 'personal', storedVisibility: 'group' })).toEqual({
      groupIds: [],
      groupWithoutLinks: false,
    });
  });

  it('flags a group update with an empty list', () => {
    expect(
      planShareLinks({ sentVisibility: 'group', sentGroupIds: [], storedVisibility: 'group' }),
    ).toEqual({ groupIds: [], groupWithoutLinks: true });
  });

  it('flags a group update with no list when the stored row is personal', () => {
    expect(planShareLinks({ sentVisibility: 'group', storedVisibility: 'personal' })).toEqual({
      groupIds: null,
      groupWithoutLinks: true,
    });
  });
});
