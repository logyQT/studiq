'use client';

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studiq/ui';
import { Plus } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { PageToolbar } from '@/components/shared/page-toolbar';

interface QuestionBankFiltersProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  owner: string;
  onOwnerChange: (value: string) => void;
  groupFilter?: string;
  onGroupFilterChange?: (value: string) => void;
  showGroupFilter?: boolean;
  sortBy: string;
  sortOrder: string;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  onCreateNew: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function QuestionBankFilters({
  searchInput,
  onSearchChange,
  owner,
  onOwnerChange,
  groupFilter,
  onGroupFilterChange,
  showGroupFilter,
  sortBy,
  sortOrder,
  onSortChange,
  onCreateNew,
  t,
}: QuestionBankFiltersProps) {
  return (
    <PageToolbar
      search={{
        value: searchInput,
        onChange: onSearchChange,
        placeholder: t('search_placeholder'),
      }}
      actions={
        <Button className="justify-start" onClick={onCreateNew}>
          <Plus className="h-4 w-4" /> {t('new_bank')}
        </Button>
      }
    >
      <Select value={owner} onValueChange={onOwnerChange}>
        <SelectTrigger className="w-35 truncate">
          <SelectValue placeholder={t('owner_all')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('owner_all')}</SelectItem>
          <SelectItem value="mine">{t('owner_mine')}</SelectItem>
        </SelectContent>
      </Select>
      {showGroupFilter && onGroupFilterChange && (
        <Select value={groupFilter} onValueChange={onGroupFilterChange}>
          <SelectTrigger className="w-38 truncate">
            <SelectValue placeholder={t('group_filter_all')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('group_filter_all')}</SelectItem>
            <SelectItem value="mine">{t('group_filter_mine')}</SelectItem>
          </SelectContent>
        </Select>
      )}
      <Select
        value={`${sortBy}:${sortOrder}`}
        onValueChange={(v) => {
          const [sb, so] = v.split(':');
          onSortChange(sb, so);
        }}
      >
        <SelectTrigger className="w-37.5 truncate">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="created_at:desc">{t('sort_newest')}</SelectItem>
          <SelectItem value="updated_at:desc">{t('sort_recent')}</SelectItem>
          <SelectItem value="created_at:asc">{t('sort_oldest')}</SelectItem>
          <SelectItem value="name:asc">{t('sort_name_asc')}</SelectItem>
          <SelectItem value="name:desc">{t('sort_name_desc')}</SelectItem>
        </SelectContent>
      </Select>
    </PageToolbar>
  );
}
