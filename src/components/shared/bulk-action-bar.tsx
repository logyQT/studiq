'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface BulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  children?: ReactNode;
}

export function BulkActionBar({ selectedCount, onClearSelection, children }: BulkActionBarProps) {
  const t = useTranslations('Common');
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <span className="text-sm font-medium">{t('n_selected', { count: selectedCount })}</span>
        <div className="flex items-center gap-2">
          {children}
          <Button variant="ghost" size="icon-sm" onClick={onClearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
