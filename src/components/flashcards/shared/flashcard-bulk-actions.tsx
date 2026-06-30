'use client';

import { ArrowRight, Copy, Download, Link2, Tags, Trash2, X } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface FlashcardBulkActionsProps {
  selectedCount: number;
  canDelete: boolean;
  canTopics: boolean;
  canMove: boolean;
  canExport: boolean;
  onDelete: () => void;
  onLink: () => void;
  onCopy: () => void;
  onTopics: () => void;
  onMove: () => void;
  onExport: () => void;
  onClearSelection: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function FlashcardBulkActions({
  selectedCount,
  canDelete,
  canTopics,
  canMove,
  canExport,
  onDelete,
  onLink,
  onCopy,
  onTopics,
  onMove,
  onExport,
  onClearSelection,
  t,
}: FlashcardBulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('n_selected', { count: selectedCount })}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCopy}>
            <Copy className="mr-1.5 h-4 w-4" /> {t('bulk_copy')}
          </Button>
          {canExport && (
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download className="mr-1.5 h-4 w-4" /> {t('common_export')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onLink}>
            <Link2 className="mr-1.5 h-4 w-4" /> {t('bulk_link')}
          </Button>
          {canTopics && (
            <Button variant="outline" size="sm" onClick={onTopics}>
              <Tags className="mr-1.5 h-4 w-4" /> {t('bulk_topics')}
            </Button>
          )}
          {canMove && (
            <Button variant="outline" size="sm" onClick={onMove}>
              <ArrowRight className="mr-1.5 h-4 w-4" /> {t('bulk_move')}
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1.5 h-4 w-4" /> {t('common_delete')}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
