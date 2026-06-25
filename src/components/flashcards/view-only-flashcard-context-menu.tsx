'use client';

import { useTranslations } from 'next-intl';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { CheckSquare, Link2, Copy, Trash2 } from 'lucide-react';

interface ViewOnlyFlashcardContextMenuProps {
  t: ReturnType<typeof useTranslations>;
  onSelect: () => void;
  onLink: () => void;
  onCopy: () => void;
  onDelete?: (() => void) | null;
}

export function ViewOnlyFlashcardContextMenu({
  t,
  onSelect,
  onLink,
  onCopy,
  onDelete,
}: ViewOnlyFlashcardContextMenuProps) {
  return (
    <>
      <DropdownMenuItem
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <CheckSquare className="mr-2 h-4 w-4" /> {t('select_cards')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={(e) => {
          e.stopPropagation();
          onLink();
        }}
      >
        <Link2 className="mr-2 h-4 w-4" /> {t('menu_link')}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
      >
        <Copy className="mr-2 h-4 w-4" /> {t('menu_copy')}
      </DropdownMenuItem>
      {onDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> {t('menu_delete')}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
