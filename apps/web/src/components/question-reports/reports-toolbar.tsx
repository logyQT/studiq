'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studiq/ui';
import type { useTranslations } from 'next-intl';
import { PageToolbar } from '@/components/shared/page-toolbar';

interface ReportsToolbarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  status: string;
  onStatusChange: (value: string) => void;
  sort: string;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  t: ReturnType<typeof useTranslations>;
}

export function ReportsToolbar({
  searchInput,
  onSearchChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  t,
}: ReportsToolbarProps) {
  return (
    <PageToolbar
      alwaysVisible
      search={{
        value: searchInput,
        onChange: onSearchChange,
        placeholder: t('search_placeholder'),
        ariaLabel: t('search_placeholder'),
        clearLabel: t('clear_search'),
      }}
    >
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-36 truncate" aria-label={t('status_label')}>
          <SelectValue placeholder={t('status_label')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('common_all')}</SelectItem>
          <SelectItem value="open">{t('status_open')}</SelectItem>
          <SelectItem value="resolved">{t('status_resolved')}</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={sort}
        onValueChange={(value) => {
          const [sortBy, sortOrder] = value.split(':');
          onSortChange(sortBy, sortOrder);
        }}
      >
        <SelectTrigger className="w-48 truncate" aria-label={t('sort_label')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updated_at:desc">{t('sort_last_activity')}</SelectItem>
          <SelectItem value="created_at:desc">{t('sort_newest')}</SelectItem>
          <SelectItem value="created_at:asc">{t('sort_oldest')}</SelectItem>
        </SelectContent>
      </Select>
    </PageToolbar>
  );
}
