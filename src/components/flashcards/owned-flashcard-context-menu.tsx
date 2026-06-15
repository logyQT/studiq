'use client';

import { useTranslations } from 'next-intl';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Pencil, Tags, Plus, Settings, ExternalLink, Link2, Copy, Trash2 } from 'lucide-react';

interface OwnedFlashcardContextMenuProps {
  t: ReturnType<typeof useTranslations>;
  onEdit: () => void;
  onAddTopic: () => void;
  onManageTopics: () => void;
  onViewByTopic: () => void;
  onLink: () => void;
  onCopy: () => void;
  onDelete: (() => void) | null;
}

export function OwnedFlashcardContextMenu({
  t,
  onEdit,
  onAddTopic,
  onManageTopics,
  onViewByTopic,
  onLink,
  onCopy,
  onDelete,
}: OwnedFlashcardContextMenuProps) {
  return (
    <>
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
        <Pencil className="mr-2 h-4 w-4" /> {t('menu_edit')}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Tags className="mr-2 h-4 w-4" /> {t('menu_topics')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onAddTopic(); }}>
            <Plus className="mr-2 h-4 w-4" /> {t('menu_add_topic')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onManageTopics(); }}>
            <Settings className="mr-2 h-4 w-4" /> {t('menu_manage_topics')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewByTopic(); }}>
            <ExternalLink className="mr-2 h-4 w-4" /> {t('menu_view_by_topic')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onLink(); }}>
        <Link2 className="mr-2 h-4 w-4" /> {t('menu_link')}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopy(); }}>
        <Copy className="mr-2 h-4 w-4" /> {t('menu_copy')}
      </DropdownMenuItem>
      {onDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> {t('menu_delete')}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
