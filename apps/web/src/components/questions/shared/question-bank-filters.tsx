'use client';

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studiq/ui';
import { Plus } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { PageToolbar } from '@/components/shared/page-toolbar';
import { ScopeGroupFilter } from '@/components/shared/scope-group-filter';
import type { GroupOption } from '@/hooks/use-group-options';

interface QuestionBankFiltersProps {
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
  onCreateNew: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function QuestionBankFilters({
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
      <ScopeGroupFilter
        owner={owner}
        onOwnerChange={onOwnerChange}
        groupIds={groupIds}
        onGroupIdsChange={onGroupIdsChange}
        options={groupOptions}
        myGroupIds={myGroupIds}
        t={t}
      />
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
