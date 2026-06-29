'use client';

import { Button } from '@/components/ui/button';
import { Trash2, Download, X, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface DeckBulkActionsProps {
  selectedCount: number;
  onExport: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
  onToggleSuspend: (suspended: boolean) => void;
  t: ReturnType<typeof useTranslations>;
}

export function DeckBulkActions({
  selectedCount,
  onExport,
  onDelete,
  onClearSelection,
  onToggleSuspend,
  t,
}: DeckBulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('n_selected', { count: selectedCount })}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onToggleSuspend(true)}>
            <EyeOff className="mr-1.5 h-4 w-4" /> {t('suspend_deck')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onToggleSuspend(false)}>
            <EyeOff className="mr-1.5 h-4 w-4" /> {t('unsuspend_deck')}
          </Button>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="mr-1.5 h-4 w-4" /> {t('common_export')}
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="mr-1.5 h-4 w-4" /> {t('common_delete')}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
