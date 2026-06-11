'use client';

import { useTranslations } from 'next-intl';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Link2, Copy } from 'lucide-react';

interface ViewOnlyFlashcardContextMenuProps {
  t: ReturnType<typeof useTranslations>;
  onLink: () => void;
  onCopy: () => void;
}

export function ViewOnlyFlashcardContextMenu({
  t,
  onLink,
  onCopy,
}: ViewOnlyFlashcardContextMenuProps) {
  return (
    <>
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onLink(); }}>
        <Link2 className="mr-2 h-4 w-4" /> {t('menu_link')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopy(); }}>
        <Copy className="mr-2 h-4 w-4" /> {t('menu_copy')}
      </DropdownMenuItem>
    </>
  );
}
