import { isRecord } from '@/lib/unknown-value';

/** The filter dimensions a collection screen persists between visits. */
export interface PersistedCollectionFilters {
  owner: string;
  groupIds: string[];
  sortBy: string;
  sortOrder: string;
}

export const DEFAULT_COLLECTION_FILTERS: PersistedCollectionFilters = {
  owner: 'all',
  groupIds: [],
  sortBy: 'created_at',
  sortOrder: 'desc',
};

/**
 * Reads the persisted blob defensively. `localStorage` outlives a deploy and is
 * hand-editable, so a structurally wrong entry — `groupIds` as a string, an
 * unknown owner, a missing key — must degrade to the defaults instead of
 * reaching `groupIds.filter()` and taking the route into the error boundary.
 */
export function normaliseCollectionFilters(value: unknown): PersistedCollectionFilters {
  if (!isRecord(value)) return DEFAULT_COLLECTION_FILTERS;

  const { owner, groupIds, sortBy, sortOrder } = value;
  return {
    owner: owner === 'mine' ? 'mine' : 'all',
    groupIds: Array.isArray(groupIds)
      ? groupIds.filter((id): id is string => typeof id === 'string')
      : [],
    sortBy:
      typeof sortBy === 'string' && sortBy.length > 0 ? sortBy : DEFAULT_COLLECTION_FILTERS.sortBy,
    sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
  };
}
