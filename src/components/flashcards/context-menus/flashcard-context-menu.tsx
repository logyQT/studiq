'use client';

import {
  CheckSquare,
  Copy,
  ExternalLink,
  Link2,
  Pencil,
  Plus,
  Settings,
  Tags,
  Trash2,
} from 'lucide-react';
import type { useTranslations } from 'next-intl';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

interface FlashcardContextMenuProps {
  t: ReturnType<typeof useTranslations>;
  mode: 'owned' | 'view-only';
  onSelect: () => void;
  onEdit?: () => void;
  onAddTopic?: () => void;
  onManageTopics?: () => void;
  onViewByTopic?: () => void;
  onLink: () => void;
  onCopy: () => void;
  onDelete?: (() => void) | null;
}

export function FlashcardContextMenu({
  t,
  mode,
  onSelect,
  onEdit,
  onAddTopic,
  onManageTopics,
  onViewByTopic,
  onLink,
  onCopy,
  onDelete,
}: FlashcardContextMenuProps) {
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
      {mode === 'owned' && onEdit && (
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="mr-2 h-4 w-4" /> {t('menu_edit')}
        </DropdownMenuItem>
      )}
      {mode === 'owned' && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Tags className="mr-2 h-4 w-4" /> {t('menu_topics')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onAddTopic?.();
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> {t('menu_add_topic')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onManageTopics?.();
              }}
            >
              <Settings className="mr-2 h-4 w-4" /> {t('menu_manage_topics')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onViewByTopic?.();
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" /> {t('menu_view_by_topic')}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {mode === 'owned' && <DropdownMenuSeparator />}
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
            variant="destructive"
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
