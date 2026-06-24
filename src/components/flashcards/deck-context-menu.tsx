'use client';

import { useTranslations } from 'next-intl';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { CheckSquare, Pencil, Trash2, FileUp, FileDown } from 'lucide-react';

interface DeckContextMenuProps {
  t: ReturnType<typeof useTranslations>;
  canUpdate: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onImport: () => void;
  onExport: () => void;
}

export function DeckContextMenu({
  t,
  canUpdate,
  canDelete,
  onSelect,
  onEdit,
  onDelete,
  onImport,
  onExport,
}: DeckContextMenuProps) {
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
      {canUpdate && (
        <DropdownMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="mr-2 h-4 w-4" /> {t('common_edit')}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      {/* <DropdownMenuItem
        onClick={(e) => {
          e.stopPropagation();
          onImport();
        }}
      >
        <FileUp className="mr-2 h-4 w-4" /> {t('import_csv')}
      </DropdownMenuItem> */}
      <DropdownMenuItem
        onClick={(e) => {
          e.stopPropagation();
          onExport();
        }}
      >
        <FileDown className="mr-2 h-4 w-4" /> {t('export_csv')}
      </DropdownMenuItem>
      {canDelete && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> {t('common_delete')}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}
