import { DEFAULT_COLLECTION_FILTERS, normaliseCollectionFilters } from '@/lib/collection-filters';
import { describe, expect, it } from 'vitest';

/**
 * The filter blob lives in `localStorage`, so it outlives a deploy and can be
 * edited by hand. Every shape below reached the frame at some point; the string
 * `groupIds` threw `TypeError: … .filter is not a function` and took the bank list
 * into the error boundary on every reload.
 */
describe('normaliseCollectionFilters', () => {
  it('keeps a well-formed blob', () => {
    expect(
      normaliseCollectionFilters({
        owner: 'mine',
        groupIds: ['g-1', 'g-2'],
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    ).toEqual({ owner: 'mine', groupIds: ['g-1', 'g-2'], sortBy: 'name', sortOrder: 'asc' });
  });

  it('falls back to no groups when groupIds is not an array', () => {
    expect(normaliseCollectionFilters({ owner: 'all', groupIds: 'abc' }).groupIds).toEqual([]);
  });

  it('drops non-string ids from an array', () => {
    expect(normaliseCollectionFilters({ groupIds: ['g-1', 42, null] }).groupIds).toEqual(['g-1']);
  });

  it('accepts only the owner values the API understands', () => {
    expect(normaliseCollectionFilters({ owner: 'everyone' }).owner).toBe('all');
    expect(normaliseCollectionFilters({ owner: 'mine' }).owner).toBe('mine');
  });

  it('fills every missing key from the defaults', () => {
    expect(normaliseCollectionFilters({})).toEqual(DEFAULT_COLLECTION_FILTERS);
  });

  it('falls back to the defaults for anything that is not a filter blob', () => {
    // `usePersistedState` already swallows an unparseable entry; a parsed non-object
    // (a stray string, a number, an array) must be just as inert.
    for (const value of ['{"owner":"mine"', 'mine', 42, null, [], true]) {
      expect(normaliseCollectionFilters(value)).toEqual(DEFAULT_COLLECTION_FILTERS);
    }
  });
});
