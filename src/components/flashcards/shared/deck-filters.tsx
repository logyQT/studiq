'use client';

import { EyeOff, FileUp, Lock, Plus, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFeature } from '@/hooks/use-feature';

interface DeckFiltersProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  owner: string;
  onOwnerChange: (value: string) => void;
  sortBy: string;
  sortOrder: string;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  canSeeOrg: boolean;
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
  sortBy,
  sortOrder,
  onSortChange,
  canSeeOrg,
  includeSuspended,
  onIncludeSuspendedChange,
  onImport,
  onCreateNew,
  t,
}: DeckFiltersProps) {
  const { hasAccess } = useFeature('study.create');
  const router = useRouter();

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
      <Button
        variant={includeSuspended ? 'default' : 'outline'}
        size="sm"
        onClick={() => onIncludeSuspendedChange(!includeSuspended)}
        className="gap-1.5"
      >
        <EyeOff className="h-4 w-4" />
        {includeSuspended && <span>{t('show_suspended')}</span>}
      </Button>
      <div className="flex items-center gap-2 sm:ml-auto">
        <Button variant="outline" className="justify-start" onClick={onImport}>
          <FileUp className="h-4 w-4" /> {t('common_import')}
        </Button>
        <Button
          className="justify-start"
          disabled={!hasAccess}
          onClick={hasAccess ? onCreateNew : () => router.push('/checkout?plan_id=student_premium')}
        >
          {hasAccess ? (
            <>
              <Plus className="h-4 w-4" /> {t('new_deck')}
            </>
          ) : (
            <>
              <Lock className="size-3" /> Upgrade
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
