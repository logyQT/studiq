'use client';

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studiq/ui';
import { EyeOff, FileUp, Plus } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { PageToolbar } from '@/components/shared/page-toolbar';
import { ScopeGroupFilter } from '@/components/shared/scope-group-filter';
import type { GroupOption } from '@/hooks/use-group-options';

interface DeckFiltersProps {
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
  includeSuspended: boolean;
  onIncludeSuspendedChange: (value: boolean) => void;
  onImport: () => void;
  onCreateNew: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function DeckFilters({
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
  includeSuspended,
  onIncludeSuspendedChange,
  onImport,
  onCreateNew,
  t,
}: DeckFiltersProps) {
  return (
    <PageToolbar
      search={{
        value: searchInput,
        onChange: onSearchChange,
        placeholder: t('search_placeholder'),
      }}
      actions={
        <>
          <Button variant="outline" className="justify-start" onClick={onImport}>
            <FileUp className="h-4 w-4" /> {t('common_import')}
          </Button>
          <Button className="justify-start" onClick={onCreateNew}>
            <Plus className="h-4 w-4" /> {t('new_deck')}
          </Button>
        </>
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
      <Button
        variant={includeSuspended ? 'default' : 'outline'}
        size="sm"
        onClick={() => onIncludeSuspendedChange(!includeSuspended)}
        className="gap-1.5"
      >
        <EyeOff className="h-4 w-4" />
        {includeSuspended && <span>{t('show_suspended')}</span>}
      </Button>
    </PageToolbar>
  );
}
