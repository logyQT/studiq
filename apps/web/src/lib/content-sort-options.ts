export interface SortOption {
  /** `sortBy:sortOrder`, the value the sort select round-trips. */
  value: string;
  label: string;
}

/**
 * The sort orders the deck and question-bank lists offer. Each list passes its own
 * translator, so the labels stay in that list's message namespace.
 */
export function contentSortOptions(t: (key: string) => string): SortOption[] {
  return [
    { value: 'created_at:desc', label: t('sort_newest') },
    { value: 'updated_at:desc', label: t('sort_recent') },
    { value: 'created_at:asc', label: t('sort_oldest') },
    { value: 'name:asc', label: t('sort_name_asc') },
    { value: 'name:desc', label: t('sort_name_desc') },
  ];
}
