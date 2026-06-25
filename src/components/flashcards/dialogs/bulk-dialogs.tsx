'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { DeckCheckboxSelector } from '@/components/flashcards/shared/deck-checkbox-selector';
import { DeckRadioSelector } from '@/components/flashcards/shared/deck-radio-selector';
import { getTopicColor } from '@/lib/color-utils';
import type { Deck, Topic } from '@/types/flashcards';

interface BulkDialogsProps {
  t: ReturnType<typeof useTranslations>;
  ownedDecks: Deck[];
  selectedIds: string[];
  bulkDeleteOpen: boolean;
  onBulkDeleteChange: (open: boolean) => void;
  onBulkDelete: () => void;
  bulkLinkOpen: boolean;
  bulkLinkDeckIds: string[];
  onBulkLinkChange: (open: boolean) => void;
  onBulkLinkDeckIdsChange: (ids: string[]) => void;
  onBulkLink: () => void;
  bulkMoveOpen: boolean;
  bulkMoveTargetDeckId: string | null;
  onBulkMoveChange: (open: boolean) => void;
  onBulkMoveTargetDeckIdChange: (id: string | null) => void;
  onBulkMove: () => void;
  bulkCopyOpen: boolean;
  bulkCopyTargetDeckId: string | null;
  onBulkCopyChange: (open: boolean) => void;
  onBulkCopyTargetDeckIdChange: (id: string | null) => void;
  onBulkCopy: () => void;
  bulkTopicsOpen: boolean;
  bulkTopicsOperation: 'add' | 'remove' | 'set';
  bulkTopicIds: string[];
  onBulkTopicsChange: (open: boolean) => void;
  onBulkTopicsOperationChange: (op: 'add' | 'remove' | 'set') => void;
  onBulkTopicIdsChange: (ids: string[]) => void;
  onBulkTopics: () => void;
  topics: Topic[];
}

export function BulkDialogs({
  t,
  ownedDecks,
  selectedIds,
  bulkDeleteOpen,
  onBulkDeleteChange,
  onBulkDelete,
  bulkLinkOpen,
  bulkLinkDeckIds,
  onBulkLinkChange,
  onBulkLinkDeckIdsChange,
  onBulkLink,
  bulkMoveOpen,
  bulkMoveTargetDeckId,
  onBulkMoveChange,
  onBulkMoveTargetDeckIdChange,
  onBulkMove,
  bulkCopyOpen,
  bulkCopyTargetDeckId,
  onBulkCopyChange,
  onBulkCopyTargetDeckIdChange,
  onBulkCopy,
  bulkTopicsOpen,
  bulkTopicsOperation,
  bulkTopicIds,
  onBulkTopicsChange,
  onBulkTopicsOperationChange,
  onBulkTopicIdsChange,
  onBulkTopics,
  topics,
}: BulkDialogsProps) {
  return (
    <>
      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={onBulkDeleteChange}
        onConfirm={onBulkDelete}
        title={t('bulk_delete_title', { count: selectedIds.length })}
        description={t('bulk_delete_desc', { count: selectedIds.length })}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <DeckCheckboxSelector
        open={bulkLinkOpen}
        onOpenChange={(open) => {
          if (!open) {
            onBulkLinkChange(false);
            onBulkLinkDeckIdsChange([]);
          }
        }}
        decks={ownedDecks}
        selectedIds={bulkLinkDeckIds}
        onSelectionChange={onBulkLinkDeckIdsChange}
        title={t('link_title')}
        description={t('link_desc')}
        buttonLabel={t('link_button', { count: bulkLinkDeckIds.length })}
        onConfirm={onBulkLink}
        cancelLabel={t('common_cancel')}
        emptyLabel={t('no_other_decks')}
      />

      <DeckRadioSelector
        open={bulkMoveOpen}
        onOpenChange={(open) => {
          if (!open) {
            onBulkMoveChange(false);
            onBulkMoveTargetDeckIdChange(null);
          }
        }}
        decks={ownedDecks}
        selectedId={bulkMoveTargetDeckId}
        onSelectionChange={onBulkMoveTargetDeckIdChange}
        title={t('bulk_move')}
        description={t('bulk_move')}
        buttonLabel={t('bulk_move')}
        onConfirm={onBulkMove}
        cancelLabel={t('common_cancel')}
        emptyLabel={t('no_other_decks')}
      />

      <DeckRadioSelector
        open={bulkCopyOpen}
        onOpenChange={(open) => {
          if (!open) {
            onBulkCopyChange(false);
            onBulkCopyTargetDeckIdChange(null);
          }
        }}
        decks={ownedDecks}
        selectedId={bulkCopyTargetDeckId}
        onSelectionChange={onBulkCopyTargetDeckIdChange}
        title={t('bulk_copy')}
        description={t('bulk_copy')}
        buttonLabel={t('bulk_copy')}
        onConfirm={onBulkCopy}
        cancelLabel={t('common_cancel')}
        emptyLabel={t('no_other_decks')}
      />

      <Dialog
        open={bulkTopicsOpen}
        onOpenChange={(open) => {
          if (!open) {
            onBulkTopicsChange(false);
            onBulkTopicIdsChange([]);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('bulk_topics')}</DialogTitle>
            <DialogDescription>{t('bulk_topics')}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 py-2">
            <Button
              variant={bulkTopicsOperation === 'add' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                onBulkTopicsOperationChange('add');
                onBulkTopicIdsChange([]);
              }}
            >
              {t('menu_add_topic')}
            </Button>
            <Button
              variant={bulkTopicsOperation === 'remove' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                onBulkTopicsOperationChange('remove');
                onBulkTopicIdsChange([]);
              }}
            >
              {t('menu_remove_topic')}
            </Button>
            <Button
              variant={bulkTopicsOperation === 'set' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                onBulkTopicsOperationChange('set');
                onBulkTopicIdsChange([]);
              }}
            >
              {t('bulk_topics_set')}
            </Button>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto py-2">
            {topics.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('no_topics_available')}
              </p>
            ) : (
              topics.map((topic) => (
                <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <Checkbox
                    checked={bulkTopicIds.includes(topic.id)}
                    onCheckedChange={() =>
                      onBulkTopicIdsChange(
                        bulkTopicIds.includes(topic.id)
                          ? bulkTopicIds.filter((id) => id !== topic.id)
                          : [...bulkTopicIds, topic.id],
                      )
                    }
                  />
                  <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                  <span className="text-sm">{topic.name}</span>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onBulkTopicsChange(false);
                onBulkTopicIdsChange([]);
              }}
            >
              {t('common_cancel')}
            </Button>
            <Button onClick={onBulkTopics} disabled={bulkTopicIds.length === 0}>
              {t('common_update')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
