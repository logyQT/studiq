'use client';

import { Button } from '@studiq/ui';
import { CheckCheck } from 'lucide-react';
import type { useTranslations } from 'next-intl';

interface SelectAllRowProps {
  /** The list's translator, so the copy comes from that collection's namespace. */
  t: ReturnType<typeof useTranslations>;
  /** Rows currently selected. */
  selectedCount: number;
  /** Rows the list currently shows. */
  total: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

/**
 * "Select all / deselect all" plus the selected count, shown above the grid while
 * a list is in selection mode. Shared by the collection screens and the deck view
 * so the row cannot differ between them.
 */
export function SelectAllRow({
  t,
  selectedCount,
  total,
  onSelectAll,
  onDeselectAll,
}: SelectAllRowProps) {
  const allSelected = selectedCount === total;

  return (
    <div className="flex items-center gap-2 py-1">
      <Button variant="outline" size="sm" onClick={allSelected ? onDeselectAll : onSelectAll}>
        <CheckCheck className="mr-1.5 h-4 w-4" />
        {allSelected ? t('deselect_all') : t('select_all')}
      </Button>
      <span className="text-sm text-muted-foreground">
        {t('n_selected', { count: selectedCount })}
      </span>
    </div>
  );
}
