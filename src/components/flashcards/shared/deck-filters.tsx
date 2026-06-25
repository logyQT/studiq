'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, FileUp, Plus } from 'lucide-react';

interface DeckFiltersProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  owner: string;
  onOwnerChange: (value: string) => void;
  sortBy: string;
  sortOrder: string;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  canSeeOrg: boolean;
  onImport: () => void;
  onCreateNew: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function DeckFilters({
  searchInput,
  onSearchChange,
  owner,
  onOwnerChange,
  sortBy,
  sortOrder,
  onSortChange,
  canSeeOrg,
  onImport,
  onCreateNew,
  t,
}: DeckFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 max-sm:hidden">
      <div className="relative flex-1 basis-full lg:basis-auto lg:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('search_placeholder')}
          className="pl-9 pr-9"
        />
        {searchInput && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Select
        value={owner}
        onValueChange={(v) => {
          onOwnerChange(v);
        }}
      >
        <SelectTrigger className="w-35 truncate">
          <SelectValue placeholder={t('owner_all')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('owner_all')}</SelectItem>
          <SelectItem value="mine">{t('owner_mine')}</SelectItem>
          {canSeeOrg && <SelectItem value="org">{t('owner_org')}</SelectItem>}
          <SelectItem value="shared">{t('owner_shared')}</SelectItem>
        </SelectContent>
      </Select>
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
      <div className="flex items-center gap-2 sm:ml-auto">
        <Button variant="outline" className="justify-start" onClick={onImport}>
          <FileUp className="h-4 w-4" /> {t('common_import')}
        </Button>
        <Button className="justify-start" onClick={onCreateNew}>
          <Plus className="h-4 w-4" /> {t('new_deck')}
        </Button>
      </div>
    </div>
  );
}
