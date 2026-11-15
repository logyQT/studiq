'use client';

import type { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PageToolbar } from '@/components/shared/page-toolbar';
import { ScopeGroupFilter } from '@/components/shared/scope-group-filter';
import { SortSelect } from '@/components/shared/sort-select';
import type { GroupOption } from '@/hooks/use-group-options';
import type { SortOption } from '@/lib/content-sort-options';

interface ContentListToolbarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  owner: string;
  onOwnerChange: (value: string) => void;
  groupIds: string[];
  onGroupIdsChange: (value: string[]) => void;
  groupOptions: GroupOption[];
  myGroupIds: string[];
  sortBy: string;
  sortOrder: string;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  sortOptions: SortOption[];
  actions?: ReactNode;
  /** List-specific controls rendered after the sort select, e.g. the deck suspend toggle. */
  children?: ReactNode;
  t: ReturnType<typeof useTranslations>;
}

/**
 * Search, scope/group filter and sort in one toolbar, shared by the deck and
 * question-bank lists so their controls cannot drift apart.
 */
export function ContentListToolbar({
  searchInput,
  onSearchChange,
  owner,
  onOwnerChange,
  groupIds,
  onGroupIdsChange,
  groupOptions,
  myGroupIds,
  sortBy,
  sortOrder,
  onSortChange,
  sortOptions,
  actions,
  children,
  t,
}: ContentListToolbarProps) {
  return (
    <PageToolbar
      search={{
        value: searchInput,
        onChange: onSearchChange,
        placeholder: t('search_placeholder'),
      }}
      actions={actions}
    >
      <ScopeGroupFilter
        owner={owner}
        onOwnerChange={onOwnerChange}
        groupIds={groupIds}
        onGroupIdsChange={onGroupIdsChange}
        options={groupOptions}
        myGroupIds={myGroupIds}
        t={t}
      />
      <SortSelect
        sortBy={sortBy}
        sortOrder={sortOrder}
        onChange={onSortChange}
        options={sortOptions}
      />
      {children}
    </PageToolbar>
  );
}
