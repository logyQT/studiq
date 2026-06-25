'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { DeckCheckboxSelector } from '@/components/flashcards/shared/deck-checkbox-selector';
import { DeckRadioSelector } from '@/components/flashcards/shared/deck-radio-selector';
import { ExternalLink } from 'lucide-react';
import type { Deck } from '@/types/flashcards';

interface SingleCardDialogsProps {
  t: ReturnType<typeof useTranslations>;
  basePath: string;
  ownedDecks: Deck[];
  linkOpen: boolean;
  linkDeckIds: string[];
  onLinkOpenChange: (open: boolean) => void;
  onLinkDeckIdsChange: (ids: string[]) => void;
  onLink: () => void;
  copyOpen: boolean;
  copyTargetDeckId: string | null;
  onCopyOpenChange: (open: boolean) => void;
  onCopyTargetDeckIdChange: (id: string | null) => void;
  onCopy: () => void;
  copyResult: { id: string; deckId: string } | null;
  onCopyResultClose: () => void;
  deleteId: string | null;
  onDeleteOpenChange: () => void;
  onDelete: () => void;
}

export function SingleCardDialogs({
  t,
  basePath,
  ownedDecks,
  linkOpen,
  linkDeckIds,
  onLinkOpenChange,
  onLinkDeckIdsChange,
  onLink,
  copyOpen,
  copyTargetDeckId,
  onCopyOpenChange,
  onCopyTargetDeckIdChange,
  onCopy,
  copyResult,
  onCopyResultClose,
  deleteId,
  onDeleteOpenChange,
  onDelete,
}: SingleCardDialogsProps) {
  const router = useRouter();

  return (
    <>
      <DeckCheckboxSelector
        open={linkOpen}
        onOpenChange={(open) => {
          if (!open) {
            onLinkOpenChange(false);
            onLinkDeckIdsChange([]);
          }
        }}
        decks={ownedDecks}
        selectedIds={linkDeckIds}
        onSelectionChange={onLinkDeckIdsChange}
        title={t('link_title')}
        description={t('link_desc')}
        buttonLabel={t('link_button', { count: linkDeckIds.length })}
        onConfirm={onLink}
        cancelLabel={t('common_cancel')}
        emptyLabel={t('no_other_decks')}
      />

      <DeckRadioSelector
        open={copyOpen}
        onOpenChange={(open) => {
          if (!open) {
            onCopyOpenChange(false);
            onCopyTargetDeckIdChange(null);
          }
        }}
        decks={ownedDecks}
        selectedId={copyTargetDeckId}
        onSelectionChange={onCopyTargetDeckIdChange}
        title={t('copy_title')}
        description={t('copy_desc')}
        buttonLabel={t('copy_button')}
        onConfirm={onCopy}
        cancelLabel={t('common_cancel')}
        emptyLabel={t('no_other_decks')}
        countLabel={(count) => t('flashcards_count', { count })}
      />

      <Dialog
        open={!!copyResult}
        onOpenChange={(open) => {
          if (!open) onCopyResultClose();
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('copy_success_title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              onClick={() => {
                router.push(`${basePath}/decks/${copyResult?.deckId}`);
                onCopyResultClose();
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" /> {t('copy_go_to_card')}
            </Button>
            <Button variant="outline" onClick={onCopyResultClose}>
              {t('copy_stay_here')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={onDeleteOpenChange}
        onConfirm={onDelete}
        title={t('delete_dialog_title')}
        description={t('delete_dialog_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />
    </>
  );
}
